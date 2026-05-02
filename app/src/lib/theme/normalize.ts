// ============================================================
// Theme normalizer — backward + forward-compatible state hydration
// ============================================================
//
// Old persisted state from before Sprint A's Phase 1 only had
//   { mode, accent, wallpaper }
// — anything new (`dock`, `fontScale`, `modeSchedule`,
// `lockWallpaperMatchesDesktop`) was missing entirely. After Sprint A
// ships, reloading an old session must hydrate cleanly. After Sprint
// B ships, the same normalizer must absorb its `reduceMotion` and
// `soundEnabled` keys without dropping any forward-compat extras.
//
// The function is idempotent: `normalizeTheme(normalizeTheme(x))`
// always equals `normalizeTheme(x)`.
//
// This file is intentionally untyped for the input — `raw: unknown` —
// because by definition the persisted blob from older versions
// doesn't conform to the current `Theme` interface.

import type { DockTheme, ModeSchedule, Theme, ThemeMode } from "@/types";

/** Default brand wallpaper id (matches `lib/brand.ts` BACKGROUND_PRESETS[0].id). */
export const DEFAULT_WALLPAPER = "tytus-default";

/** Default accent (matches existing 8-swatch palette's first entry). */
export const DEFAULT_ACCENT = "#3b82f6";

export const DEFAULT_DOCK: DockTheme = {
  position: "bottom",
  size: "medium",
  autoHide: false,
  order: [],
};

const VALID_MODES: readonly ThemeMode[] = ["dark", "light"];
const VALID_MODE_SCHEDULES: readonly ModeSchedule[] = [
  "manual",
  "always-light",
  "always-dark",
  "auto",
];
const VALID_DOCK_POSITIONS = ["bottom", "left", "right"] as const;
const VALID_DOCK_SIZES = ["small", "medium", "large"] as const;

const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 1.5;

const KNOWN_KEYS = new Set<string>([
  "mode",
  "accent",
  "wallpaper",
  "dock",
  "fontScale",
  "modeSchedule",
  "lockWallpaperMatchesDesktop",
  "reduceMotion",
  "soundEnabled",
]);

const KNOWN_DOCK_KEYS = new Set<string>([
  "position",
  "size",
  "autoHide",
  "order",
]);

/**
 * Hydrate a persisted-state blob into the current `Theme` shape.
 *
 *   • Missing keys → filled with defaults.
 *   • Invalid values → fall back to defaults.
 *   • Unknown keys → preserved on the output object so a future
 *     Sprint B/C/D can add fields without forcing a normalizer
 *     bump in lockstep.
 *   • Idempotent: running it twice yields the same object.
 */
export function normalizeTheme(raw: unknown): Theme {
  const src = isObject(raw) ? raw : {};

  const mode: ThemeMode = pickEnum(src.mode, VALID_MODES, "dark");
  const accent: string = pickString(src.accent, DEFAULT_ACCENT);
  const wallpaper: string = pickString(src.wallpaper, DEFAULT_WALLPAPER);
  const dock: DockTheme = normaliseDock(src.dock);
  const fontScale: number = clampNumber(
    src.fontScale,
    1.0,
    FONT_SCALE_MIN,
    FONT_SCALE_MAX,
  );
  const modeSchedule: ModeSchedule = pickEnum(
    src.modeSchedule,
    VALID_MODE_SCHEDULES,
    "manual",
  );
  const lockWallpaperMatchesDesktop: boolean = pickBool(
    src.lockWallpaperMatchesDesktop,
    true,
  );

  const out: Theme = {
    mode,
    accent,
    wallpaper,
    dock,
    fontScale,
    modeSchedule,
    lockWallpaperMatchesDesktop,
  };

  // Sprint B optional keys — only emit when the source had them so a
  // round-trip on Sprint A state stays bit-identical.
  if (typeof src.reduceMotion === "boolean") {
    out.reduceMotion = src.reduceMotion;
  }
  if (typeof src.soundEnabled === "boolean") {
    out.soundEnabled = src.soundEnabled;
  }

  // Forward-compat: copy any extra keys we don't know about. They
  // pass through unchanged so a Sprint C field added before this
  // normalizer is updated won't be dropped on the floor.
  for (const k of Object.keys(src)) {
    if (!KNOWN_KEYS.has(k)) {
      (out as unknown as Record<string, unknown>)[k] = src[k];
    }
  }

  return out;
}

function normaliseDock(raw: unknown): DockTheme {
  const src = isObject(raw) ? raw : {};
  const position = pickEnum(
    src.position,
    VALID_DOCK_POSITIONS,
    DEFAULT_DOCK.position,
  );
  const size = pickEnum(src.size, VALID_DOCK_SIZES, DEFAULT_DOCK.size);
  const autoHide = pickBool(src.autoHide, DEFAULT_DOCK.autoHide);
  const order = Array.isArray(src.order)
    ? src.order.filter((v): v is string => typeof v === "string")
    : [];

  const out: DockTheme = { position, size, autoHide, order };
  // Forward-compat for unknown dock keys.
  for (const k of Object.keys(src)) {
    if (!KNOWN_DOCK_KEYS.has(k)) {
      (out as unknown as Record<string, unknown>)[k] = src[k];
    }
  }
  return out;
}

// --------------------------------------------------------
// helpers
// --------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  dflt: T,
): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : dflt;
}

function pickString(v: unknown, dflt: string): string {
  return typeof v === "string" && v.length > 0 ? v : dflt;
}

function pickBool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

function clampNumber(
  v: unknown,
  dflt: number,
  min: number,
  max: number,
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
