// ============================================================
// Dock — Bottom dock with pinned apps, open indicators, trash
// ============================================================

import { useCallback, memo, useEffect, useMemo, useState } from 'react';
import { useOS } from '@/hooks/useOSStore';
import { getAppById } from '@/apps/registry';
import { resolveCanonicalAppId, unifyAppDefinition } from '@/apps/legacy-app-aliases';
import { LayoutGrid, Trash2 } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { useI18n } from '@/i18n';
import { localizedAppName } from '@/i18n/app-name';
import { BrandIcon, isBrandIconName } from './BrandIcon';
import { parsePayload, serializePayload } from '@/lib/dnd';
import * as trashRepo from '@/lib/repo/trash';
import { isReplacedByForge } from '@/apps/product-replacements';

// Phase 1.2 — pixel sizes per Dock size variant. Used both for icon
// dimensions and for the auto-hide reveal zone height/width.
const DOCK_SIZE_PX = { small: 40, medium: 56, large: 72 } as const;
const ICON_SIZE_PX = { small: 32, medium: 40, large: 52 } as const;
const ICON_GLYPH_PX = { small: 18, medium: 22, large: 28 } as const;

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  if (isBrandIconName(name)) {
    return <BrandIcon name={name} size={(props.size as number) ?? 22} className={props.className} />;
  }
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  return IconComp ? <IconComp {...props} /> : null;
};

