// ============================================================
// useDnd — React hooks wrapping native HTML5 DnD around lib/dnd
// ============================================================
//
// `useDragSource` and `useDropTarget` produce ready-to-spread props
// for any element. They're thin: every payload encoding/decoding
// happens in `lib/dnd.ts`, every drop-allow gate happens via
// `canAccept`. The hook is what supplies the React-shaped
// onDragStart/onDragOver/onDrop wiring + an `isOver` boolean for
// drop-indicator rendering.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  canAccept,
  detectKind,
  parsePayload,
  serializePayload,
  type DnDKind,
  type DnDPayload,
  type DropTargetKind,
} from "@/lib/dnd";

// ── useDragSource ─────────────────────────────────────────

export interface DragSourceOptions {
  /** Resolved at drag-start time. Return null to abort the drag. */
  payload: DnDPayload | (() => DnDPayload | null);
  effect?: "copy" | "move" | "link" | "copyMove";
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

export interface DragSourceProps {
  draggable: true;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

export function useDragSource(opts: DragSourceOptions): DragSourceProps {
  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      const payload =
        typeof opts.payload === "function" ? opts.payload() : opts.payload;
      if (!payload) {
        e.preventDefault();
        return;
      }
      try {
        e.dataTransfer.effectAllowed = opts.effect ?? "copy";
      } catch {
        // Some browsers throw if you set effectAllowed late; ignore.
      }
      serializePayload(e.dataTransfer, payload);
      opts.onDragStart?.(e);
    },
    [opts],
  );

  const onDragEnd = useCallback(
    (e: React.DragEvent) => {
      opts.onDragEnd?.(e);
    },
    [opts],
  );

  return useMemo(
    () => ({ draggable: true, onDragStart, onDragEnd }),
    [onDragStart, onDragEnd],
  );
}

// ── useDropTarget ─────────────────────────────────────────

export interface DropTargetOptions {
  /**
   * Conceptual target name from the drop matrix. Determines which
   * payload kinds are accepted. If the dragged kind isn't accepted,
   * `onDragOver` does NOT call `preventDefault()` so the drop is
   * rejected at the browser level.
   */
  target: DropTargetKind;
  /** Called on a successful drop with the parsed payload. */
  onDrop: (payload: DnDPayload, e: React.DragEvent) => void;
  /** Optional override of dropEffect — defaults to 'copy'. */
  effect?: "copy" | "move" | "link" | "none";
  /** Allowed kinds restriction layered on top of the matrix. */
  acceptKinds?: ReadonlySet<DnDKind>;
  onDragEnter?: (kind: DnDKind, e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
}

export interface DropTargetProps {
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export interface DropTargetState {
  /** Cursor currently over this target with an acceptable payload. */
  isOver: boolean;
  /** Kind being dragged, if any. */
  hoveringKind: DnDKind | null;
}

export function useDropTarget(
  opts: DropTargetOptions,
): [DropTargetProps, DropTargetState] {
  const [state, setState] = useState<DropTargetState>({
    isOver: false,
    hoveringKind: null,
  });
  // Track enter/leave depth — `dragenter` fires for every child
  // element entered; without a counter the leave handler resets
  // state mid-hover.
  const depth = useRef(0);

  const isAcceptable = useCallback(
    (kind: DnDKind | null): boolean => {
      if (!kind) return false;
      if (!canAccept(opts.target, kind)) return false;
      if (opts.acceptKinds && !opts.acceptKinds.has(kind)) return false;
      return true;
    },
    [opts.target, opts.acceptKinds],
  );

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      depth.current++;
      const kind = detectKind(e.dataTransfer);
      if (!isAcceptable(kind)) return;
      e.preventDefault();
      setState({ isOver: true, hoveringKind: kind });
      if (kind) opts.onDragEnter?.(kind, e);
    },
    [isAcceptable, opts],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      const kind = detectKind(e.dataTransfer);
      if (!isAcceptable(kind)) return;
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = opts.effect ?? "copy";
      } catch {}
    },
    [isAcceptable, opts.effect],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setState({ isOver: false, hoveringKind: null });
        opts.onDragLeave?.(e);
      }
    },
    [opts],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      depth.current = 0;
      setState({ isOver: false, hoveringKind: null });
      const payload = parsePayload(e.dataTransfer);
      if (!payload || !isAcceptable(payload.kind)) return;
      e.preventDefault();
      e.stopPropagation();
      opts.onDrop(payload, e);
    },
    [isAcceptable, opts],
  );

  const props = useMemo<DropTargetProps>(
    () => ({ onDragOver, onDragEnter, onDragLeave, onDrop }),
    [onDragOver, onDragEnter, onDragLeave, onDrop],
  );

  return [props, state];
}
