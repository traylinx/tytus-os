// ============================================================
// Dock — Bottom dock with app launcher, dynamic apps, and permanent controls
// ============================================================

import { useCallback, memo, useEffect, useMemo, useRef, useState } from "react";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import { getAppById } from "@/apps/registry";
import {
  resolveCanonicalAppId,
  unifyAppDefinition,
} from "@/apps/legacy-app-aliases";
import { LayoutGrid } from "lucide-react";
import * as Icons from "lucide-react";
import type { LucideProps } from "lucide-react";
import { useI18n } from "@/i18n";
import { localizedAppName } from "@/i18n/app-name";
import { BrandIcon, isBrandIconName } from "./BrandIcon";
import { parsePayload, serializePayload } from "@/lib/dnd";
import { isHiddenLegacyApp } from "@/apps/product-replacements";
import { getExternalAppLogo } from "@/apps/externalAppLogos";
import type { StoreApp } from "@/types/daemon";

// Phase 1.2 — pixel sizes per Dock size variant. Used both for icon
// dimensions and for the auto-hide reveal zone height/width.
const DOCK_SIZE_PX = { small: 40, medium: 56, large: 72 } as const;
const ICON_SIZE_PX = { small: 32, medium: 40, large: 52 } as const;
const ICON_GLYPH_PX = { small: 18, medium: 22, large: 28 } as const;
const PERMANENT_RIGHT_APP_ID = "settings";
const DESKTOP_APP_OPENING_TIMEOUT_MS = 30_000;

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  if (isBrandIconName(name)) {
    return (
      <BrandIcon
        name={name}
        size={(props.size as number) ?? 22}
        className={props.className}
      />
    );
  }
  const IconComp = (
    Icons as unknown as Record<string, React.ComponentType<LucideProps>>
  )[name];
  return IconComp ? <IconComp {...props} /> : null;
};

