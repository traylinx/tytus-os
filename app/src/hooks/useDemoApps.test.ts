import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDemoApps } from "@/hooks/useDemoApps";

const STORAGE_KEY = "tytus_show_demo_apps";

describe("useDemoApps — tier-aware default (Phase 10 AN8)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults ON for Explorer when no stored choice", () => {
    const { result } = renderHook(() => useDemoApps("explorer"));
    expect(result.current.showDemoApps).toBe(true);
  });

  it("defaults OFF for Creator when no stored choice", () => {
    const { result } = renderHook(() => useDemoApps("creator"));
    expect(result.current.showDemoApps).toBe(false);
  });

  it("defaults OFF for Operator when no stored choice", () => {
    const { result } = renderHook(() => useDemoApps("operator"));
    expect(result.current.showDemoApps).toBe(false);
  });

  it("defaults ON when tier is undefined (pre-state-load)", () => {
    // Hook may mount before /api/state lands. We don't want to flash
    // demo-apps OFF for Explorer/unknown users in that window.
    const { result } = renderHook(() => useDemoApps(undefined));
    expect(result.current.showDemoApps).toBe(true);
  });

  it("flips OFF when tier resolves to operator after first mount", () => {
    // Pre-state-load: undefined → ON. Post-state-load: operator → OFF.
    // The user has never explicitly toggled, so the new tier default
    // must apply.
    const { result, rerender } = renderHook(
      ({ tier }: { tier: string | null | undefined }) => useDemoApps(tier),
      {
        initialProps: { tier: undefined as string | null | undefined },
      },
    );
    expect(result.current.showDemoApps).toBe(true);
    rerender({ tier: "operator" });
    expect(result.current.showDemoApps).toBe(false);
  });

  it("explicit user choice overrides tier default", () => {
    // Pre-condition: operator + stored "true" (user explicitly enabled
    // demos despite paid tier). The stored choice must win.
    localStorage.setItem(STORAGE_KEY, "true");
    const { result } = renderHook(() => useDemoApps("operator"));
    expect(result.current.showDemoApps).toBe(true);
  });

  it("explicit OFF on Explorer still wins over tier default", () => {
    localStorage.setItem(STORAGE_KEY, "false");
    const { result } = renderHook(() => useDemoApps("explorer"));
    expect(result.current.showDemoApps).toBe(false);
  });

  it("setShowDemoApps persists + makes the stored choice explicit", () => {
    const { result, rerender } = renderHook(
      ({ tier }: { tier: string | null | undefined }) => useDemoApps(tier),
      {
        initialProps: { tier: "explorer" as string | null | undefined },
      },
    );
    expect(result.current.showDemoApps).toBe(true);
    act(() => result.current.setShowDemoApps(false));
    expect(result.current.showDemoApps).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
    // Even when tier flips back, the stored explicit choice wins.
    rerender({ tier: "operator" });
    expect(result.current.showDemoApps).toBe(false);
  });
});
