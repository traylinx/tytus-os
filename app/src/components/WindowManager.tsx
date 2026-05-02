// ============================================================
// WindowManager — Renders all open windows, manages z-index
// ============================================================

import { memo, useEffect, useRef, useState } from 'react';
import { useOS } from '@/hooks/useOSStore';
import { WindowContextProvider } from '@/hooks/useCurrentWindow';
import type { Window } from '@/types';
import WindowFrame from './WindowFrame';
import AppRouter from '@/apps/AppRouter';

const TOP_PANEL_HEIGHT = 28;
// Sprint B Phase 6.4 — close animation duration. Match the keyframe in
// styles/window-animations.css. 10ms slack to ensure the animation
// finishes before we unmount.
const CLOSE_ANIM_MS = 130;

const WindowManager = memo(function WindowManager() {
  const { state } = useOS();
  const visibleWindows = state.windows.filter((w) => w.state !== 'minimized');

  // Track windows that just disappeared so we can play their close
  // animation against an empty ghost frame before unmounting. The ghost
  // is intentionally body-less — re-rendering the closed app's
  // contents during the 120ms animation would be expensive (and may
  // touch state that's been torn down).
  const [closingGhosts, setClosingGhosts] = useState<Window[]>([]);
  const prevWindowsRef = useRef<Window[]>([]);
  useEffect(() => {
    const currIds = new Set(state.windows.map((w) => w.id));
    const justRemoved = prevWindowsRef.current.filter((p) => !currIds.has(p.id));
    if (justRemoved.length > 0) {
      // IMPORTANT: advance prevWindowsRef before scheduling ghosts. Without
      // this, any later window state update (drag/move/focus) would see the
      // same removed window again and add duplicate ghost frames behind the
      // active window.
      prevWindowsRef.current = state.windows;
      // Skip ghosts for minimize → close races (already minimized when
      // disappearing; user wouldn't see the scale-out anyway).
      const visibleClosed = justRemoved.filter((w) => w.state !== 'minimized');
      if (visibleClosed.length > 0) {
        setClosingGhosts((g) => [...g, ...visibleClosed]);
        const timers = visibleClosed.map((w) =>
          window.setTimeout(() => {
            setClosingGhosts((g) => g.filter((x) => x.id !== w.id));
          }, CLOSE_ANIM_MS),
        );
        // No return cleanup needed — timers are short-lived; if the
        // component unmounts mid-animation the parent (App) is already
        // unmounting so the ghosts go with it.
        return () => timers.forEach((t) => window.clearTimeout(t));
      }
      return;
    }
    prevWindowsRef.current = state.windows;
  }, [state.windows]);

  return (
    <>
      {visibleWindows.map((win) => (
        <WindowFrame key={win.id} window={win}>
          <WindowContextProvider window={win}>
            <AppRouter appId={win.appId} windowId={win.id} />
          </WindowContextProvider>
        </WindowFrame>
      ))}

      {/* Close-out ghosts (Phase 6.4). Empty frame, animates scale-out,
          then unmounts. Honors the prefers-reduced-motion + .reduce-motion
          gate via window-animations.css. */}
      {closingGhosts.map((g) => {
        const isMaximized = g.state === 'maximized';
        const style: React.CSSProperties = isMaximized
          ? {
              position: 'absolute',
              left: 0,
              top: TOP_PANEL_HEIGHT,
              width: '100vw',
              height: `calc(100vh - ${TOP_PANEL_HEIGHT}px)`,
              zIndex: g.zIndex,
              borderRadius: 0,
            }
          : {
              position: 'absolute',
              left: g.position.x,
              top: g.position.y,
              width: g.size.width,
              height: g.size.height,
              zIndex: g.zIndex,
              borderRadius: 'var(--radius-lg)',
            };
        return (
          <div
            key={`ghost-${g.id}`}
            data-window-closing="true"
            data-app-id={g.appId}
            style={{
              ...style,
              background: 'var(--bg-window)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--chrome-shadow-focused)',
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </>
  );
});

export default WindowManager;
