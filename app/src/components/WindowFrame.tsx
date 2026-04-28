// ============================================================
// WindowFrame — Draggable, resizable window chrome
// ============================================================

import { useCallback, useRef, useState, memo, useEffect } from 'react';
import type { Window } from '@/types';
import { useOS } from '@/hooks/useOSStore';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

const TOP_PANEL_HEIGHT = 28;
const HANDLE = 6;
const CORNER = 14;
const MIN_W = 320;
const MIN_H = 200;

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  return IconComp ? <IconComp {...props} /> : <Icons.HelpCircle {...props} />;
};

interface WindowFrameProps {
  window: Window;
  children: React.ReactNode;
}

const WindowFrame = memo(function WindowFrame({ window: win, children }: WindowFrameProps) {
  const { dispatch } = useOS();
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ edge: Edge; startX: number; startY: number; origW: number; origH: number; origX: number; origY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

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

  // ---- Drag from title bar ----
  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;
      // Only drag with primary button
      if (e.button !== 0) return;
      // Don't start drag if a button inside the title bar was the target
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: win.position.x,
        origY: win.position.y,
      };
      setIsDragging(true);
    },
    [isMaximized, win.position.x, win.position.y]
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
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        let nx = dragRef.current.origX + dx;
        let ny = dragRef.current.origY + dy;
        const vw = window.innerWidth;
        ny = Math.max(TOP_PANEL_HEIGHT, ny);
        nx = Math.min(Math.max(nx, -(win.size.width - 100)), vw - 100);
        dispatch({ type: 'MOVE_WINDOW', windowId: win.id, position: { x: nx, y: ny } });
      }
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
      dragRef.current = null;
      resizeRef.current = null;
      setIsDragging(false);
      setIsResizing(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dispatch, win.id, win.size.width, win.size.height]);

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

  return (
    <div
      className="absolute flex flex-col select-none"
      style={{
        left: win.position.x,
        top: win.position.y,
        width: win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
        borderRadius: isMaximized ? 0 : 12,
        border: `1px solid ${isFocused ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: isFocused
          ? '0 8px 32px rgba(0,0,0,0.5)'
          : '0 2px 8px rgba(0,0,0,0.3)',
        transition: isDragging || isResizing ? 'none' : 'box-shadow 150ms ease, border-color 150ms ease',
        overflow: 'hidden',
      }}
      onMouseDown={handleFrameMouseDown}
    >
      {/* Title bar */}
      <div
        className="relative z-10 flex items-center justify-between shrink-0"
        style={{
          height: 36,
          background: isFocused ? '#1A1A1A' : '#141414',
          borderRadius: isMaximized ? 0 : '12px 12px 0 0',
          transition: 'background 150ms ease',
          cursor: isMaximized ? 'default' : isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
        onMouseDown={handleTitleMouseDown}
        onDoubleClick={handleDoubleClickTitle}
      >
        {/* Left: icon + title */}
        <div className="flex items-center gap-2 px-3 overflow-hidden pointer-events-none">
          <DynamicIcon name={win.icon} size={16} className="text-[var(--text-secondary)] shrink-0" />
          <span
            className="text-xs font-semibold truncate"
            style={{
              color: isFocused ? '#E0E0E0' : '#9E9E9E',
              transition: 'color 150ms ease',
            }}
          >
            {win.title}
          </span>
        </div>

        {/* Right: window controls */}
        <div className="flex items-center shrink-0">
          <button
            onClick={handleMinimize}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors"
            title="Minimize"
            aria-label="Minimize"
          >
            <Icons.Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Icons.Copy size={12} /> : <Icons.Square size={12} />}
          </button>
          <button
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] transition-colors"
            style={{ borderRadius: isMaximized ? 0 : '0 12px 0 0' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#F44336';
              e.currentTarget.style.color = 'white';
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
          borderRadius: isMaximized ? 0 : '0 0 12px 12px',
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
    </div>
  );
});

export default WindowFrame;
