// ============================================================
// Dock — Bottom dock with pinned apps, open indicators, trash
// ============================================================

import { useCallback, memo, useState } from 'react';
import { useOS } from '@/hooks/useOSStore';
import { getAppById } from '@/apps/registry';
import { LayoutGrid, Trash2 } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  return IconComp ? <IconComp {...props} /> : null;
};

const Dock = memo(function Dock() {
  const { state, dispatch } = useOS();
  const { dockItems } = state;
  const [bouncingItems, setBouncingItems] = useState<Set<string>>(new Set());
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);
  const [, setTooltipPos] = useState({ x: 0, y: 0 });

  // Bounce a dock icon for 400ms. State is local on purpose — keeps the
  // animation out of the global reducer where it caused a feedback loop.
  const triggerBounce = useCallback((appId: string) => {
    setBouncingItems((prev) => new Set(prev).add(appId));
    setTimeout(() => {
      setBouncingItems((prev) => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }, 400);
  }, []);

  const handleAppClick = useCallback(
    (appId: string) => {
      const hasOpenWindow = state.windows.some((w) => w.appId === appId && w.state !== 'minimized');
      if (hasOpenWindow) {
        // Focus existing window
        const win = state.windows.find((w) => w.appId === appId && w.state !== 'minimized');
        if (win) dispatch({ type: 'FOCUS_WINDOW', windowId: win.id });
      } else {
        // Re-show a minimized window if one exists
        const minimized = state.windows.find((w) => w.appId === appId && w.state === 'minimized');
        if (minimized) {
          dispatch({ type: 'RESTORE_WINDOW', windowId: minimized.id });
          dispatch({ type: 'FOCUS_WINDOW', windowId: minimized.id });
        } else {
          dispatch({ type: 'OPEN_WINDOW', appId });
        }
        triggerBounce(appId);
      }
    },
    [dispatch, state.windows, triggerBounce]
  );

  const handleShowApps = useCallback(() => {
    dispatch({ type: 'TOGGLE_APP_LAUNCHER' });
  }, [dispatch]);

  const handleTrashClick = useCallback(() => {
    dispatch({ type: 'OPEN_WINDOW', appId: 'filemanager' });
  }, [dispatch]);

  const pinnedItems = dockItems.filter((d) => d.isPinned);
  const openUnpinned = dockItems.filter((d) => !d.isPinned && d.isOpen);

  const renderDockIcon = (appId: string, isTrash = false) => {
    const item = dockItems.find((d) => d.appId === appId);
    if (!item && !isTrash) return null;

    const app = getAppById(appId);
    const isBouncing = bouncingItems.has(appId);
    const isHovered = hoveredApp === appId;
    const isOpen = item?.isOpen || false;
    const isFocused = item?.isFocused || false;

    return (
      <div
        key={appId}
        className="relative flex flex-col items-center"
        onMouseEnter={(e) => {
          setHoveredApp(appId);
          setTooltipPos({ x: e.currentTarget.offsetLeft, y: 0 });
        }}
        onMouseLeave={() => setHoveredApp(null)}
      >
        {/* Tooltip */}
        {isHovered && (
          <div
            className="absolute bottom-full mb-2 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap z-[4000]"
            style={{
              background: 'var(--bg-tooltip)',
              color: 'var(--text-primary)',
              boxShadow: 'var(--shadow-sm)',
              animation: 'tooltipAppear 100ms ease',
            }}
          >
            {isTrash ? 'Trash' : app?.name || appId}
          </div>
        )}

        {/* Icon */}
        <button
          onClick={() => isTrash ? handleTrashClick() : handleAppClick(appId)}
          aria-label={isTrash ? 'Trash' : app?.name || appId}
          title={isTrash ? 'Trash' : app?.name || appId}
          className="w-10 h-10 rounded-md flex items-center justify-center transition-all"
          style={{
            background: isHovered ? 'var(--bg-hover)' : 'transparent',
            transform: isBouncing ? 'translateY(-6px)' : 'scale(1)',
            transition: isBouncing ? 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)' : 'all 150ms ease',
            opacity: isTrash ? 0.7 : isOpen ? 1 : 0.85,
          }}
        >
          {isTrash ? (
            <Trash2 size={22} className="text-[var(--text-primary)]" />
          ) : (
            <DynamicIcon name={app?.icon || 'HelpCircle'} size={22} className="text-[var(--text-primary)]" />
          )}
        </button>

        {/* Active indicator dot — sits inside the dock so it's never clipped at the viewport edge */}
        {isOpen && (
          <div
            className="absolute bottom-1 w-1 h-1 rounded-full"
            style={{
              background: isFocused ? 'var(--accent-primary)' : 'var(--text-disabled)',
              animation: 'dotAppear 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div
      role="navigation"
      aria-label="Application dock"
      className="fixed left-1/2 -translate-x-1/2 z-[150] flex items-center gap-0.5 px-2 overflow-x-auto max-w-[calc(100vw-32px)]"
      style={{
        bottom: 6,
        height: 56,
        background: 'rgba(45,45,45,0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
        animation: 'dockSlideUp 300ms cubic-bezier(0, 0, 0.2, 1)',
        scrollbarWidth: 'none',  // hide scrollbar; user scrolls via wheel/swipe
      }}
    >
      {/* Show Applications button */}
      <button
        onClick={handleShowApps}
        aria-label="Show applications"
        title="Show applications"
        className="w-10 h-10 rounded-md flex items-center justify-center hover:bg-[var(--bg-hover)] transition-all"
        style={{
          background: state.appLauncherOpen ? 'var(--bg-active)' : 'transparent',
        }}
      >
        <LayoutGrid size={20} className="text-[var(--text-primary)]" />
      </button>

      {/* Separator */}
      <div
        className="mx-1 shrink-0"
        style={{ width: 1, height: 24, background: 'var(--border-subtle)' }}
      />

      {/* Pinned apps */}
      {pinnedItems.map((item) => renderDockIcon(item.appId))}

      {/* Separator (if there are open unpinned apps) */}
      {openUnpinned.length > 0 && (
        <div
          className="mx-1 shrink-0"
          style={{ width: 1, height: 24, background: 'var(--border-subtle)' }}
        />
      )}

      {/* Open unpinned apps */}
      {openUnpinned.map((item) => renderDockIcon(item.appId))}

      {/* Separator */}
      <div
        className="mx-1 shrink-0"
        style={{ width: 1, height: 24, background: 'var(--border-subtle)' }}
      />

      {/* Trash */}
      {renderDockIcon('trash', true)}

      <style>{`
        @keyframes dockSlideUp {
          from { transform: translateX(-50%) translateY(48px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
        @keyframes tooltipAppear {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes dotAppear {
          from { transform: scale(0); }
          to { transform: scale(1); }
        }
      `}</style>
    </div>
  );
});

export default Dock;
