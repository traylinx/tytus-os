// ============================================================
// WindowFrame — Draggable, resizable window chrome
// ============================================================

import { useCallback, useRef, useState, memo, useEffect } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { SnapKind, Window } from '@/types';
import { useOS } from '@/hooks/useOSStore';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { BrandIcon, isBrandIconName } from './BrandIcon';
import { getAppById } from '@/apps/registry';

const TOP_PANEL_HEIGHT = 28;
const HANDLE = 6;
const CORNER = 14;
const MIN_W = 320;
const MIN_H = 200;
// Sprint B Phase 6.1 — snap thresholds. While dragging a window's title
// bar, hovering the cursor within SNAP_EDGE_PX of a viewport edge shows
// the snap-target overlay. Drop snaps the window into that region.
const SNAP_EDGE_PX = 30;

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  if (isBrandIconName(name)) {
    return <BrandIcon name={name} size={(props.size as number) ?? 16} className={props.className} />;
  }
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  return IconComp ? <IconComp {...props} /> : <Icons.HelpCircle {...props} />;
};

interface WindowFrameProps {
  window: Window;
  children: React.ReactNode;
}

const WindowFrame = memo(function WindowFrame({ window: win, children }: WindowFrameProps) {
  const { dispatch } = useOS();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; lastX: number; lastY: number; dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ edge: Edge; startX: number; startY: number; origW: number; origH: number; origX: number; origY: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingTransformRef = useRef<{ dx: number; dy: number } | null>(null);
  const snapCandidateRef = useRef<SnapKind | null>(null);
  const dragNativeCleanupRef = useRef<(() => void) | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  // Sprint B Phase 6.1 — current snap candidate (cursor near edge during
  // an active drag). Drop while non-null commits the snap; otherwise the
  // drag falls through to a normal MOVE_WINDOW.
  const [snapCandidate, setSnapCandidate] = useState<SnapKind | null>(null);

  const isMaximized = win.state === 'maximized';
  const isMinimized = win.state === 'minimized';
  const isFocused = win.isFocused;

  const focusThis = useCallback(() => {
    if (!win.isFocused) {
      dispatch({ type: 'FOCUS_WINDOW', windowId: win.id });
    }
  }, [dispatch, win.id, win.isFocused]);

  // Outer mousedown: focus the window. We intentionally do NOT preventDefault here
  // so child onMouseDown handlers (title drag, button click, resize edges) still run.
  const handleFrameMouseDown = useCallback(() => {
    focusThis();
  }, [focusThis]);

  const applyDragTransform = useCallback((dx: number, dy: number) => {
    // Direct write, no RAF: for window dragging, newest pointer position should
    // be visible immediately. Browser compositor coalesces paints itself.
    const el = frameRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  }, []);

  const setSnapCandidateFast = useCallback((next: SnapKind | null) => {
    if (snapCandidateRef.current === next) return;
    snapCandidateRef.current = next;
    setSnapCandidate(next);
  }, []);

  const updateDragFromPointer = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rawDx = clientX - drag.startX;
    const rawDy = clientY - drag.startY;
    let nx = drag.origX + rawDx;
    let ny = drag.origY + rawDy;
    const vw = window.innerWidth;
    ny = Math.max(TOP_PANEL_HEIGHT, ny);
    nx = Math.min(Math.max(nx, -(win.size.width - 100)), vw - 100);
    const dx = nx - drag.origX;
    const dy = ny - drag.origY;
    drag.lastX = nx;
    drag.lastY = ny;
    drag.dx = dx;
    drag.dy = dy;
    applyDragTransform(dx, dy);

    let nextCand: SnapKind | null = null;
    if (clientX <= SNAP_EDGE_PX) nextCand = 'left';
    else if (clientX >= vw - SNAP_EDGE_PX) nextCand = 'right';
    else if (clientY <= TOP_PANEL_HEIGHT + SNAP_EDGE_PX) nextCand = 'top';
    setSnapCandidateFast(nextCand);
  }, [applyDragTransform, setSnapCandidateFast, win.size.width]);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    const el = frameRef.current;
    if (!drag) return;
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingTransformRef.current = null;

    const snap = snapCandidateRef.current;
    flushSync(() => {
      if (!win.isFocused) dispatch({ type: 'FOCUS_WINDOW', windowId: win.id });
      if (snap) {
        dispatch({ type: 'SNAP_WINDOW', windowId: win.id, kind: snap });
      } else {
        dispatch({ type: 'MOVE_WINDOW', windowId: win.id, position: { x: drag.lastX, y: drag.lastY } });
      }
    });

    if (el) {
      el.style.transform = '';
      el.style.willChange = '';
      el.style.transition = '';
      el.style.zIndex = '';
      el.dataset.windowDragging = '';
      delete el.dataset.windowDragging;
    }
    dragNativeCleanupRef.current?.();
    dragNativeCleanupRef.current = null;
    dragRef.current = null;
    setIsDragging(false);
    snapCandidateRef.current = null;
    setSnapCandidate(null);
  }, [dispatch, win.id, win.isFocused]);

  // ---- Drag from title bar ----
  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      e.preventDefault();
      // Do not bubble into the frame's focus handler here. A focus reducer
      // render at drag-start is exactly what makes the window feel like it
      // waits behind the cursor. We optimistically raise via DOM style and
      // commit real focus on mouseup.
      e.stopPropagation();

      dragNativeCleanupRef.current?.();
      setIsDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: win.position.x,
        origY: win.position.y,
        lastX: win.position.x,
        lastY: win.position.y,
        dx: 0,
        dy: 0,
      };
      snapCandidateRef.current = null;
      setSnapCandidate(null);

      const el = frameRef.current;
      if (el) {
        el.style.willChange = 'transform';
        el.style.transition = 'none';
        if (!win.isFocused) el.style.zIndex = String(win.zIndex + 10_000);
        el.dataset.windowDragging = 'true';
      }

      const move = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        ev.preventDefault();
        updateDragFromPointer(ev.clientX, ev.clientY);
      };
      const up = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        ev.preventDefault();
        finishDrag();
      };
      // Capture phase wins over app content and avoids React synthetic-event
      // scheduling entirely. This is the simple native desktop drag loop:
      // mousedown -> direct DOM transform on mousemove -> reducer commit once.
      window.addEventListener('mousemove', move, { passive: false, capture: true });
      window.addEventListener('mouseup', up, { passive: false, capture: true });
      dragNativeCleanupRef.current = () => {
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
      };
    },
    [finishDrag, isMaximized, updateDragFromPointer, win.isFocused, win.position.x, win.position.y, win.zIndex]
  );

  // ---- Resize from edge handles ----
  const startResize = useCallback(
    (edge: Edge) => (e: React.MouseEvent) => {
      if (isMaximized) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        origW: win.size.width,
        origH: win.size.height,
        origX: win.position.x,
        origY: win.position.y,
      };
      setIsResizing(true);
    },
    [isMaximized, win.size.width, win.size.height, win.position.x, win.position.y]
  );

  // ---- Global mouse events for drag/resize ----
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (resizeRef.current) {
        const { edge, startX, startY, origW, origH, origX, origY } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let nx = origX, ny = origY, nw = origW, nh = origH;
        if (edge.includes('e')) nw = Math.max(MIN_W, origW + dx);
        if (edge.includes('s')) nh = Math.max(MIN_H, origH + dy);
        if (edge.includes('w')) {
          nw = Math.max(MIN_W, origW - dx);
          nx = origX + (origW - nw);
        }
        if (edge.includes('n')) {
          nh = Math.max(MIN_H, origH - dy);
          ny = origY + (origH - nh);
          ny = Math.max(TOP_PANEL_HEIGHT, ny);
        }
        dispatch({ type: 'MOVE_WINDOW', windowId: win.id, position: { x: nx, y: ny } });
        dispatch({ type: 'RESIZE_WINDOW', windowId: win.id, size: { width: nw, height: nh } });
      }
    };
    const onUp = () => {
      if (dragRef.current) finishDrag();
      resizeRef.current = null;
      setIsResizing(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dispatch, finishDrag, win.id, win.size.width, win.size.height]);

  const handleMinimize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch({ type: 'MINIMIZE_WINDOW', windowId: win.id });
    },
    [dispatch, win.id]
  );

  const handleMaximize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isMaximized) {
        dispatch({ type: 'RESTORE_WINDOW', windowId: win.id });
      } else {
        dispatch({ type: 'MAXIMIZE_WINDOW', windowId: win.id });
      }
    },
    [dispatch, win.id, isMaximized]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch({ type: 'CLOSE_WINDOW', windowId: win.id });
    },
    [dispatch, win.id]
  );

  const handleDoubleClickTitle = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      if (isMaximized) {
        dispatch({ type: 'RESTORE_WINDOW', windowId: win.id });
      } else {
        dispatch({ type: 'MAXIMIZE_WINDOW', windowId: win.id });
      }
    },
    [dispatch, win.id, isMaximized]
  );

  if (isMinimized) return null;

  // Edge handles: only the actual edges intercept clicks. The center of the
  // window stays untouched so the title bar / body get their events.
  const showHandles = !isMaximized;

  // Maximized windows use viewport-relative CSS so they auto-track browser resize
  // without needing a JS resize listener. Stored size only applies when 'normal'.
  // macOS-style fullscreen: window extends to the viewport bottom and the dock
  // floats on top of it (the dock's backdrop-blur keeps content visible
  // beneath, and Dock.tsx pins itself above any window's z-index).
  const frameStyle: React.CSSProperties = isMaximized
    ? {
        left: 0,
        top: TOP_PANEL_HEIGHT,
        width: '100vw',
        height: `calc(100vh - ${TOP_PANEL_HEIGHT}px)`,
        zIndex: win.zIndex,
        borderRadius: 0,
      }
    : {
        left: win.position.x,
        top: win.position.y,
        width: win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
        // Window radius — token from src/index.css (rounded-lg = 12px).
        borderRadius: 'var(--radius-lg)',
      };

  return (
    <div
      ref={frameRef}
      className="absolute flex flex-col select-none"
      data-window-id={win.id}
      data-app-id={win.appId}
      data-window-title={win.title}
      data-window-dragging={isDragging ? 'true' : undefined}
      data-window-resizing={isResizing ? 'true' : undefined}
      style={{
        ...frameStyle,
        border: `1px solid ${isFocused ? 'var(--border-default)' : 'var(--border-subtle)'}`,
        boxShadow: isFocused
          ? 'var(--chrome-shadow-focused)'
          : 'var(--chrome-shadow-unfocused)',
        // Inline transition kept for legacy fallback; the snap-tween
        // CSS in window-animations.css takes over for non-drag frames.
        transition: isDragging || isResizing ? 'none' : 'box-shadow 150ms ease, border-color 150ms ease',
        overflow: 'hidden',
        contain: 'layout paint style',
        backfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
      }}
      onMouseDown={handleFrameMouseDown}
    >
      {/* Title bar */}
      <div
        className="relative z-10 flex items-center justify-between shrink-0"
        style={{
          height: 36,
          background: isFocused ? 'var(--chrome-bg-active)' : 'var(--chrome-bg-inactive)',
          borderRadius: isMaximized ? 0 : 'var(--radius-lg) var(--radius-lg) 0 0',
          transition: 'background 150ms ease',
          cursor: isMaximized ? 'default' : isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onMouseDown={handleTitleMouseDown}
        onDoubleClick={handleDoubleClickTitle}
      >
        {/* Left: icon + title. Resolved live from the app registry so a
            rename / re-icon (e.g. JULI3TA mark + uppercase wordmark)
            propagates without forcing the user to close and re-open
            every window — `win.icon` / `win.title` are snapshotted at
            window-open time and otherwise stay stale. Falls back to the
            persisted values for windows that don't map to a known app. */}
        {(() => {
          const appDef = getAppById(win.appId);
          const liveIcon = appDef?.icon ?? win.icon;
          const liveTitle = appDef?.name ?? win.title;
          return (
            <div className="flex items-center gap-2 px-3 overflow-hidden pointer-events-none">
              <DynamicIcon name={liveIcon} size={16} className="text-[var(--text-secondary)] shrink-0" />
              <span
                className="text-xs font-semibold truncate"
                style={{
                  color: isFocused ? 'var(--text-primary)' : 'var(--text-secondary)',
                  transition: 'color 150ms ease',
                }}
              >
                {liveTitle}
              </span>
            </div>
          );
        })()}

        {/* Right: window controls */}
        <div className="flex items-center shrink-0">
          <button
            onClick={handleMinimize}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Minimize"
            aria-label="Minimize"
          >
            <Icons.Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Icons.Copy size={12} /> : <Icons.Square size={12} />}
          </button>
          <button
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] transition-colors"
            style={{ borderRadius: isMaximized ? 0 : '0 var(--radius-lg) 0 0' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#F44336';
              e.currentTarget.style.color = 'var(--text-on-accent, white)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title="Close"
            aria-label="Close"
          >
            <Icons.X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className="relative z-10 flex-1 overflow-hidden"
        style={{
          background: 'var(--bg-window)',
          borderRadius: isMaximized ? 0 : '0 0 var(--radius-lg) var(--radius-lg)',
        }}
      >
        {children}
      </div>

      {/* Resize handles — only on edges/corners, never the center.
          z-50 so they sit above everything but their footprint is small. */}
      {showHandles && (
        <>
          {/* Edges */}
          <div onMouseDown={startResize('n')}
            style={{ position: 'absolute', top: 0, left: CORNER, right: CORNER, height: HANDLE, cursor: 'n-resize', zIndex: 50 }} />
          <div onMouseDown={startResize('s')}
            style={{ position: 'absolute', bottom: 0, left: CORNER, right: CORNER, height: HANDLE, cursor: 's-resize', zIndex: 50 }} />
          <div onMouseDown={startResize('w')}
            style={{ position: 'absolute', left: 0, top: CORNER, bottom: CORNER, width: HANDLE, cursor: 'w-resize', zIndex: 50 }} />
          <div onMouseDown={startResize('e')}
            style={{ position: 'absolute', right: 0, top: CORNER, bottom: CORNER, width: HANDLE, cursor: 'e-resize', zIndex: 50 }} />
          {/* Corners */}
          <div onMouseDown={startResize('nw')}
            style={{ position: 'absolute', top: 0, left: 0, width: CORNER, height: CORNER, cursor: 'nw-resize', zIndex: 51 }} />
          <div onMouseDown={startResize('ne')}
            style={{ position: 'absolute', top: 0, right: 0, width: CORNER, height: CORNER, cursor: 'ne-resize', zIndex: 51 }} />
          <div onMouseDown={startResize('sw')}
            style={{ position: 'absolute', bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: 'sw-resize', zIndex: 51 }} />
          <div onMouseDown={startResize('se')}
            style={{ position: 'absolute', bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: 'se-resize', zIndex: 51 }} />
        </>
      )}

      {/* Snap overlay (Phase 6.1). Rendered via portal so it covers the
          full viewport above all windows. Visible only while dragging
          near a viewport edge. */}
      {snapCandidate && typeof document !== 'undefined' &&
        createPortal(<SnapOverlay kind={snapCandidate} />, document.body)}
    </div>
  );
});

function SnapOverlay({ kind }: { kind: SnapKind }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const usableH = vh - TOP_PANEL_HEIGHT;
  let style: React.CSSProperties;
  if (kind === 'left') {
    style = { left: 0, top: TOP_PANEL_HEIGHT, width: Math.floor(vw / 2), height: usableH };
  } else if (kind === 'right') {
    style = { left: Math.floor(vw / 2), top: TOP_PANEL_HEIGHT, width: vw - Math.floor(vw / 2), height: usableH };
  } else {
    style = { left: 0, top: TOP_PANEL_HEIGHT, width: vw, height: usableH };
  }
  return (
    <div
      data-snap-overlay={kind}
      style={{
        position: 'fixed',
        ...style,
        background: 'rgba(124, 77, 255, 0.18)',
        border: '2px solid var(--accent-primary)',
        borderRadius: 8,
        pointerEvents: 'none',
        zIndex: 9000,
        transition: 'all 80ms ease-out',
      }}
    />
  );
}

export default WindowFrame;
