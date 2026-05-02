import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  itemsInLasso,
  lassoRect,
  rectsIntersect,
  useSelection,
} from "./selection";

describe("lassoRect", () => {
  it("normalises drag direction", () => {
    expect(lassoRect({ x: 10, y: 10 }, { x: 50, y: 60 })).toEqual({
      x: 10,
      y: 10,
      w: 40,
      h: 50,
    });
    expect(lassoRect({ x: 50, y: 60 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      w: 40,
      h: 50,
    });
  });
});

describe("rectsIntersect", () => {
  it("touching corners count as intersection", () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 10, y: 10, w: 10, h: 10 },
      ),
    ).toBe(true);
  });
  it("disjoint rects do not intersect", () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 100, y: 100, w: 10, h: 10 },
      ),
    ).toBe(false);
  });
});

describe("itemsInLasso", () => {
  it("returns items whose rect intersects the lasso", () => {
    const items = [
      { ref: "a", rect: { x: 0, y: 0, w: 50, h: 50 } },
      { ref: "b", rect: { x: 60, y: 0, w: 50, h: 50 } },
      { ref: "c", rect: { x: 200, y: 200, w: 50, h: 50 } },
    ];
    expect(itemsInLasso(items, { x: 10, y: 10, w: 80, h: 30 })).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("useSelection", () => {
  type Item = { id: string };
  const items: Item[] = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" },
    { id: "e" },
  ];
  const keyOf = (i: Item) => i.id;

  it("selectOne replaces selection + sets anchor", () => {
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.selectOne(items[1]));
    expect(result.current.size).toBe(1);
    expect(result.current.isSelected(items[1])).toBe(true);
    expect(result.current.isSelected(items[0])).toBe(false);
  });

  it("toggle adds and removes one item", () => {
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.toggle(items[0]));
    act(() => result.current.toggle(items[2]));
    expect(result.current.size).toBe(2);
    act(() => result.current.toggle(items[0]));
    expect(result.current.size).toBe(1);
    expect(result.current.isSelected(items[2])).toBe(true);
  });

  it("rangeFrom selects the inclusive range from anchor to target", () => {
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.selectOne(items[1])); // anchor at b
    act(() => result.current.rangeFrom(items[3], items)); // → b..d
    expect(Array.from(result.current.selectedKeys).sort()).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("rangeFrom works backward (target above anchor)", () => {
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.selectOne(items[3])); // anchor at d
    act(() => result.current.rangeFrom(items[0], items)); // → a..d
    expect(Array.from(result.current.selectedKeys).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("rangeFrom with no anchor falls back to single-select", () => {
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.rangeFrom(items[2], items));
    expect(result.current.size).toBe(1);
    expect(result.current.isSelected(items[2])).toBe(true);
  });

  it("clear empties selection + anchor", () => {
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.selectOne(items[1]));
    act(() => result.current.clear());
    expect(result.current.size).toBe(0);
  });

  it("replace swaps the entire selection", () => {
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.selectOne(items[0]));
    act(() => result.current.replace([items[2], items[4]]));
    expect(Array.from(result.current.selectedKeys).sort()).toEqual(["c", "e"]);
  });

  it("selectedItems preserves display order", () => {
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.replace([items[3], items[1], items[4]]));
    expect(result.current.selectedItems(items).map(keyOf)).toEqual([
      "b",
      "d",
      "e",
    ]);
  });

  it("100-item shift-range completes well under a frame", () => {
    const big: Item[] = Array.from({ length: 100 }, (_, i) => ({
      id: `i${i}`,
    }));
    const { result } = renderHook(() => useSelection({ keyOf }));
    act(() => result.current.selectOne(big[0]));
    const t0 = performance.now();
    act(() => result.current.rangeFrom(big[99], big));
    const dt = performance.now() - t0;
    expect(result.current.size).toBe(100);
    expect(dt).toBeLessThan(16);
  });
});
