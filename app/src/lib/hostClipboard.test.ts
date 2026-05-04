import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectBrowserName, probePermission, readClipboard } from "./hostClipboard";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "no daemon" }), { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectBrowserName", () => {
  it("detects Chrome", () => {
    expect(detectBrowserName("Mozilla/5.0 Chrome/124.0")).toBe("Chrome");
  });
  it("detects Safari", () => {
    expect(detectBrowserName("Mozilla/5.0 Safari/605.1.15")).toBe("Safari");
  });
  it("detects Firefox", () => {
    expect(detectBrowserName("Mozilla/5.0 Firefox/124.0")).toBe("Firefox");
  });
  it("detects Edge", () => {
    expect(detectBrowserName("Mozilla/5.0 Chrome/124.0 Edg/124.0")).toBe("Edge");
  });
  it("detects Opera before Chrome (UA contains both)", () => {
    expect(detectBrowserName("Mozilla/5.0 Chrome/124.0 OPR/110.0")).toBe("Opera");
  });
  it("falls back to 'browser' on empty UA", () => {
    expect(detectBrowserName("")).toBe("browser");
  });
});

describe("probePermission", () => {
  it("returns 'prompt' when Permissions API is unavailable", async () => {
    vi.stubGlobal("navigator", {} as Navigator);
    expect(await probePermission()).toBe("prompt");
  });

  it("returns 'granted' when Permissions API says granted", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "granted" }),
      },
    } as unknown as Navigator);
    expect(await probePermission()).toBe("granted");
  });

  it("returns 'denied' when Permissions API says denied", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "denied" }),
      },
    } as unknown as Navigator);
    expect(await probePermission()).toBe("denied");
  });

  it("returns 'prompt' when Permissions API throws (Firefox path)", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockRejectedValue(new Error("clipboard-read unknown")),
      },
    } as unknown as Navigator);
    expect(await probePermission()).toBe("prompt");
  });
});

describe("readClipboard", () => {
  it("prefers daemon-native text clipboard when available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "native text" }), { status: 200 })));
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/124" } as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(true);
    expect(r.permission).toBe("granted");
    expect(r.payload).toEqual({ kind: "text", text: "native text" });
  });

  it("falls back to browser clipboard when daemon-native clipboard is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "missing" }), { status: 404 })));
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Firefox/124",
      clipboard: { readText: vi.fn().mockResolvedValue("browser text") },
    } as unknown as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({ kind: "text", text: "browser text" });
  });

  it("returns unavailable when navigator.clipboard is missing", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/124" } as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unavailable");
    expect(r.permission).toBe("denied");
  });

  it("reads image from clipboard.read()", async () => {
    const blob = new Blob(["x"], { type: "image/png" });
    const item = {
      types: ["image/png"],
      getType: vi.fn().mockResolvedValue(blob),
    };
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Chrome/124",
      clipboard: {
        read: vi.fn().mockResolvedValue([item]),
      },
    } as unknown as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(true);
    expect(r.permission).toBe("granted");
    expect(r.payload.kind).toBe("image");
    if (r.payload.kind === "image") {
      expect(r.payload.suggestedName).toMatch(/^pasted-\d{8}-\d{6}\.png$/);
    }
  });

  it("reads text when clipboard.read() yields only text", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const item = {
      types: ["text/plain"],
      getType: vi.fn().mockResolvedValue(blob),
    };
    // Force JSDOM Blob → text() works
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Chrome/124",
      clipboard: {
        read: vi.fn().mockResolvedValue([item]),
      },
    } as unknown as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(true);
    expect(r.payload.kind).toBe("text");
    if (r.payload.kind === "text") {
      expect(r.payload.text).toBe("hello");
    }
  });

  it("returns permission-denied on NotAllowedError", async () => {
    const err = new Error("not allowed");
    err.name = "NotAllowedError";
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Chrome/124",
      clipboard: {
        read: vi.fn().mockRejectedValue(err),
      },
    } as unknown as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("permission-denied");
    expect(r.permission).toBe("denied");
  });

  it("falls back to readText when read() is missing (Firefox)", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Firefox/124",
      clipboard: {
        readText: vi.fn().mockResolvedValue("from-firefox"),
      },
    } as unknown as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(true);
    expect(r.payload.kind).toBe("text");
    if (r.payload.kind === "text") {
      expect(r.payload.text).toBe("from-firefox");
    }
    expect(r.browserName).toBe("Firefox");
  });

  it("permission-recovery: read succeeds even though cache said denied", async () => {
    // The function itself doesn't read a cache — it returns the
    // observed permission. Caller upgrades cache. We assert that a
    // successful read always returns permission='granted'.
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Chrome/124",
      clipboard: {
        readText: vi.fn().mockResolvedValue("recovered"),
      },
    } as unknown as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(true);
    expect(r.permission).toBe("granted");
  });

  it("returns reason='empty' when clipboard has no usable content", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Chrome/124",
      clipboard: {
        readText: vi.fn().mockResolvedValue(""),
      },
    } as unknown as Navigator);
    const r = await readClipboard();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("empty");
  });
});
