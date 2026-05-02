// ============================================================
// Theme effects — apply Theme state to live CSS + run mode schedule
// ============================================================
//
// State shape lives in `useOSStore.tsx` (`state.theme`); this module
// is the single place that pushes those values onto the DOM (`<html>`
// CSS variables) and runs the optional auto light/dark schedule.
//
// Why one module: every Settings control feeds back into reducer
// state via `SET_THEME`, and a single useEffect-driven applier means
// the path from "user picks accent" → "every component re-renders
// with new --accent-primary" is short and obvious.

import type { Theme, ThemeMode } from "@/types";

/**
 * Apply theme to the document root. Idempotent — safe to call from
 * useEffect on every theme change. Returns the cleanup function for
 * any side-effects that need teardown (currently nothing).
 */
export function applyThemeToDom(theme: Theme, doc: Document = document): void {
  const root = doc.documentElement;

  // Accent — primary + hover + active variants. We don't attempt to
  // brighten/darken the hex algorithmically; instead we drop a 60%
  // alpha glow and let var(--accent-primary) carry the user's pick.
  root.style.setProperty("--accent-primary", theme.accent);
  root.style.setProperty("--accent-primary-hover", lightenHex(theme.accent, 0.15));
  root.style.setProperty("--accent-primary-active", darkenHex(theme.accent, 0.15));
  root.style.setProperty("--border-focus", theme.accent);
  root.style.setProperty(
    "--bg-selected",
    `${theme.accent}26` /* 15% alpha */,
  );

  // Font scale — applied at <html> root so rem units cascade.
  root.style.setProperty("--font-scale", String(theme.fontScale));
  // Plain `font-size` ensures rem-based layouts pick up the scale.
  root.style.fontSize = `${Math.round(theme.fontScale * 16)}px`;

  // Mode (dark/light) — class hook for components that bypass tokens.
  if (theme.mode === "dark") {
    root.classList.add("theme-dark");
    root.classList.remove("theme-light");
  } else {
    root.classList.add("theme-light");
    root.classList.remove("theme-dark");
  }
  root.style.colorScheme = theme.mode;

  // Reduce motion (Sprint B Phase 6.4 — declared here so the CSS var
  // is set even before the toggle UI lands; consuming styles can
  // already key off it).
  if (theme.reduceMotion) {
    root.classList.add("reduce-motion");
  } else {
    root.classList.remove("reduce-motion");
  }
}

/**
 * Compute the mode the schedule wants right now. Returns null when
 * the schedule is `manual` (caller should leave `state.theme.mode`
 * alone). `auto` resolves to light 06:00–18:00 local, dark otherwise.
 */
export function modeFromSchedule(
  schedule: Theme["modeSchedule"],
  now: Date = new Date(),
): ThemeMode | null {
  switch (schedule) {
    case "manual":
      return null;
    case "always-light":
      return "light";
    case "always-dark":
      return "dark";
    case "auto": {
      const hour = now.getHours();
      return hour >= 6 && hour < 18 ? "light" : "dark";
    }
  }
}

/** Default schedule poll interval = 5 minutes. */
export const SCHEDULE_POLL_MS = 5 * 60 * 1000;

// --------------------------------------------------------
// hex math (small + good-enough; no external dep)
// --------------------------------------------------------

function lightenHex(hex: string, amount: number): string {
  return shiftHex(hex, amount, true);
}

function darkenHex(hex: string, amount: number): string {
  return shiftHex(hex, amount, false);
}

function shiftHex(hex: string, amount: number, lighten: boolean): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  if (lighten) {
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);
  } else {
    r = Math.round(r * (1 - amount));
    g = Math.round(g * (1 - amount));
    b = Math.round(b * (1 - amount));
  }
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
