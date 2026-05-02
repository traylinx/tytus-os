// ============================================================
// Selection — generic multi-select hook + lasso math
// ============================================================
//
// Selection state is *component-local* by design: the OS reducer
// shouldn't care which Desktop icons are highlighted while a
// FileManager pane is also open. Every consumer keys items by
// stable ref (`refKey(ref)` for FileRef, icon id for Desktop).
//
// Three input modalities — captured once here so Desktop and
// FileManager don't both reinvent them:
//
//   • lasso        — mouse drag on empty area; rect intersect
//   • shift-click  — anchor + click extend in display order
//   • cmd/ctrl-click — toggle one in/out of the existing selection

import { useCallback, useMemo, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SelectionAPI<T> {
  selectedKeys: ReadonlySet<string>;
  isSelected: (item: T) => boolean;
  size: number;
  /** Replace selection with this single item. */
  selectOne: (item: T) => void;
  /** Cmd/Ctrl-click — toggle one in/out, anchor moves to it. */
  toggle: (item: T) => void;
  /** Shift-click — select range in display order from anchor → target. */
  rangeFrom: (target: T, ordered: readonly T[]) => void;
  /** Replace selection with a fresh batch. */
  replace: (items: readonly T[]) => void;
  /** Empty-area click / Esc. */
  clear: () => void;
  /** Selected items in their display order. */
  selectedItems: (ordered: readonly T[]) => T[];
}

// ── Hook ──────────────────────────────────────────────────

export function useSelection<T>(opts: {
  keyOf: (item: T) => string;
}): SelectionAPI<T> {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Anchor for shift-click range extension. Tracked as a key, not
  // an item, so the anchor survives if the items array re-orders.
  const anchorRef = useRef<string | null>(null);

  const isSelected = useCallback(
    (item: T) => keys.has(opts.keyOf(item)),
    [keys, opts],
  );

  const selectOne = useCallback(
    (item: T) => {
      const k = opts.keyOf(item);
      anchorRef.current = k;
      setKeys(new Set([k]));
    },
    [opts],
  );

  const toggle = useCallback(
    (item: T) => {
      const k = opts.keyOf(item);
      anchorRef.current = k;
      setKeys((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
    },
    [opts],
  );

  const rangeFrom = useCallback(
    (target: T, ordered: readonly T[]) => {
      const targetKey = opts.keyOf(target);
      const anchorKey = anchorRef.current;
      if (!anchorKey) {
        // No anchor yet — fall back to single-select.
        anchorRef.current = targetKey;
        setKeys(new Set([targetKey]));
        return;
      }
      const orderedKeys = ordered.map(opts.keyOf);
      const a = orderedKeys.indexOf(anchorKey);
      const b = orderedKeys.indexOf(targetKey);
      if (a < 0 || b < 0) {
        anchorRef.current = targetKey;
        setKeys(new Set([targetKey]));
        return;
      }
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setKeys(new Set(orderedKeys.slice(lo, hi + 1)));
    },
    [opts],
  );

  const replace = useCallback(
    (items: readonly T[]) => {
      const next = new Set(items.map(opts.keyOf));
      anchorRef.current =
        items.length > 0 ? opts.keyOf(items[items.length - 1]) : null;
      setKeys(next);
    },
    [opts],
  );

  const clear = useCallback(() => {
    anchorRef.current = null;
    setKeys(new Set());
  }, []);

  const selectedItems = useCallback(
    (ordered: readonly T[]) => ordered.filter((it) => keys.has(opts.keyOf(it))),
    [keys, opts],
  );

  return useMemo(
    () => ({
      selectedKeys: keys,
      isSelected,
      size: keys.size,
      selectOne,
      toggle,
      rangeFrom,
      replace,
      clear,
      selectedItems,
    }),
    [
      keys,
      isSelected,
      selectOne,
      toggle,
      rangeFrom,
      replace,
      clear,
      selectedItems,
    ],
  );
}

// ── Lasso math ────────────────────────────────────────────

/**
 * Build a normalised rect from two corner points. The lasso
 * rectangle is drawn between mousedown coords and current cursor,
 * which can yield negative width/height — this normalises so
 * downstream rect-intersect math doesn't have to special-case.
 */
export function lassoRect(
  start: { x: number; y: number },
  cursor: { x: number; y: number },
): Rect {
  const x1 = Math.min(start.x, cursor.x);
  const y1 = Math.min(start.y, cursor.y);
  const x2 = Math.max(start.x, cursor.x);
  const y2 = Math.max(start.y, cursor.y);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Standard AABB rect intersection test. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  if (a.x + a.w < b.x) return false;
  if (b.x + b.w < a.x) return false;
  if (a.y + a.h < b.y) return false;
  if (b.y + b.h < a.y) return false;
  return true;
}

/**
 * Pure helper: filter items by bounding-rect intersection with the
 * lasso rect. Item rects are typically computed once per frame from
 * `getBoundingClientRect()`.
 */
export function itemsInLasso<T>(
  items: ReadonlyArray<{ ref: T; rect: Rect }>,
  lasso: Rect,
): T[] {
  const out: T[] = [];
  for (const it of items) {
    if (rectsIntersect(it.rect, lasso)) out.push(it.ref);
  }
  return out;
}

/** Convert a DOM element + container to a relative rect. */
export function rectOf(el: Element, container?: Element | null): Rect {
  const r = el.getBoundingClientRect();
  const c = container?.getBoundingClientRect();
  if (c) {
    return { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height };
  }
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}
