// ============================================================
// SelectionLasso — translucent rectangle drawn over a container
// ============================================================
//
// Pure presentation. Coordinates are container-relative; the parent
// is expected to be `position: relative`. No state of its own —
// caller owns the (start, cursor, active) tuple and re-renders.

import { memo } from "react";
import { lassoRect } from "@/lib/selection";

interface SelectionLassoProps {
  active: boolean;
  start: { x: number; y: number };
  cursor: { x: number; y: number };
}

const SelectionLasso = memo(function SelectionLasso({
  active,
  start,
  cursor,
}: SelectionLassoProps) {
  if (!active) return null;
  const r = lassoRect(start, cursor);
  return (
    <div
      aria-hidden
      className="absolute pointer-events-none rounded-sm"
      style={{
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        background: "rgba(124,77,255,0.12)",
        border: "1px solid var(--accent-primary)",
        zIndex: 50,
      }}
    />
  );
});

export default SelectionLasso;