const Dock = memo(function Dock() {
  const { state, dispatch } = useOS();
  const client = useDaemonClient();
  const { t } = useI18n();
  const { dockItems } = state;
  const [bouncingItems, setBouncingItems] = useState<Set<string>>(new Set());
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);
  const [, setTooltipPos] = useState({ x: 0, y: 0 });
  const [desktopApps, setDesktopApps] = useState<StoreApp[]>([]);
  const [openingDesktopApps, setOpeningDesktopApps] = useState<Set<string>>(
    new Set(),
  );
  const [runningDesktopApps, setRunningDesktopApps] = useState<Set<string>>(
    new Set(),
  );
  const openingTimeoutsRef = useRef<Map<string, number>>(new Map());

  const dockTheme = state.theme.dock;
  const isVertical =
    dockTheme.position === "left" || dockTheme.position === "right";
  const dockExtent = DOCK_SIZE_PX[dockTheme.size];
  const iconExtent = ICON_SIZE_PX[dockTheme.size];
  const iconGlyph = ICON_GLYPH_PX[dockTheme.size];

  useEffect(() => {
    let cancelled = false;
    const loadDesktopApps = async () => {
      const apps = await client.getStoreApps();
      if (cancelled) return;
      setDesktopApps(apps.ok ? apps.value : []);
    };
    void loadDesktopApps();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadDesktopApps();
    };
    window.addEventListener("focus", loadDesktopApps);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = window.setInterval(loadDesktopApps, 10_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadDesktopApps);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [client]);

  const desktopAppById = useMemo(
    () => new Map(desktopApps.map((app) => [app.id, app])),
    [desktopApps],
  );
  const visibleDesktopAppIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of dockItems) {
      if ((item.isPinned || item.isOpen) && desktopAppById.has(item.appId)) {
        ids.add(item.appId);
      }
    }
    return Array.from(ids).sort();
  }, [desktopAppById, dockItems]);

  const clearOpeningTimeout = useCallback((appId: string) => {
    const timeout = openingTimeoutsRef.current.get(appId);
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
      openingTimeoutsRef.current.delete(appId);
    }
  }, []);

  const clearOpeningState = useCallback(
    (appId: string) => {
      clearOpeningTimeout(appId);
      setOpeningDesktopApps((prev) => {
        if (!prev.has(appId)) return prev;
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    },
    [clearOpeningTimeout],
  );

  useEffect(
    () => () => {
      for (const timeout of openingTimeoutsRef.current.values()) {
        window.clearTimeout(timeout);
      }
      openingTimeoutsRef.current.clear();
    },
    [],
  );

  const refreshDesktopRuntime = useCallback(
    async (signal?: AbortSignal) => {
      if (visibleDesktopAppIds.length === 0) {
        setRunningDesktopApps((prev) => (prev.size === 0 ? prev : new Set()));
        return;
      }

      const runtime = await client.postAppsRuntime(
        visibleDesktopAppIds,
        signal,
      );
      if (!runtime.ok) return;

      const nextRunning = new Set(
        runtime.value.results
          .filter((result) => result.running)
          .map((result) => result.id),
      );

      setRunningDesktopApps((prev) => {
        if (
          prev.size === nextRunning.size &&
          Array.from(prev).every((id) => nextRunning.has(id))
        ) {
          return prev;
        }
        return nextRunning;
      });

      setOpeningDesktopApps((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of prev) {
          if (nextRunning.has(id)) {
            clearOpeningTimeout(id);
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [clearOpeningTimeout, client, visibleDesktopAppIds],
  );

  useEffect(() => {
    const controller = new AbortController();
    const tick = () => {
      void refreshDesktopRuntime(controller.signal);
    };
    tick();
    const interval = window.setInterval(
      tick,
      openingDesktopApps.size > 0 ? 2_000 : 5_000,
    );
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [openingDesktopApps.size, refreshDesktopRuntime]);

  // Auto-hide is hidden until the pointer hits the screen edge, then it
  // stays visible while the pointer is inside the revealed dock's hit-zone.
  // The old 6px-only edge made the dock disappear before users could click.
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (!dockTheme.autoHide) {
      const reset = window.setTimeout(() => setHovering(false), 0);
      return () => window.clearTimeout(reset);
    }
    const revealEdge = Math.max(12, Math.min(28, Math.round(dockExtent * 0.4)));
    const retention = dockExtent + 28;
    const onMove = (e: MouseEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setHovering((wasShown) => {
        if (dockTheme.position === "bottom") {
          return e.clientY >= h - (wasShown ? retention : revealEdge);
        }
        if (dockTheme.position === "left") {
          return e.clientX <= (wasShown ? retention : revealEdge);
        }
        return e.clientX >= w - (wasShown ? retention : revealEdge);
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [dockExtent, dockTheme.autoHide, dockTheme.position]);
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
    async (appId: string) => {
      const rawApp = getAppById(appId);
      if (!rawApp) {
        clearOpeningTimeout(appId);
        setOpeningDesktopApps((prev) => new Set(prev).add(appId));
        const timeout = window.setTimeout(() => {
          setOpeningDesktopApps((prev) => {
            if (!prev.has(appId)) return prev;
            const next = new Set(prev);
            next.delete(appId);
            return next;
          });
          openingTimeoutsRef.current.delete(appId);
        }, DESKTOP_APP_OPENING_TIMEOUT_MS);
        openingTimeoutsRef.current.set(appId, timeout);

        const opened = await client.postAppOpen(appId);
        if (opened.ok) {
          triggerBounce(appId);
          void refreshDesktopRuntime();
        } else {
          clearOpeningState(appId);
        }
        return;
      }

      const hasOpenWindow = state.windows.some(
        (w) => w.appId === appId && w.state !== "minimized",
      );
      if (hasOpenWindow) {
        // Focus existing window
        const win = state.windows.find(
          (w) => w.appId === appId && w.state !== "minimized",
        );
        if (win) dispatch({ type: "FOCUS_WINDOW", windowId: win.id });
      } else {
        // Re-show a minimized window if one exists
        const minimized = state.windows.find(
          (w) => w.appId === appId && w.state === "minimized",
        );
        if (minimized) {
          dispatch({ type: "RESTORE_WINDOW", windowId: minimized.id });
          dispatch({ type: "FOCUS_WINDOW", windowId: minimized.id });
        } else {
          dispatch({ type: "OPEN_WINDOW", appId });
        }
        triggerBounce(appId);
      }
    },
    [
      clearOpeningState,
      clearOpeningTimeout,
      client,
      dispatch,
      refreshDesktopRuntime,
      state.windows,
      triggerBounce,
    ],
  );

  const handleShowApps = useCallback(() => {
    dispatch({ type: "TOGGLE_APP_LAUNCHER" });
  }, [dispatch]);

  // Dedupe by canonical id so a legacy entry (e.g. `musiccreator`) and
  // its installed canonical (`juli3ta`) don't both surface in the Dock
  // — keep the canonical entry where present, otherwise the legacy.
  const dedupeByCanonical = (items: typeof dockItems) => {
    const out: typeof dockItems = [];
    const canonicalSeen = new Set<string>();
    // First pass: items whose appId IS already the canonical (no alias)
    // win priority — they render with the canonical icon/name.
    for (const d of items) {
      const canonical = resolveCanonicalAppId(d.appId);
      if (d.appId === canonical) {
        out.push(d);
        canonicalSeen.add(canonical);
      }
    }
    // Second pass: aliased entries only render if the canonical isn't
    // already in the dock. Skips dupes like {musiccreator} when
    // {juli3ta} is present.
    for (const d of items) {
      const canonical = resolveCanonicalAppId(d.appId);
      if (d.appId === canonical) continue;
      if (canonicalSeen.has(canonical)) continue;
      out.push(d);
      canonicalSeen.add(canonical);
    }
    return out;
  };
  const pinnedItemsRaw = dedupeByCanonical(
    dockItems.filter(
      (d) =>
        d.appId !== PERMANENT_RIGHT_APP_ID &&
        d.isPinned &&
        !isHiddenLegacyApp(resolveCanonicalAppId(d.appId)),
    ),
  );
  const openUnpinned = dedupeByCanonical(
    dockItems.filter(
      (d) =>
        d.appId !== PERMANENT_RIGHT_APP_ID &&
        !d.isPinned &&
        d.isOpen &&
        !isHiddenLegacyApp(resolveCanonicalAppId(d.appId)),
    ),
  );

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
        type: "SET_THEME",
        theme: { dock: { ...dockTheme, order: next } },
      });
    },
    [dispatch, dockTheme, draggingAppId, pinnedItems],
  );

  const renderDockIcon = (
    appId: string,
    reorderable = false,
    options: { permanent?: boolean } = {},
  ) => {
    const item = dockItems.find((d) => d.appId === appId);
    if (!item && !options.permanent) return null;

    const rawApp = getAppById(appId);
    const app = rawApp ? unifyAppDefinition(rawApp) : undefined;
    const desktopApp = desktopAppById.get(appId);
    const appLabel = app
      ? localizedAppName(t, app.id, app.name)
      : (desktopApp?.name ?? appId);
    const appIcon = app?.icon ?? desktopApp?.icon ?? "AppWindow";
    const imageLogo = getExternalAppLogo(appId);
    const isBouncing = bouncingItems.has(appId);
    const isHovered = hoveredApp === appId;
    const isDesktopRunning = runningDesktopApps.has(appId);
    const isDesktopOpening = openingDesktopApps.has(appId) && !isDesktopRunning;
    const isOpen = item?.isOpen || isDesktopRunning || false;
    const isFocused = item?.isFocused || false;
    const isPinned = item?.isPinned || false;
    const isDragGhost = reorderable && draggingAppId === appId;
    const showInsertMarker = reorderable && dropBeforeId === appId;

    // Phase 1.6 — reorder DnD on the wrapper. Drag source emits an
    // `app` payload; drop target reads the same kind so non-app
    // payloads never trigger reorder.
    const reorderHandlers = reorderable
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            serializePayload(e.dataTransfer, { kind: "app", appId });
            try {
              e.dataTransfer.effectAllowed = "move";
            } catch {
              // Browser refused DnD hint; reorder still works.
            }
            setDraggingAppId(appId);
          },
          onDragOver: (e: React.DragEvent) => {
            const types = Array.from(e.dataTransfer.types);
            if (!types.includes("application/x-tytus-app")) return;
            e.preventDefault();
            try {
              e.dataTransfer.dropEffect = "move";
            } catch {
              // Browser refused DnD hint; reorder still works.
            }
            if (dropBeforeId !== appId) setDropBeforeId(appId);
          },
          onDragLeave: () => {
            if (dropBeforeId === appId) setDropBeforeId(null);
          },
          onDrop: (e: React.DragEvent) => {
            const payload = parsePayload(e.dataTransfer);
            if (!payload || payload.kind !== "app") return;
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
        onContextMenu={(e) => {
          if (options.permanent) return;
          e.preventDefault();
          dispatch({
            type: "SHOW_CONTEXT_MENU",
            x: e.clientX,
            y: e.clientY,
            menuType: "dockIcon",
            items: [
              {
                id: isPinned ? "dock-remove" : "dock-keep",
                label: isPinned
                  ? t("dock.removeFromDock")
                  : t("dock.keepInDock"),
                icon: isPinned ? "PinOff" : "Pin",
                action: `${isPinned ? "UNPIN_DOCK" : "PIN_DOCK"}:${appId}`,
              },
              { id: "dock-sep-1", label: "", action: "", divider: true },
              {
                id: "dock-open",
                label: appLabel,
                icon: "ExternalLink",
                action: `OPEN_APP:${appId}`,
              },
            ],
            contextData: { appId },
          });
        }}
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
              [isVertical ? "top" : "left"]: -3,
              [isVertical ? "left" : "top"]: "50%",
              transform: isVertical ? "translateY(-50%)" : "translateX(-50%)",
              width: isVertical ? "70%" : 3,
              height: isVertical ? 3 : "70%",
              background: "var(--accent-primary)",
              boxShadow: "0 0 8px var(--accent-primary)",
            }}
          />
        )}
        {/* Tooltip */}
        {isHovered && (
          <div
            className="absolute bottom-full mb-2 px-2 py-1 rounded-sm text-[10px] font-medium whitespace-nowrap z-[4000]"
            style={{
              background: "var(--bg-tooltip)",
              color: "var(--text-primary)",
              boxShadow: "var(--shadow-sm)",
              animation: "tooltipAppear 100ms ease",
            }}
          >
            {appLabel}
          </div>
        )}

        {/* Icon */}
        <button
          onClick={() => handleAppClick(appId)}
          aria-label={appLabel}
          title={appLabel}
          className="rounded-md flex items-center justify-center transition-all"
          style={{
            width: iconExtent,
            height: iconExtent,
            background: isHovered ? "var(--bg-hover)" : "transparent",
            transform: isBouncing ? "translateY(-6px)" : "scale(1)",
            transition: isBouncing
              ? "transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)"
              : "all 150ms ease",
            opacity: isOpen || isDesktopOpening || options.permanent ? 1 : 0.85,
          }}
        >
          {imageLogo ? (
            <span
              className="rounded-md flex items-center justify-center overflow-hidden"
              style={{
                width: Math.max(iconGlyph + 8, Math.round(iconExtent * 0.72)),
                height: Math.max(iconGlyph + 8, Math.round(iconExtent * 0.72)),
                background: imageLogo.background ?? "var(--accent-primary)",
              }}
            >
              <img
                src={imageLogo.src}
                alt=""
                draggable={false}
                style={{
                  width:
                    Math.max(iconGlyph + 8, Math.round(iconExtent * 0.72)) *
                    (imageLogo.scale ?? 1),
                  height:
                    Math.max(iconGlyph + 8, Math.round(iconExtent * 0.72)) *
                    (imageLogo.scale ?? 1),
                  objectFit: "contain",
                }}
              />
            </span>
          ) : (
            <DynamicIcon
              name={appIcon}
              size={iconGlyph}
              className="text-[var(--text-primary)]"
            />
          )}
          {isDesktopOpening && (
            <span
              aria-hidden
              className="absolute rounded-full pointer-events-none"
              style={{
                width: Math.max(12, Math.round(iconExtent * 0.32)),
                height: Math.max(12, Math.round(iconExtent * 0.32)),
                right: 2,
                top: 2,
                border: "2px solid var(--accent-primary)",
                borderTopColor: "transparent",
                animation: "dockRuntimeSpin 700ms linear infinite",
                boxShadow: "0 0 8px rgba(188, 255, 45, 0.35)",
              }}
            />
          )}
        </button>

        {/* Active indicator dot — sits inside the dock so it's never clipped at the viewport edge */}
        {isOpen && (
          <div
            className="absolute bottom-1 w-1 h-1 rounded-full"
            style={{
              background: isFocused
                ? "var(--accent-primary)"
                : "var(--text-disabled)",
              animation: "dotAppear 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          />
        )}
      </div>
    );
  };

  // Position-driven layout: bottom keeps the historical centred-row
  // layout; left/right pin to the side and stack vertically.
  const positionStyle: React.CSSProperties = (() => {
    if (dockTheme.position === "bottom") {
      return {
        bottom: 6,
        left: "50%",
        transform: dockShown
          ? "translateX(-50%) translateY(0)"
          : `translateX(-50%) translateY(${dockExtent + 12}px)`,
        height: dockExtent,
        maxWidth: "calc(100vw - 32px)",
      };
    }
    if (dockTheme.position === "left") {
      return {
        left: 6,
        top: "50%",
        transform: dockShown
          ? "translateY(-50%) translateX(0)"
          : `translateY(-50%) translateX(-${dockExtent + 12}px)`,
        width: dockExtent,
        maxHeight: "calc(100vh - 64px)",
      };
    }
    return {
      right: 6,
      top: "50%",
      transform: dockShown
        ? "translateY(-50%) translateX(0)"
        : `translateY(-50%) translateX(${dockExtent + 12}px)`,
      width: dockExtent,
      maxHeight: "calc(100vh - 64px)",
    };
  })();

  return (
    <div
      role="navigation"
      aria-label={t("dock.aria")}
      data-dock-position={dockTheme.position}
      data-dock-size={dockTheme.size}
      // z-[5500] floats above any window: window zIndex starts at 100 and
      // increments per focus, while the maximize flow now extends windows
      // to the viewport bottom — the dock must always paint on top of
      // them. Modal layers (z-[6000]) still win.
      className={`fixed z-[5500] flex ${
        isVertical ? "flex-col" : "flex-row"
      } items-center gap-0.5 px-2 ${
        isVertical ? "py-2 overflow-y-auto" : "overflow-x-auto"
      }`}
      style={{
        ...positionStyle,
        background: "rgba(45,45,45,0.75)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--border-subtle)",
        transition: "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        animation: dockTheme.autoHide
          ? undefined
          : "dockSlideUp 300ms cubic-bezier(0, 0, 0.2, 1)",
        scrollbarWidth: "none",
      }}
    >
      {/* Show Applications button */}
      <button
        onClick={handleShowApps}
        aria-label={t("dock.showApplications")}
        title={t("dock.showApplications")}
        className="rounded-md flex items-center justify-center hover:bg-[var(--bg-hover)] transition-all"
        style={{
          width: iconExtent,
          height: iconExtent,
          background: state.appLauncherOpen
            ? "var(--bg-active)"
            : "transparent",
        }}
      >
        <LayoutGrid
          size={iconGlyph - 2}
          className="text-[var(--text-primary)]"
        />
      </button>

      {/* Separator */}
      <div
        className={isVertical ? "my-1 shrink-0" : "mx-1 shrink-0"}
        style={{
          width: isVertical ? 24 : 1,
          height: isVertical ? 1 : 24,
          background: "var(--border-subtle)",
        }}
      />

      {/* Dynamic app section: user-pinned apps first, then open unpinned apps. */}
      {pinnedItems.map((item) => renderDockIcon(item.appId, true))}

      {/* Separator (if there are open unpinned apps) */}
      {openUnpinned.length > 0 && (
        <div
          className={isVertical ? "my-1 shrink-0" : "mx-1 shrink-0"}
          style={{
            width: isVertical ? 24 : 1,
            height: isVertical ? 1 : 24,
            background: "var(--border-subtle)",
          }}
        />
      )}

      {/* Open unpinned apps */}
      {openUnpinned.map((item) => renderDockIcon(item.appId))}

      {/* Separator */}
      <div
        className={isVertical ? "my-1 shrink-0" : "mx-1 shrink-0"}
        style={{
          width: isVertical ? 24 : 1,
          height: isVertical ? 1 : 24,
          background: "var(--border-subtle)",
        }}
      />

      {/* Permanent right-side system controls. Settings is always present here;
          it is intentionally excluded from the dynamic app section above. */}
      {renderDockIcon(PERMANENT_RIGHT_APP_ID, false, { permanent: true })}

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
        @keyframes dockRuntimeSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
});

export default Dock;
