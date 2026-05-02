import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT,
  DEFAULT_DOCK,
  DEFAULT_WALLPAPER,
  normalizeTheme,
} from "./normalize";

describe("normalizeTheme — defaults", () => {
  it("empty object → fully-defaulted theme", () => {
    expect(normalizeTheme({})).toEqual({
      mode: "dark",
      accent: DEFAULT_ACCENT,
      wallpaper: DEFAULT_WALLPAPER,
      dock: DEFAULT_DOCK,
      fontScale: 1.0,
      modeSchedule: "manual",
      lockWallpaperMatchesDesktop: true,
    });
  });

  it("non-object input falls back to all defaults", () => {
    expect(normalizeTheme(null).mode).toBe("dark");
    expect(normalizeTheme(undefined).mode).toBe("dark");
    expect(normalizeTheme(42).mode).toBe("dark");
    expect(normalizeTheme("oops").mode).toBe("dark");
    expect(normalizeTheme([]).mode).toBe("dark");
  });
});

describe("normalizeTheme — legacy state hydration", () => {
  it("legacy { mode, accent, wallpaper } only → fills new fields", () => {
    const legacy = {
      mode: "light",
      accent: "#ff0000",
      wallpaper: "my-pic",
    };
    const out = normalizeTheme(legacy);
    expect(out.mode).toBe("light");
    expect(out.accent).toBe("#ff0000");
    expect(out.wallpaper).toBe("my-pic");
    expect(out.dock).toEqual(DEFAULT_DOCK);
    expect(out.fontScale).toBe(1.0);
    expect(out.modeSchedule).toBe("manual");
    expect(out.lockWallpaperMatchesDesktop).toBe(true);
  });
});

describe("normalizeTheme — invalid values rejected", () => {
  it("invalid mode falls back to dark", () => {
    expect(normalizeTheme({ mode: "purple" }).mode).toBe("dark");
  });

  it("invalid modeSchedule falls back to manual", () => {
    expect(normalizeTheme({ modeSchedule: "weird" }).modeSchedule).toBe(
      "manual",
    );
  });

  it("fontScale clamps to [0.5, 1.5]", () => {
    expect(normalizeTheme({ fontScale: 0.1 }).fontScale).toBe(0.5);
    expect(normalizeTheme({ fontScale: 5 }).fontScale).toBe(1.5);
    expect(normalizeTheme({ fontScale: NaN }).fontScale).toBe(1.0);
    expect(normalizeTheme({ fontScale: "x" }).fontScale).toBe(1.0);
  });

  it("invalid dock position/size fall back to defaults", () => {
    const out = normalizeTheme({
      dock: { position: "top", size: "huge", autoHide: "yes", order: [1, 2] },
    });
    expect(out.dock.position).toBe("bottom");
    expect(out.dock.size).toBe("medium");
    expect(out.dock.autoHide).toBe(false);
    expect(out.dock.order).toEqual([]);
  });

  it("dock.order keeps only strings", () => {
    expect(
      normalizeTheme({ dock: { order: ["files", null, "music", 1, "trash"] } })
        .dock.order,
    ).toEqual(["files", "music", "trash"]);
  });
});

describe("normalizeTheme — Sprint B optional keys", () => {
  it("reduceMotion + soundEnabled survive when present", () => {
    const out = normalizeTheme({ reduceMotion: true, soundEnabled: false });
    expect(out.reduceMotion).toBe(true);
    expect(out.soundEnabled).toBe(false);
  });

  it("non-boolean reduceMotion is dropped", () => {
    const out = normalizeTheme({ reduceMotion: "true" });
    expect(out.reduceMotion).toBeUndefined();
  });
});

describe("normalizeTheme — forward compatibility", () => {
  it("preserves unknown top-level keys", () => {
    const out = normalizeTheme({ futureFeature: { x: 1 } }) as unknown as Record<
      string,
      unknown
    >;
    expect(out.futureFeature).toEqual({ x: 1 });
  });

  it("preserves unknown dock keys", () => {
    const out = normalizeTheme({ dock: { futureDockSetting: 42 } });
    expect((out.dock as unknown as Record<string, unknown>).futureDockSetting).toBe(42);
  });
});

describe("normalizeTheme — idempotent", () => {
  it("running twice yields the same result", () => {
    const seeds: unknown[] = [
      {},
      { mode: "light" },
      { fontScale: 5 }, // clamps
      { dock: { order: ["a", "b"] } },
      { futureFeature: { x: 1 } },
      { reduceMotion: true },
    ];
    for (const seed of seeds) {
      const once = normalizeTheme(seed);
      const twice = normalizeTheme(once);
      expect(twice).toEqual(once);
    }
  });
});