const Dock = memo(function Dock() {
  const { state, dispatch } = useOS();
  const { t } = useI18n();
  const { dockItems } = state;
  const [bouncingItems, setBouncingItems] = useState<Set<string>>(new Set());
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);
  const [, setTooltipPos] = useState({ x: 0, y: 0 });

  const dockTheme = state.theme.dock;
  const isVertical = dockTheme.position === 'left' || dockTheme.position === 'right';
  const dockExtent = DOCK_SIZE_PX[dockTheme.size];
  const iconExtent = ICON_SIZE_PX[dockTheme.size];
  const iconGlyph = ICON_GLYPH_PX[dockTheme.size];

  // Phase 1.2 auto-hide. Dock is hidden until the user points at the
  // bottom/left/right edge (within 6px). State-machine is local — the
  // reducer doesn't need to know whether the dock is currently shown.
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (!dockTheme.autoHide) {
      setHovering(false);
      return;
    }
    const edge = 6;
    const onMove = (e: MouseEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      let near = false;
      if (dockTheme.position === 'bottom') near = e.clientY >= h - edge;
      else if (dockTheme.position === 'left') near = e.clientX <= edge;
      else if (dockTheme.position === 'right') near = e.clientX >= w - edge;
      setHovering(near);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [dockTheme.autoHide, dockTheme.position]);
  const dockShown = !dockTheme.autoHide || hovering;

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

  // Phase 4.3 — Dock Trash icon accepts file + desktop-icon drops.
  // For desktop-icon refs we dispatch REMOVE_DESKTOP_ICON (existing
  // reducer); the actual byte trashing for daemon-backed targets is
  // deferred until the daemon endpoints land (see DONE.md).
  const [trashDropOver, setTrashDropOver] = useState(false);
  const handleTrashDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (
      types.includes('application/x-tytus-file-ref') ||
      types.includes('application/x-tytus-desktop-icon')
    ) {
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'move';
      } catch {}
      setTrashDropOver(true);
    }
  }, []);
  const handleTrashDragLeave = useCallback(() => {
    setTrashDropOver(false);
  }, []);
  const handleTrashDrop = useCallback(
    (e: React.DragEvent) => {
      setTrashDropOver(false);
      const payload = parsePayload(e.dataTransfer);
      if (!payload) return;
      e.preventDefault();
      if (payload.kind === 'desktop-icon') {
        for (const id of payload.iconIds) {
          dispatch({ type: 'REMOVE_DESKTOP_ICON', id });
        }
        return;
      }
      if (payload.kind === 'file') {
        // vfs refs: hand to trash repo (which writes the metadata
        // index + delegates to vfs hooks). daemon refs: surface as
        // not-found until the daemon endpoints land.
        void trashRepo.trash(payload.refs);
      }
    },
    [dispatch],
  );

  const pinnedItemsRaw = dockItems.filter((d) => d.isPinned && !isReplacedByForge(resolveCanonicalAppId(d.appId)));
  const openUnpinned = dockItems.filter((d) => !d.isPinned && d.isOpen && !isReplacedByForge(resolveCanonicalAppId(d.appId)));

  // Phase 1.6 — apply user-configured dock order. Apps not present
  // in `theme.dock.order` keep their default registry position
  // (appended in registry order after the user-ordered ones).
  const pinnedItems = useMemo(() => {
    const order = dockTheme.order;
    if (!order || order.length === 0) return pinnedItemsRaw;
    const byId = new Map(pinnedItemsRaw.map((d) => [d.appId, d]));
    const ordered = order
      .map((id) => byId.get(id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    const seen = new Set(ordered.map((d) => d.appId));
    const tail = pinnedItemsRaw.filter((d) => !seen.has(d.appId));
    return [...ordered, ...tail];
  }, [pinnedItemsRaw, dockTheme.order]);

  // Drag state for reorder. The `dropBeforeId` shows the insertion
  // marker between two icons; null means "drop at end". A null
  // `draggingAppId` means no in-flight reorder.
  const [draggingAppId, setDraggingAppId] = useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);

  const commitReorder = useCallback(
    (insertBeforeId: string | null) => {
      if (!draggingAppId) return;
      const currentOrder = pinnedItems.map((d) => d.appId);
      const next = currentOrder.filter((id) => id !== draggingAppId);
      if (insertBeforeId == null) {
        next.push(draggingAppId);
      } else {
        const idx = next.indexOf(insertBeforeId);
        if (idx < 0) next.push(draggingAppId);
        else next.splice(idx, 0, draggingAppId);
      }
      dispatch({
        type: 'SET_THEME',
        theme: { dock: { ...dockTheme, order: next } },
      });
    },
    [dispatch, dockTheme, draggingAppId, pinnedItems],
  );

  const renderDockIcon = (appId: string, isTrash = false, reorderable = false) => {
    const item = dockItems.find((d) => d.appId === appId);
    if (!item && !isTrash) return null;

    const rawApp = getAppById(appId);
    const app = rawApp ? unifyAppDefinition(rawApp) : undefined;
    const isBouncing = bouncingItems.has(appId);
    const isHovered = hoveredApp === appId;
    const isOpen = item?.isOpen || false;
    const isFocused = item?.isFocused || false;
    const isDragGhost = reorderable && draggingAppId === appId;
    const showInsertMarker = reorderable && dropBeforeId === appId;

    // Phase 1.6 — reorder DnD on the wrapper. Drag source emits an
    // `app` payload; drop target reads the same kind so non-app
    // payloads never trigger reorder.
    const reorderHandlers = reorderable
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            serializePayload(e.dataTransfer, { kind: 'app', appId });
            try {
              e.dataTransfer.effectAllowed = 'move';
            } catch {}
            setDraggingAppId(appId);
          },
          onDragOver: (e: React.DragEvent) => {
            const types = Array.from(e.dataTransfer.types);
            if (!types.includes('application/x-tytus-app')) return;
            e.preventDefault();
            try {
              e.dataTransfer.dropEffect = 'move';
            } catch {}
            if (dropBeforeId !== appId) setDropBeforeId(appId);
          },
          onDragLeave: () => {
            if (dropBeforeId === appId) setDropBeforeId(null);
          },
          onDrop: (e: React.DragEvent) => {
            const payload = parsePayload(e.dataTransfer);
            if (!payload || payload.kind !== 'app') return;
            e.preventDefault();
            commitReorder(appId);
            setDraggingAppId(null);
            setDropBeforeId(null);
          },
          onDragEnd: () => {
            setDraggingAppId(null);
            setDropBeforeId(null);
          },
        }
      : {};

    return (
      <div
        key={appId}
        className="relative flex flex-col items-center"
        style={{ opacity: isDragGhost ? 0.4 : 1 }}
        {...reorderHandlers}
        onMouseEnter={(e) => {
          setHoveredApp(appId);
          setTooltipPos({ x: e.currentTarget.offsetLeft, y: 0 });
        }}
        onMouseLeave={() => setHoveredApp(null)}
      >
        {showInsertMarker && (
          <div
            aria-hidden
            className="absolute pointer-events-none rounded-full"
            style={{
              [isVertical ? 'top' : 'left']: -3,
              [isVertical ? 'left' : 'top']: '50%',
              transform: isVertical ? 'translateY(-50%)' : 'translateX(-50%)',
              width: isVertical ? '70%' : 3,
              height: isVertical ? 3 : '70%',
              background: 'var(--accent-primary)',
              boxShadow: '0 0 8px var(--accent-primary)',
            }}
          />
        )}
        {/* Tooltip */}
        {isHovered && (
          <div
            className="absolute bottom-full mb-2 px-2 py-1 rounded-sm text-[10px] font-medium whitespace-nowrap z-[4000]"
            style={{
              background: 'var(--bg-tooltip)',
              color: 'var(--text-primary)',
              boxShadow: 'var(--shadow-sm)',
              animation: 'tooltipAppear 100ms ease',
            }}
          >
            {isTrash ? t('dock.trash') : app ? localizedAppName(t, app.id, app.name) : appId}
          </div>
        )}

        {/* Icon */}
        <button
          onClick={() => isTrash ? handleTrashClick() : handleAppClick(appId)}
          aria-label={isTrash ? t('dock.trash') : app ? localizedAppName(t, app.id, app.name) : appId}
          title={isTrash ? t('dock.trash') : app ? localizedAppName(t, app.id, app.name) : appId}
          className="rounded-md flex items-center justify-center transition-all"
          style={{
            width: iconExtent,
            height: iconExtent,
            background: isHovered ? 'var(--bg-hover)' : 'transparent',
            transform: isBouncing ? 'translateY(-6px)' : 'scale(1)',
            transition: isBouncing ? 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)' : 'all 150ms ease',
            opacity: isTrash ? 0.7 : isOpen ? 1 : 0.85,
          }}
        >
          {isTrash ? (
            <Trash2 size={iconGlyph} className="text-[var(--text-primary)]" />
          ) : (
            <DynamicIcon name={app?.icon || 'HelpCircle'} size={iconGlyph} className="text-[var(--text-primary)]" />
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

  // Position-driven layout: bottom keeps the historical centred-row
  // layout; left/right pin to the side and stack vertically.
  const positionStyle: React.CSSProperties = (() => {
    if (dockTheme.position === 'bottom') {
      return {
        bottom: 6,
        left: '50%',
        transform: dockShown
          ? 'translateX(-50%) translateY(0)'
          : `translateX(-50%) translateY(${dockExtent + 12}px)`,
        height: dockExtent,
        maxWidth: 'calc(100vw - 32px)',
      };
    }
    if (dockTheme.position === 'left') {
      return {
        left: 6,
        top: '50%',
        transform: dockShown
          ? 'translateY(-50%) translateX(0)'
          : `translateY(-50%) translateX(-${dockExtent + 12}px)`,
        width: dockExtent,
        maxHeight: 'calc(100vh - 64px)',
      };
    }
    return {
      right: 6,
      top: '50%',
      transform: dockShown
        ? 'translateY(-50%) translateX(0)'
        : `translateY(-50%) translateX(${dockExtent + 12}px)`,
      width: dockExtent,
      maxHeight: 'calc(100vh - 64px)',
    };
  })();

  return (
    <div
      role="navigation"
      aria-label={t('dock.aria')}
      data-dock-position={dockTheme.position}
      data-dock-size={dockTheme.size}
      // z-[5500] floats above any window: window zIndex starts at 100 and
      // increments per focus, while the maximize flow now extends windows
      // to the viewport bottom — the dock must always paint on top of
      // them. Modal layers (z-[6000]) still win.
      className={`fixed z-[5500] flex ${
        isVertical ? 'flex-col' : 'flex-row'
      } items-center gap-0.5 px-2 ${
        isVertical ? 'py-2 overflow-y-auto' : 'overflow-x-auto'
      }`}
      style={{
        ...positionStyle,
        background: 'rgba(45,45,45,0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
        transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        animation: dockTheme.autoHide ? undefined : 'dockSlideUp 300ms cubic-bezier(0, 0, 0.2, 1)',
        scrollbarWidth: 'none',
      }}
    >
      {/* Show Applications button */}
      <button
        onClick={handleShowApps}
        aria-label={t('dock.showApplications')}
        title={t('dock.showApplications')}
        className="rounded-md flex items-center justify-center hover:bg-[var(--bg-hover)] transition-all"
        style={{
          width: iconExtent,
          height: iconExtent,
          background: state.appLauncherOpen ? 'var(--bg-active)' : 'transparent',
        }}
      >
        <LayoutGrid size={iconGlyph - 2} className="text-[var(--text-primary)]" />
      </button>

      {/* Separator */}
      <div
        className={isVertical ? 'my-1 shrink-0' : 'mx-1 shrink-0'}
        style={{
          width: isVertical ? 24 : 1,
          height: isVertical ? 1 : 24,
          background: 'var(--border-subtle)',
        }}
      />

      {/* Pinned apps (Phase 1.6 — reorderable via app DnD) */}
      {pinnedItems.map((item) =>
        renderDockIcon(item.appId, false, true),
      )}

      {/* Separator (if there are open unpinned apps) */}
      {openUnpinned.length > 0 && (
        <div
          className={isVertical ? 'my-1 shrink-0' : 'mx-1 shrink-0'}
          style={{
            width: isVertical ? 24 : 1,
            height: isVertical ? 1 : 24,
            background: 'var(--border-subtle)',
          }}
        />
      )}

      {/* Open unpinned apps */}
      {openUnpinned.map((item) => renderDockIcon(item.appId))}

      {/* Separator */}
      <div
        className={isVertical ? 'my-1 shrink-0' : 'mx-1 shrink-0'}
        style={{
          width: isVertical ? 24 : 1,
          height: isVertical ? 1 : 24,
          background: 'var(--border-subtle)',
        }}
      />

      {/* Trash (Phase 4.3 drop target) */}
      <div
        onDragOver={handleTrashDragOver}
        onDragLeave={handleTrashDragLeave}
        onDrop={handleTrashDrop}
        style={{
          position: 'relative',
          ...(trashDropOver
            ? {
                outline: '2px solid var(--accent-error)',
                outlineOffset: 2,
                borderRadius: 'var(--radius-sm)',
              }
            : {}),
        }}
      >
        {renderDockIcon('trash', true)}
      </div>

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
