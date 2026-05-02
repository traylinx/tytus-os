// ============================================================
// DragGhost — fixed-position cursor-following multi-item label
// ============================================================
//
// Native HTML5 drag images are static-bitmap snapshots taken at
// drag-start. They're fine for "one row" but they look weird for
// multi-select drags ("5 items" badge) because the browser can't
// re-render the bitmap after the drag begins. Rather than fight
// `setDragImage`, we render the entire OS-level ghost in the React
// tree as a fixed-position layer that listens to `dragover` on the
// document and follows the cursor.
//
// Mounted once in App.tsx so any drag source can request a ghost
// via the imperative API:
//
//     showDragGhost({ label: 'notes.md', count: 1, icon });
//     hideDragGhost();
//
// We hide the native drag image via `setDragImage` to a 1×1 blank
// pixel so the cursor only carries our React-rendered ghost.

import { memo, useEffect, useState } from "react";
import { File as FileIcon } from "lucide-react";

interface GhostState {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  count: number;
}

let setGhost: ((g: GhostState) => void) | null = null;
let ghostState: GhostState = { visible: false, x: 0, y: 0, label: "", count: 0 };

/** Imperative API used by drag sources. */
export function showDragGhost(opts: { label: string; count?: number }): void {
  ghostState = {
    visible: true,
    x: ghostState.x,
    y: ghostState.y,
    label: opts.label,
    count: opts.count ?? 1,
  };
  setGhost?.(ghostState);
}

export function hideDragGhost(): void {
  ghostState = { ...ghostState, visible: false };
  setGhost?.(ghostState);
}

/**
 * Helper: assign a 1×1 transparent drag image to the event so the
 * browser stops painting its own ghost. Call this from
 * `onDragStart`.
 */
const blankImg: HTMLImageElement | null = (() => {
  if (typeof document === "undefined") return null;
  const img = new Image();
  img.src =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";
  return img;
})();
export function suppressNativeDragImage(e: React.DragEvent): void {
  if (blankImg) {
    e.dataTransfer.setDragImage(blankImg, 0, 0);
  }
}

const DragGhost = memo(function DragGhost() {
  const [g, setG] = useState<GhostState>(ghostState);

  useEffect(() => {
    setGhost = (next) => setG({ ...next });
    return () => {
      if (setGhost === setG) setGhost = null;
    };
  }, []);

  useEffect(() => {
    if (!g.visible) return;
    const onMove = (e: DragEvent) => {
      ghostState = { ...ghostState, x: e.clientX, y: e.clientY };
      setG((prev) => ({ ...prev, x: e.clientX, y: e.clientY }));
    };
    const onEnd = () => {
      ghostState = { ...ghostState, visible: false };
      setG((prev) => ({ ...prev, visible: false }));
    };
    document.addEventListener("dragover", onMove);
    document.addEventListener("dragend", onEnd);
    document.addEventListener("drop", onEnd);
    return () => {
      document.removeEventListener("dragover", onMove);
      document.removeEventListener("dragend", onEnd);
      document.removeEventListener("drop", onEnd);
    };
  }, [g.visible]);

  if (!g.visible) return null;
  return (
    <div
      // z-[10000] — above everything including modals; pointer-events
      // none so the ghost never interferes with the actual drop.
      className="fixed z-[10000] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium"
      style={{
        left: g.x + 12,
        top: g.y + 12,
        background: "rgba(45,45,45,0.92)",
        border: "1px solid var(--border-default)",
        color: "var(--text-primary)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      <FileIcon size={14} />
      <span>{g.label}</span>
      {g.count > 1 && (
        <span
          className="px-1.5 rounded-full text-[10px] font-bold"
          style={{
            background: "var(--accent-primary)",
            color: "var(--text-on-accent)",
          }}
        >
          {g.count}
        </span>
      )}
    </div>
  );
});

export default DragGhost;
