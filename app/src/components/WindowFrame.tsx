// ============================================================
// WindowFrame — Draggable, resizable window chrome
// ============================================================

import { useCallback, useRef, useState, memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  const dragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    isResizing: boolean;
    edge: Edge;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    origX: number;
    origY: number;
  } | null>(null);
  const snapCandidateRef = useRef<SnapKind | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [snapCandidate, setSnapCandidate] = useState<SnapKind | null>(null);

  const isMaximized = win.state === 'maximized';
  const isMinimized = win.state === 'minimized';
  const isFocused = win.isFocused;

  const focusThis = useCallback(() => {
    if (!win.isFocused && win.state !== 'minimized') {
      dispatch({ type: 'FOCUS_WINDOW', windowId: win.id });
    }
  }, [dispatch, win.id, win.isFocused, win.state]);

  const handleFrameMouseDown = useCallback(() => {
    focusThis();
  }, [focusThis]);

  const setSnapCandidateSafe = useCallback((next: SnapKind | null) => {
    if (snapCandidateRef.current === next) return;
    snapCandidateRef.current = next;
    setSnapCandidate(next);
  }, []);

  // Drag model intentionally mirrors the original Kimi_Agent Web Linux app:
  // simple mousedown state + window-level mousemove. No direct DOM transforms,
  // no pointer capture, no flushSync. It is boring and it works.
  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      e.preventDefault();

      dragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        origX: win.position.x,
        origY: win.position.y,
      };
      snapCandidateRef.current = null;
      setSnapCandidate(null);
      setIsDragging(true);
    },
    [isMaximized, win.position.x, win.position.y]
  );

  const startResize = useCallback(
    (edge: Edge) => (e: React.MouseEvent) => {
      if (isMaximized || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        isResizing: true,
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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current?.isDragging) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        let nx = dragRef.current.origX + dx;
        let ny = dragRef.current.origY + dy;
        const vw = window.innerWidth;

        ny = Math.max(TOP_PANEL_HEIGHT, ny);
        nx = Math.min(Math.max(nx, -(win.size.width - 100)), vw - 100);

        dispatch({ type: 'MOVE_WINDOW', windowId: win.id, position: { x: nx, y: ny } });

        let nextSnap: SnapKind | null = null;
        if (e.clientX <= SNAP_EDGE_PX) nextSnap = 'left';
        else if (e.clientX >= vw - SNAP_EDGE_PX) nextSnap = 'right';
        else if (e.clientY <= TOP_PANEL_HEIGHT + SNAP_EDGE_PX) nextSnap = 'top';
        setSnapCandidateSafe(nextSnap);
      }

      if (resizeRef.current?.isResizing) {
        const { edge, startX, startY, origW, origH, origX, origY } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let nx = origX;
        let ny = origY;
        let nw = origW;
        let nh = origH;

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
      const snap = snapCandidateRef.current;
      if (dragRef.current?.isDragging && snap) {
        dispatch({ type: 'SNAP_WINDOW', windowId: win.id, kind: snap });
      }
      dragRef.current = null;
      resizeRef.current = null;
      snapCandidateRef.current = null;
      setSnapCandidate(null);
      setIsDragging(false);
      setIsResizing(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dispatch, setSnapCandidateSafe, win.id, win.size.width]);

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

  const showHandles = !isMaximized;
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
        borderRadius: 'var(--radius-lg)',
      };

  return (
    <div
      ref={frameRef}
      className="absolute flex flex-col"
      data-window-id={win.id}
      data-app-id={win.appId}
      data-window-title={win.title}
      data-window-dragging={isDragging ? 'true' : undefined}
      data-window-resizing={isResizing ? 'true' : undefined}
      style={{
        ...frameStyle,
        border: `1px solid ${isFocused ? 'var(--border-default)' : 'var(--border-subtle)'}`,
        boxShadow: isFocused ? 'var(--chrome-shadow-focused)' : 'var(--chrome-shadow-unfocused)',
        transition: isDragging || isResizing ? 'none' : 'box-shadow 150ms ease, border-color 150ms ease',
        overflow: 'hidden',
      }}
      onMouseDown={handleFrameMouseDown}
    >
      <div
        className="relative z-10 flex items-center justify-between shrink-0"
        style={{
          height: 36,
          background: isFocused ? 'var(--chrome-bg-active)' : 'var(--chrome-bg-inactive)',
          borderRadius: isMaximized ? 0 : 'var(--radius-lg) var(--radius-lg) 0 0',
          transition: 'background 150ms ease',
          cursor: isMaximized ? 'default' : isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
        onMouseDown={handleTitleMouseDown}
        onDoubleClick={handleDoubleClickTitle}
      >
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

      <div
        className="relative z-10 flex-1 overflow-hidden"
        style={{
          background: 'var(--bg-window)',
          borderRadius: isMaximized ? 0 : '0 0 var(--radius-lg) var(--radius-lg)',
        }}
      >
        {children}
      </div>

      {showHandles && (
        <>
          <div onMouseDown={startResize('n')} style={{ position: 'absolute', top: 0, left: CORNER, right: CORNER, height: HANDLE, cursor: 'n-resize', zIndex: 50 }} />
          <div onMouseDown={startResize('s')} style={{ position: 'absolute', bottom: 0, left: CORNER, right: CORNER, height: HANDLE, cursor: 's-resize', zIndex: 50 }} />
          <div onMouseDown={startResize('w')} style={{ position: 'absolute', left: 0, top: CORNER, bottom: CORNER, width: HANDLE, cursor: 'w-resize', zIndex: 50 }} />
          <div onMouseDown={startResize('e')} style={{ position: 'absolute', right: 0, top: CORNER, bottom: CORNER, width: HANDLE, cursor: 'e-resize', zIndex: 50 }} />
          <div onMouseDown={startResize('nw')} style={{ position: 'absolute', top: 0, left: 0, width: CORNER, height: CORNER, cursor: 'nw-resize', zIndex: 51 }} />
          <div onMouseDown={startResize('ne')} style={{ position: 'absolute', top: 0, right: 0, width: CORNER, height: CORNER, cursor: 'ne-resize', zIndex: 51 }} />
          <div onMouseDown={startResize('sw')} style={{ position: 'absolute', bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: 'sw-resize', zIndex: 51 }} />
          <div onMouseDown={startResize('se')} style={{ position: 'absolute', bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: 'se-resize', zIndex: 51 }} />
        </>
      )}

      {snapCandidate && typeof document !== 'undefined' && createPortal(<SnapOverlay kind={snapCandidate} />, document.body)}
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
        borderRadius: 'var(--radius-lg)',
        pointerEvents: 'none',
        zIndex: 9000,
        transition: 'all 80ms ease-out',
      }}
    />
  );
}

export default WindowFrame;
