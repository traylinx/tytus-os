import { describe, expect, it, vi, afterEach } from "vitest";
import { applyThemeToDom, modeFromSchedule } from "./effects";
import { normalizeTheme } from "./normalize";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.classList.remove(
    "theme-dark",
    "theme-light",
    "reduce-motion",
  );
});

describe("applyThemeToDom", () => {
  it("writes --accent-primary + derivatives", () => {
    const theme = normalizeTheme({ accent: "#7c4dff", mode: "dark" });
    applyThemeToDom(theme);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--accent-primary")).toBe("#7c4dff");
    expect(root.style.getPropertyValue("--accent-primary-hover")).toMatch(/^#/);
    expect(root.style.getPropertyValue("--border-focus")).toBe("#7c4dff");
  });

  it("toggles theme-dark/theme-light classes", () => {
    applyThemeToDom(normalizeTheme({ mode: "light" }));
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);
    expect(document.documentElement.classList.contains("theme-dark")).toBe(false);

    applyThemeToDom(normalizeTheme({ mode: "dark" }));
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
  });

  it("applies fontScale as --font-scale + root font-size", () => {
    applyThemeToDom(normalizeTheme({ fontScale: 1.25 }));
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe(
      "1.25",
    );
    expect(document.documentElement.style.fontSize).toBe("20px");
  });

  it("toggles reduce-motion class from theme.reduceMotion", () => {
    applyThemeToDom(normalizeTheme({ reduceMotion: true }));
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(
      true,
    );
    applyThemeToDom(normalizeTheme({ reduceMotion: false }));
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(
      false,
    );
  });
});

describe("modeFromSchedule", () => {
  it("returns null for manual", () => {
    expect(modeFromSchedule("manual")).toBeNull();
  });

  it("locks to a single mode for always-* schedules", () => {
    expect(modeFromSchedule("always-light")).toBe("light");
    expect(modeFromSchedule("always-dark")).toBe("dark");
  });

  it("auto = light 06:00-17:59, dark otherwise", () => {
    const at = (h: number) => new Date(2026, 4, 2, h, 0);
    expect(modeFromSchedule("auto", at(5))).toBe("dark");
    expect(modeFromSchedule("auto", at(6))).toBe("light");
    expect(modeFromSchedule("auto", at(12))).toBe("light");
    expect(modeFromSchedule("auto", at(17))).toBe("light");
    expect(modeFromSchedule("auto", at(18))).toBe("dark");
    expect(modeFromSchedule("auto", at(23))).toBe("dark");
  });
});
