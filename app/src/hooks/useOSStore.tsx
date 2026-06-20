// ============================================================
// OS State Management — React Context + useReducer
// ============================================================

import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import type { OSState, OSAction, Window, DesktopIcon, Notification, DockItem, WindowArgs, WindowState, WindowSnapEntry, SnapKind, Theme } from '@/types';
import { APP_REGISTRY, getAppById, getDefaultDockApps } from '@/apps/registry';
import { resolveCanonicalAppId } from '@/apps/legacy-app-aliases';
import { DEFAULT_TYTUS_WALLPAPER } from '@/lib/brand';
import { normalizeTheme } from '@/lib/theme/normalize';

// ---- Window persistence ----
const WINDOWS_STORAGE_KEY = 'tytus_windows';
const THEME_STORAGE_KEY = 'tytus_theme';
const DOCK_PINS_STORAGE_KEY = 'tytus_dock_pins';
const DOCK_DEFAULTS_MIGRATION_KEY = 'tytus_dock_defaults_migrated_v2026_06_appstore';
// Prior migration key. We carry its state forward so the app-store migration
// does NOT re-pin juli3ta for users who ran the 2026_05 migration and have
// since removed juli3ta (that would override an explicit dock choice).
const PRIOR_DOCK_DEFAULTS_MIGRATION_KEY = 'tytus_dock_defaults_migrated_v2026_05_juli3ta';
const DEFAULT_DOCK_APPS_TO_MIGRATE = ['juli3ta', 'app-store'] as const;
const DEFAULT_DOCK_INSERT_AFTER: Partial<Record<(typeof DEFAULT_DOCK_APPS_TO_MIGRATE)[number], string>> = {
  juli3ta: 'atomek',
  // 'app-store' intentionally omitted → appended to the end of the pinned row.
  // juli3ta is only migrated for stragglers who never ran the 2026_05
  // migration (see mergeNewDefaultDockPinsOnce); for everyone else only
  // app-store is added. mergeNewDefaultDockPinsOnce skips already-pinned ids,
  // so re-running is idempotent.
};

interface PersistedWindow {
  id: string;
  appId: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  state: WindowState;
  icon: string;
}

const isPersistedWindow = (value: unknown): value is PersistedWindow => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.appId !== 'string') return false;
  if (typeof v.title !== 'string' || typeof v.icon !== 'string') return false;
  if (v.state !== 'normal' && v.state !== 'minimized' && v.state !== 'maximized') return false;
  const pos = v.position as Record<string, unknown> | null | undefined;
  const size = v.size as Record<string, unknown> | null | undefined;
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
  if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') return false;
  return true;
};

const normalizePersistedWindow = (windowState: PersistedWindow): PersistedWindow => {
  const appId = resolveCanonicalAppId(windowState.appId);
  if (appId === windowState.appId) return windowState;
  const app = getAppById(appId);
  return {
    ...windowState,
    appId,
    title: app?.name ?? windowState.title,
    icon: app?.icon ?? windowState.icon,
  };
};

const loadPersistedWindows = (): PersistedWindow[] | null => {
  try {
    const raw = localStorage.getItem(WINDOWS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Do not gate restored windows on `getAppById()`. Third-party /
    // installed app definitions (JULI3TA, Atomek, etc.) hydrate from the
    // async installed-apps cache after the React tree starts. Filtering here
    // races that hydration and drops those open windows on browser reload.
    const valid = parsed.filter(isPersistedWindow).map(normalizePersistedWindow);
    return valid;
  } catch {
    return null;
  }
};

const persistWindows = (windows: Window[]): void => {
  try {
    const trimmed: PersistedWindow[] = windows
      // Persist every structurally-valid open window, not only static
      // registry apps. Installed apps can be unknown to the synchronous
      // registry at reload/persist time but are still valid windows.
      .map((w) => ({
        id: w.id,
        appId: w.appId,
        title: w.title,
        position: { x: w.position.x, y: w.position.y },
        size: { width: w.size.width, height: w.size.height },
        state: w.state,
        icon: w.icon,
      }));
    localStorage.setItem(WINDOWS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
};

// ---- Desktop personalization persistence ----
// Theme now owns Dock position / size / auto-hide / order. Dock pins are
// separate because they are runtime app state, not visual theme state.
const defaultTheme = (): Theme => normalizeTheme({
  mode: 'dark',
  accent: '#7C4DFF',
  wallpaper: DEFAULT_TYTUS_WALLPAPER,
});

const loadPersistedTheme = (): Theme => {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return defaultTheme();
    return normalizeTheme(JSON.parse(raw));
  } catch {
    return defaultTheme();
  }
};

const persistTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalizeTheme(theme)));
  } catch {
    /* ignore */
  }
};

const uniqueCanonicalDockPins = (pins: string[]): string[] => (
  [...new Set(pins.map(resolveCanonicalAppId))]
);

const markDockDefaultsMigrationApplied = (): void => {
  try {
    localStorage.setItem(DOCK_DEFAULTS_MIGRATION_KEY, '1');
  } catch {
    /* ignore */
  }
};

const mergeNewDefaultDockPinsOnce = (pins: string[]): string[] => {
  const unique = uniqueCanonicalDockPins(pins);
  try {
    if (localStorage.getItem(DOCK_DEFAULTS_MIGRATION_KEY) === '1') return unique;
  } catch {
    return unique;
  }

  // Users who already ran the 2026_05 migration must not have juli3ta
  // re-pinned (they may have removed it on purpose). Only stragglers who
  // never ran it still get juli3ta carried forward.
  let priorJuli3taApplied = false;
  try {
    priorJuli3taApplied =
      localStorage.getItem(PRIOR_DOCK_DEFAULTS_MIGRATION_KEY) === '1';
  } catch {
    priorJuli3taApplied = false;
  }
  const appsToMigrate = DEFAULT_DOCK_APPS_TO_MIGRATE.filter(
    (appId) => appId !== 'juli3ta' || !priorJuli3taApplied,
  );

  const migrated = [...unique];
  for (const appId of appsToMigrate) {
    if (migrated.includes(appId)) continue;
    const insertAfter = DEFAULT_DOCK_INSERT_AFTER[appId];
    const afterIndex = insertAfter ? migrated.indexOf(insertAfter) : -1;
    if (afterIndex >= 0) migrated.splice(afterIndex + 1, 0, appId);
    else migrated.push(appId);
  }

  try {
    localStorage.setItem(DOCK_PINS_STORAGE_KEY, JSON.stringify(migrated));
  } catch {
    /* ignore */
  }
  markDockDefaultsMigrationApplied();
  return migrated;
};

const loadPersistedDockPins = (): string[] => {
  try {
    const raw = localStorage.getItem(DOCK_PINS_STORAGE_KEY);
    if (!raw) {
      markDockDefaultsMigrationApplied();
      return getDefaultDockApps();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      markDockDefaultsMigrationApplied();
      return getDefaultDockApps();
    }
    return mergeNewDefaultDockPinsOnce(
      parsed.filter((id): id is string => typeof id === 'string'),
    );
  } catch {
    markDockDefaultsMigrationApplied();
    return getDefaultDockApps();
  }
};

const persistDockPins = (items: DockItem[]): void => {
  try {
    const pins = items.filter((d) => d.isPinned).map((d) => resolveCanonicalAppId(d.appId));
    localStorage.setItem(DOCK_PINS_STORAGE_KEY, JSON.stringify([...new Set(pins)]));
  } catch {
    /* ignore */
  }
};

// ---- Per-app geometry persistence ----
// Distinct from `tytus_windows` (which restores OPEN windows on reload).
// This map is keyed by appId and survives close — so reopening an app
// pulls back its last position+size instead of a fresh cascade default.
const GEOMETRY_STORAGE_KEY = 'tytus_window_geometry';

type WindowGeometry = { x: number; y: number; width: number; height: number };

const isWindowGeometry = (v: unknown): v is WindowGeometry => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number'
  );
};

const loadWindowGeometry = (): Record<string, WindowGeometry> => {
  try {
    const raw = localStorage.getItem(GEOMETRY_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, WindowGeometry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && isWindowGeometry(v)) {
        out[resolveCanonicalAppId(k)] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
};

const persistWindowGeometry = (geom: Record<string, WindowGeometry>): void => {
  try {
    localStorage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify(geom));
  } catch {
    /* ignore */
  }
};

// ---- Per-window snap-state persistence (Sprint B Phase 6.1) ----
// Distinct from windowGeometry — keyed by windowId so two windows of the
// same app can be snapped independently. Holds the pre-snap frame so a
// drag-away or Restore brings the user's prior unsnapped geometry back.
const SNAP_STORAGE_KEY = 'tytus_window_snap';

const isSnapEntry = (v: unknown): v is import('@/types').WindowSnapEntry => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r.kind !== 'left' && r.kind !== 'right' && r.kind !== 'top') return false;
  return isWindowGeometry(r.prev);
};

const loadWindowSnap = (): Record<string, import('@/types').WindowSnapEntry> => {
  try {
    const raw = localStorage.getItem(SNAP_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, import('@/types').WindowSnapEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && isSnapEntry(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
};

const persistWindowSnap = (snap: Record<string, import('@/types').WindowSnapEntry>): void => {
  try {
    localStorage.setItem(SNAP_STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
};

// ---- Host clipboard permission cache (Sprint B Phase 5.4f) ----
const CLIPBOARD_PERMISSION_KEY = 'tytus_clipboard_permission';
type ClipboardPerm = 'granted' | 'denied' | 'prompt';

const loadClipboardPermission = (): ClipboardPerm => {
  try {
    const raw = localStorage.getItem(CLIPBOARD_PERMISSION_KEY);
    if (raw === 'granted' || raw === 'denied' || raw === 'prompt') return raw;
    return 'prompt';
  } catch {
    return 'prompt';
  }
};

const persistClipboardPermission = (state: ClipboardPerm): void => {
  try {
    localStorage.setItem(CLIPBOARD_PERMISSION_KEY, state);
  } catch {
    /* ignore */
  }
};

// ---- Helpers ----
const generateId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const TOP_PANEL_HEIGHT = 28;

const createWindow = (
  state: OSState,
  appId: string,
  title?: string,
  args?: WindowArgs,
): Window => {
  const app = getAppById(appId);
  if (!app) throw new Error(`Unknown app: ${appId}`);
  const id = generateId();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const DOCK_HEIGHT = 48;
  const usableH = Math.max(MIN_VIEWPORT_H, vh - TOP_PANEL_HEIGHT - DOCK_HEIGHT - 20);
  const usableW = Math.max(MIN_VIEWPORT_W, vw - 40);

  // Prefer the user's last remembered geometry for this app, falling back
  // to the registry default + cascade. Always clamp to the current viewport
  // so a saved geometry from a wider monitor doesn't open off-screen.
  const saved = state.windowGeometry[appId];
  let width: number;
  let height: number;
  let x: number;
  let y: number;
  if (saved) {
    width = Math.max(MIN_VIEWPORT_W, Math.min(saved.width, usableW));
    height = Math.max(MIN_VIEWPORT_H, Math.min(saved.height, usableH));
    x = Math.max(20, Math.min(vw - width - 20, saved.x));
    y = Math.max(TOP_PANEL_HEIGHT + 10, Math.min(vh - height - DOCK_HEIGHT - 20, saved.y));
  } else {
    width = Math.min(app.defaultSize.width, usableW);
    height = Math.min(app.defaultSize.height, usableH);
    const offset = (state.windows.filter((w) => w.appId === appId && w.state !== 'minimized').length) * 30;
    x = Math.max(20, Math.min(vw - width - 20, 60 + offset));
    y = Math.max(TOP_PANEL_HEIGHT + 10, Math.min(vh - height - DOCK_HEIGHT - 20, 40 + offset));
  }
  return {
    id,
    appId,
    title: title || app.name,
    position: { x, y },
    size: { width, height },
    state: 'normal',
    isFocused: true,
    zIndex: state.nextZIndex,
    icon: app.icon,
    createdAt: Date.now(),
    args,
  };
};

const MIN_VIEWPORT_W = 320;
const MIN_VIEWPORT_H = 240;

// Sprint B Phase 6.1 — drag this many pixels off a snapped position
// before we treat the move as "leaving" the snap and restore the prior
// floating frame. ~24px is roughly the title-bar height; small enough
// to feel responsive, large enough to not unsnap on a sloppy click.
const UNSNAP_DRAG_PX = 24;

// ---- Initial State ----
//
// Manifest §2.5 — Reserved Pods Zone occupies the top-left 4×2 grid
// (x ∈ [16, 336), y ∈ [16, 196)) for pinned-pod icons. User icons must
// not be displaced by pins (and vice versa). Default icons start at
// y = 196 (just below row 2 of the reserved zone), keeping the
// existing two-column layout at x = 16 and x = 96.
//
// Persisted user-moved icons (loadDesktopIcons → tytus_desktop_icons
// in localStorage) take precedence over these defaults, so existing
// users who already arranged their desktop are not relocated.
const defaultDesktopIcons: DesktopIcon[] = [
  { id: 'desk-pods', name: 'Pods', icon: 'Box', appId: 'pod-inspector', position: { x: 16, y: 196 }, isSelected: false },
  { id: 'desk-settings', name: 'Settings', icon: 'Settings', appId: 'settings', position: { x: 16, y: 286 }, isSelected: false },
  { id: 'desk-chat', name: 'Chat', icon: 'MessageSquare', appId: 'chat', position: { x: 16, y: 376 }, isSelected: false },
  { id: 'desk-files', name: 'Files', icon: 'Folder', appId: 'filemanager', position: { x: 16, y: 466 }, isSelected: false },
  { id: 'desk-terminal', name: 'Terminal', icon: 'Terminal', appId: 'terminal', position: { x: 96, y: 196 }, isSelected: false },
  { id: 'desk-browser', name: 'Browser', icon: 'Globe', appId: 'browser', position: { x: 96, y: 286 }, isSelected: false },
  { id: 'desk-channels', name: 'Channels', icon: 'Send', appId: 'channels', position: { x: 96, y: 376 }, isSelected: false },
  { id: 'desk-help', name: 'Help', icon: 'LifeBuoy', appId: 'help', position: { x: 96, y: 466 }, isSelected: false },
  { id: 'desk-app-store', name: 'App Store', icon: 'Store', appId: 'app-store', position: { x: 176, y: 196 }, isSelected: false },
];

const createDockItem = (appId: string, overrides: Partial<DockItem> = {}): DockItem => ({
  appId,
  isPinned: false,
  isOpen: false,
  isFocused: false,
  bounce: false,
  ...overrides,
});

const createInitialDockItems = (): DockItem[] => {
  const pinned = loadPersistedDockPins();
  const registryIds = new Set(APP_REGISTRY.map((app) => app.id));
  const seen = new Set<string>();
  const items: DockItem[] = [];

  // Preserve the persisted/default pin order exactly. Some standalone apps
  // (JULI3TA) are installed from the runtime catalog and not present in the
  // synchronous APP_REGISTRY during shell boot, so unknown pinned ids must be
  // allowed to sit in the configured position instead of being appended after
  // every built-in app.
  for (const appId of pinned) {
    if (seen.has(appId)) continue;
    items.push(createDockItem(appId, { isPinned: true }));
    seen.add(appId);
  }

  for (const app of APP_REGISTRY) {
    const canonical = resolveCanonicalAppId(app.id);
    if (seen.has(app.id) || seen.has(canonical)) continue;
    items.push(createDockItem(app.id, { isPinned: false }));
    seen.add(app.id);
    if (!registryIds.has(canonical) && pinned.includes(canonical)) seen.add(canonical);
  }

  return items;
};

const ensureDockItem = (items: DockItem[], appId: string): DockItem[] => (
  items.some((d) => d.appId === appId) ? items : [...items, createDockItem(appId)]
);

const markDockOpened = (items: DockItem[], appId: string): DockItem[] => (
  ensureDockItem(items, appId).map((d) =>
    d.appId === appId
      ? { ...d, isOpen: true, isFocused: true, bounce: true }
      : { ...d, isFocused: false }
  )
);

const DESKTOP_DEFAULTS_MIGRATION_KEY = 'tytus_desktop_defaults_migrated_v2026_06_appstore';
// New default desktop icons to backfill onto EXISTING (persisted) desktops
// once. Fresh desktops already get these from defaultDesktopIcons; this mirrors
// the dock's mergeNewDefaultDockPinsOnce. Gated by the migration key so an icon
// the user later deletes is never re-added.
const DEFAULT_DESKTOP_ICONS_TO_MIGRATE: { id: string; name: string; icon: string; appId: string }[] = [
  { id: 'desk-app-store', name: 'App Store', icon: 'Store', appId: 'app-store' },
];

const markDesktopDefaultsMigrationApplied = (): void => {
  try {
    localStorage.setItem(DESKTOP_DEFAULTS_MIGRATION_KEY, '1');
  } catch {
    /* ignore */
  }
};

// First free icon slot on the desktop grid (cols 80px from x=16, rows 90px
// from y=196 — the first row below the reserved pods zone). Prefers the
// canonical App Store slot (176,196) when free so a backfill matches a fresh
// install; otherwise scans for any gap.
const findFreeDesktopSlot = (icons: DesktopIcon[]): { x: number; y: number } => {
  const occupied = new Set(icons.map((i) => `${i.position.x},${i.position.y}`));
  if (!occupied.has('176,196')) return { x: 176, y: 196 };
  for (let col = 0; col < 6; col += 1) {
    for (let row = 0; row < 10; row += 1) {
      const x = 16 + col * 80;
      const y = 196 + row * 90;
      if (!occupied.has(`${x},${y}`)) return { x, y };
    }
  }
  return { x: 176, y: 196 };
};

// One-time backfill of new default desktop icons onto an existing desktop.
// No-op after the first run; skips any icon the desktop already has (by id or
// appId) so it never duplicates or fights a user removal.
const mergeNewDefaultDesktopIconsOnce = (icons: DesktopIcon[]): DesktopIcon[] => {
  try {
    if (localStorage.getItem(DESKTOP_DEFAULTS_MIGRATION_KEY) === '1') return icons;
  } catch {
    return icons;
  }
  const next = [...icons];
  for (const seed of DEFAULT_DESKTOP_ICONS_TO_MIGRATE) {
    const present = next.some((i) => i.id === seed.id || i.appId === seed.appId);
    if (present) continue;
    next.push({ ...seed, position: findFreeDesktopSlot(next), isSelected: false });
  }
  try {
    localStorage.setItem('tytus_desktop_icons', JSON.stringify(next));
    // Only mark applied once the backfill actually persisted; otherwise leave
    // the migration unmarked so it retries on the next load instead of losing
    // the icon forever (e.g. if the icons write hit a quota error).
    markDesktopDefaultsMigrationApplied();
  } catch {
    /* persist failed — do not mark applied; retry next load */
  }
  return next;
};

const loadDesktopIcons = (): DesktopIcon[] => {
  try {
    const saved = localStorage.getItem('tytus_desktop_icons');
    if (saved) {
      const parsed = JSON.parse(saved) as DesktopIcon[];
      if (Array.isArray(parsed)) return mergeNewDefaultDesktopIconsOnce(parsed);
    }
  } catch { /* ignore */ }
  markDesktopDefaultsMigrationApplied();
  return defaultDesktopIcons;
};

const buildInitialState = (): OSState => {
  const persisted = loadPersistedWindows();
  const startingZ = 100;
  let restoredWindows: Window[] = [];
  let nextZIndex = startingZ;
  let dockItems = createInitialDockItems();

  if (persisted && persisted.length > 0) {
    const now = Date.now();
    restoredWindows = persisted.map((p, i) => ({
      id: p.id,
      appId: p.appId,
      title: p.title,
      position: { x: p.position.x, y: p.position.y },
      size: { width: p.size.width, height: p.size.height },
      state: p.state,
      isFocused: false,
      zIndex: startingZ + i,
      icon: p.icon,
      createdAt: now,
    }));
    nextZIndex = startingZ + restoredWindows.length;
    const openAppIds = new Set(restoredWindows.map((w) => w.appId));
    for (const appId of openAppIds) {
      dockItems = ensureDockItem(dockItems, appId);
    }
    dockItems = dockItems.map((d) =>
      openAppIds.has(d.appId) ? { ...d, isOpen: true } : d
    );
  }

  return {
    bootPhase: 'off',
    auth: { isAuthenticated: false, isGuest: false, userName: 'User', locked: false },
    windows: restoredWindows,
    apps: APP_REGISTRY,
    desktopIcons: loadDesktopIcons(),
    theme: loadPersistedTheme(),
    notifications: [],
    dockItems,
    contextMenu: {
      visible: false,
      x: 0,
      y: 0,
      type: 'desktop',
      items: [],
    },
    appLauncherOpen: false,
    notificationCenterOpen: false,
    activeWindowId: null,
    nextZIndex,
    isAltTabbing: false,
    altTabIndex: 0,
    windowGeometry: loadWindowGeometry(),
    windowSnap: loadWindowSnap(),
    clipboardPermission: loadClipboardPermission(),
  };
};

const initialState: OSState = buildInitialState();

// ---- Reducer ----
function osReducer(state: OSState, action: OSAction): OSState {
  switch (action.type) {
    case 'SET_BOOT_PHASE': {
      return { ...state, bootPhase: action.phase };
    }

    case 'LOGIN': {
      return {
        ...state,
        auth: { isAuthenticated: true, isGuest: action.isGuest, userName: action.isGuest ? 'Guest' : 'User', locked: false },
        bootPhase: 'desktop',
      };
    }

    case 'LOGOUT': {
      return {
        ...state,
        auth: { isAuthenticated: false, isGuest: false, userName: 'User', locked: false },
        windows: [],
        bootPhase: 'login',
        activeWindowId: null,
      };
    }

    case 'LOCK': {
      // Screen lock is local-only. Keep daemon auth + every open window intact;
      // the dedicated lock screen hides the desktop until UNLOCK.
      return {
        ...state,
        auth: { ...state.auth, locked: true },
      };
    }

    case 'UNLOCK': {
      return {
        ...state,
        auth: { ...state.auth, locked: false },
      };
    }

    case 'OPEN_WINDOW': {
      const win = createWindow(state, action.appId, action.title, action.args);
      const newWindows = state.windows.map((w) => ({ ...w, isFocused: false }));
      const updatedDock = markDockOpened(state.dockItems, action.appId);
      return {
        ...state,
        windows: [...newWindows, win],
        activeWindowId: win.id,
        nextZIndex: state.nextZIndex + 1,
        dockItems: updatedDock,
      };
    }

    case 'OPEN_OR_FOCUS_WINDOW': {
      const existing = state.windows
        .filter((w) => w.appId === action.appId)
        .sort((a, b) => b.zIndex - a.zIndex)[0];

      if (!existing) {
        const win = createWindow(state, action.appId, action.title, action.args);
        const newWindows = state.windows.map((w) => ({ ...w, isFocused: false }));
        const updatedDock = markDockOpened(state.dockItems, action.appId);
        return {
          ...state,
          windows: [...newWindows, win],
          activeWindowId: win.id,
          nextZIndex: state.nextZIndex + 1,
          dockItems: updatedDock,
        };
      }

      const nextZ = state.nextZIndex + 1;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === existing.id
            ? {
                ...w,
                title: action.title || w.title,
                args: action.args,
                state: w.state === 'minimized' ? 'normal' : w.state,
                position: w.state === 'minimized' ? (w.prevPosition || w.position) : w.position,
                size: w.state === 'minimized' ? (w.prevSize || w.size) : w.size,
                prevPosition: w.state === 'minimized' ? undefined : w.prevPosition,
                prevSize: w.state === 'minimized' ? undefined : w.prevSize,
                isFocused: true,
                zIndex: nextZ,
              }
            : { ...w, isFocused: false }
        ),
        activeWindowId: existing.id,
        nextZIndex: nextZ,
        dockItems: markDockOpened(state.dockItems, action.appId),
      };
    }

    case 'CLOSE_WINDOW': {
      const appId = state.windows.find((w) => w.id === action.windowId)?.appId;
      const remaining = state.windows.filter((w) => w.id !== action.windowId);
      const hasOtherWindows = remaining.some((w) => w.appId === appId && w.state !== 'minimized');
      let updatedDock = state.dockItems;
      if (appId && !hasOtherWindows) {
        updatedDock = state.dockItems.map((d) =>
          d.appId === appId ? { ...d, isOpen: false, isFocused: false } : d
        );
      }
      const newActiveId = remaining.length > 0
        ? remaining.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)).id
        : null;
      // Drop snap state for the closed window (it's gone — its windowId
      // will never recur). Use rest-spread to omit cleanly.
      const nextSnap: Record<string, WindowSnapEntry> = { ...state.windowSnap };
      delete nextSnap[action.windowId];
      return {
        ...state,
        windows: remaining,
        activeWindowId: newActiveId,
        dockItems: updatedDock,
        windowSnap: nextSnap,
      };
    }

    case 'MINIMIZE_WINDOW': {
      const win = state.windows.find((w) => w.id === action.windowId);
      if (!win) return state;
      const updated = state.windows.map((w) =>
        w.id === action.windowId
          ? { ...w, state: 'minimized' as WindowState, isFocused: false, prevPosition: { ...w.position }, prevSize: { ...w.size } }
          : w
      );
      const appId = win.appId;
      const hasVisible = updated.some((w) => w.appId === appId && w.state !== 'minimized');
      const hasAnyWindow = updated.some((w) => w.appId === appId); // includes minimized
      // Dock indicator stays on as long as ANY window of this app exists (visible or
      // minimized). Otherwise unpinned apps that are minimized would lose their only
      // restore affordance — the user would have no way to bring them back.
      const updatedDock = state.dockItems.map((d) =>
        d.appId === appId ? { ...d, isFocused: hasVisible, isOpen: hasAnyWindow } : d
      );
      const newActiveId = updated
        .filter((w) => w.state !== 'minimized')
        .reduce((a, b) => (a && a.zIndex > b.zIndex ? a : b), null as Window | null);
      return { ...state, windows: updated, activeWindowId: newActiveId?.id ?? null, dockItems: updatedDock };
    }

    case 'MAXIMIZE_WINDOW': {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // macOS-style fullscreen: window extends to viewport bottom; the
      // dock floats over it. WindowFrame.tsx mirrors this with
      // `calc(100vh - TOP_PANEL_HEIGHT)`.
      // Sprint B 6.1/6.3 — if the window is currently snapped, capture
      // the snap.prev (i.e. the original floating frame from before the
      // snap) as prevPosition, not the current snapped half. Otherwise
      // double-click → maximize → restore would land you back on the
      // half-window, not the floating one. Drop the snap entry in the
      // process so a later un-snap doesn't fight the maximized state.
      const snap = state.windowSnap[action.windowId];
      const target = state.windows.find((w) => w.id === action.windowId);
      const prevPos = snap
        ? { x: snap.prev.x, y: snap.prev.y }
        : target ? { ...target.position } : { x: 0, y: TOP_PANEL_HEIGHT };
      const prevSz = snap
        ? { width: snap.prev.width, height: snap.prev.height }
        : target ? { ...target.size } : { width: vw, height: vh - TOP_PANEL_HEIGHT };
      const nextSnap = snap ? { ...state.windowSnap } : state.windowSnap;
      if (snap) delete nextSnap[action.windowId];
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId
            ? {
                ...w,
                state: 'maximized' as WindowState,
                prevPosition: prevPos,
                prevSize: prevSz,
                position: { x: 0, y: TOP_PANEL_HEIGHT },
                size: { width: vw, height: vh - TOP_PANEL_HEIGHT },
              }
            : w
        ),
        windowSnap: nextSnap,
      };
    }

    case 'RESTORE_WINDOW': {
      const win = state.windows.find((w) => w.id === action.windowId);
      if (!win) return state;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId
            ? {
                ...w,
                state: 'normal' as WindowState,
                position: win.prevPosition || w.position,
                size: win.prevSize || w.size,
                prevPosition: undefined,
                prevSize: undefined,
              }
            : w
        ),
      };
    }

    case 'FOCUS_WINDOW': {
      const nextZ = state.nextZIndex + 1;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId
            ? { ...w, isFocused: true, zIndex: nextZ }
            : { ...w, isFocused: false }
        ),
        activeWindowId: action.windowId,
        nextZIndex: nextZ,
        dockItems: state.dockItems.map((d) => {
          const isThisApp = state.windows.some((w) => w.id === action.windowId && w.appId === d.appId);
          return { ...d, isFocused: isThisApp };
        }),
      };
    }

    case 'MOVE_WINDOW': {
      const target = state.windows.find((w) => w.id === action.windowId);
      // Don't bake maximized geometry into the per-app memory — when the user
      // un-maximizes we want their previous floating frame back.
      const shouldRemember = target && target.state === 'normal';
      // Sprint B Phase 6.1 — drag-from-snap restore: if the window is
      // currently snapped and the user drags it more than UNSNAP_DRAG_PX
      // away from the snap target, restore the prior unsnapped frame
      // and reposition the cursor's frame at the new spot. Without this
      // a snapped window stays glued to its half forever.
      const snap = state.windowSnap[action.windowId];
      if (target && snap) {
        const movedX = Math.abs(action.position.x - target.position.x);
        const movedY = Math.abs(action.position.y - target.position.y);
        if (movedX > UNSNAP_DRAG_PX || movedY > UNSNAP_DRAG_PX) {
          const nextSnap = { ...state.windowSnap };
          delete nextSnap[action.windowId];
          return {
            ...state,
            windows: state.windows.map((w) =>
              w.id === action.windowId
                ? {
                    ...w,
                    position: action.position,
                    size: { width: snap.prev.width, height: snap.prev.height },
                  }
                : w,
            ),
            windowSnap: nextSnap,
          };
        }
      }
      const nextGeom = shouldRemember
        ? {
            ...state.windowGeometry,
            [target.appId]: {
              x: action.position.x,
              y: action.position.y,
              width: target.size.width,
              height: target.size.height,
            },
          }
        : state.windowGeometry;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId ? { ...w, position: action.position } : w
        ),
        windowGeometry: nextGeom,
      };
    }

    case 'SNAP_WINDOW': {
      const target = state.windows.find((w) => w.id === action.windowId);
      if (!target) return state;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const usableH = vh - TOP_PANEL_HEIGHT;
      // Capture pre-snap frame ONLY if not already snapped — re-snapping
      // (left → right while still snapped) must not overwrite the original
      // floating frame, otherwise restoring drops you on a half-window.
      const existing = state.windowSnap[action.windowId];
      const prev = existing
        ? existing.prev
        : {
            x: target.position.x,
            y: target.position.y,
            width: target.size.width,
            height: target.size.height,
          };
      let nextPos: { x: number; y: number };
      let nextSize: { width: number; height: number };
      if (action.kind === 'left') {
        nextPos = { x: 0, y: TOP_PANEL_HEIGHT };
        nextSize = { width: Math.floor(vw / 2), height: usableH };
      } else if (action.kind === 'right') {
        nextPos = { x: Math.floor(vw / 2), y: TOP_PANEL_HEIGHT };
        nextSize = { width: vw - Math.floor(vw / 2), height: usableH };
      } else {
        // top → maximize
        nextPos = { x: 0, y: TOP_PANEL_HEIGHT };
        nextSize = { width: vw, height: usableH };
      }
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId
            ? { ...w, state: 'normal' as WindowState, position: nextPos, size: nextSize }
            : w,
        ),
        windowSnap: {
          ...state.windowSnap,
          [action.windowId]: { kind: action.kind, prev },
        },
      };
    }

    case 'UNSNAP_WINDOW': {
      const snap = state.windowSnap[action.windowId];
      if (!snap) return state;
      const nextSnap = { ...state.windowSnap };
      delete nextSnap[action.windowId];
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId
            ? {
                ...w,
                position: { x: snap.prev.x, y: snap.prev.y },
                size: { width: snap.prev.width, height: snap.prev.height },
              }
            : w,
        ),
        windowSnap: nextSnap,
      };
    }

    case 'SET_CLIPBOARD_PERMISSION': {
      if (state.clipboardPermission === action.state) return state;
      return { ...state, clipboardPermission: action.state };
    }

    case 'RESIZE_WINDOW': {
      const target = state.windows.find((w) => w.id === action.windowId);
      const shouldRemember = target && target.state === 'normal';
      const nextGeom = shouldRemember
        ? {
            ...state.windowGeometry,
            [target.appId]: {
              x: target.position.x,
              y: target.position.y,
              width: action.size.width,
              height: action.size.height,
            },
          }
        : state.windowGeometry;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId ? { ...w, size: action.size } : w
        ),
        windowGeometry: nextGeom,
      };
    }

    case 'UPDATE_WINDOW_TITLE': {
      const title = action.title.trim();
      if (!title) return state;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId ? { ...w, title } : w
        ),
      };
    }

    case 'SET_ACTIVE_WINDOW': {
      return {
        ...state,
        activeWindowId: action.windowId,
        windows: state.windows.map((w) => ({ ...w, isFocused: w.id === action.windowId })),
      };
    }

    case 'TOGGLE_APP_LAUNCHER': {
      return { ...state, appLauncherOpen: !state.appLauncherOpen };
    }

    case 'SET_APP_LAUNCHER': {
      return { ...state, appLauncherOpen: action.open };
    }

    case 'TOGGLE_NOTIFICATION_CENTER': {
      return { ...state, notificationCenterOpen: !state.notificationCenterOpen };
    }

    case 'ADD_NOTIFICATION': {
      const notif: Notification = {
        ...action.notification,
        id: generateId(),
        timestamp: Date.now(),
        isRead: false,
      };
      return { ...state, notifications: [notif, ...state.notifications].slice(0, 50) };
    }

    case 'REMOVE_NOTIFICATION': {
      return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) };
    }

    case 'CLEAR_NOTIFICATIONS': {
      return { ...state, notifications: [] };
    }

    case 'MARK_NOTIFICATION_READ': {
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, isRead: true } : n
        ),
      };
    }

    case 'ADD_DESKTOP_ICON': {
      const icon: DesktopIcon = { ...action.icon, id: generateId() };
      const next = [...state.desktopIcons, icon];
      localStorage.setItem('tytus_desktop_icons', JSON.stringify(next));
      return { ...state, desktopIcons: next };
    }

    case 'REMOVE_DESKTOP_ICON': {
      const next = state.desktopIcons.filter((i) => i.id !== action.id);
      localStorage.setItem('tytus_desktop_icons', JSON.stringify(next));
      return { ...state, desktopIcons: next };
    }

    case 'UPDATE_DESKTOP_ICON_POSITION': {
      const next = state.desktopIcons.map((i) =>
        i.id === action.id ? { ...i, position: action.position } : i
      );
      localStorage.setItem('tytus_desktop_icons', JSON.stringify(next));
      return { ...state, desktopIcons: next };
    }

    case 'SELECT_DESKTOP_ICON': {
      return {
        ...state,
        desktopIcons: state.desktopIcons.map((i) =>
          ({ ...i, isSelected: i.id === action.id })
        ),
      };
    }

    case 'SET_THEME': {
      return { ...state, theme: normalizeTheme({ ...state.theme, ...action.theme }) };
    }

    case 'TOGGLE_THEME': {
      const mode = state.theme.mode === 'dark' ? 'light' : 'dark';
      return { ...state, theme: normalizeTheme({ ...state.theme, mode }) };
    }

    case 'PIN_DOCK_ITEM': {
      return {
        ...state,
        dockItems: ensureDockItem(state.dockItems, action.appId).map((d) =>
          d.appId === action.appId ? { ...d, isPinned: true } : d
        ),
      };
    }

    case 'UNPIN_DOCK_ITEM': {
      return {
        ...state,
        dockItems: state.dockItems.map((d) =>
          d.appId === action.appId ? { ...d, isPinned: false } : d
        ),
      };
    }

    case 'BOUNCE_DOCK_ITEM': {
      // Acknowledge the bounce: clear flags. The visual bounce is driven by
      // the Dock's local state (bouncingItems) for 400ms; this just resets
      // the global flag so the effect doesn't re-fire forever.
      return {
        ...state,
        dockItems: state.dockItems.map((d) => (d.bounce ? { ...d, bounce: false } : d)),
      };
    }

    case 'SHOW_CONTEXT_MENU': {
      return {
        ...state,
        contextMenu: {
          visible: true,
          x: action.x,
          y: action.y,
          type: action.menuType,
          items: action.items,
          contextData: action.contextData,
        },
      };
    }

    case 'HIDE_CONTEXT_MENU': {
      return { ...state, contextMenu: { ...state.contextMenu, visible: false } };
    }

    case 'START_ALT_TAB': {
      const visibleWins = state.windows.filter((w) => w.state !== 'minimized');
      return {
        ...state,
        isAltTabbing: true,
        altTabIndex: visibleWins.length > 0 ? visibleWins.length - 1 : 0,
      };
    }

    case 'CYCLE_ALT_TAB': {
      const visibleWins = state.windows.filter((w) => w.state !== 'minimized');
      return {
        ...state,
        altTabIndex: visibleWins.length > 0
          ? (state.altTabIndex + 1) % visibleWins.length
          : 0,
      };
    }

    case 'END_ALT_TAB': {
      const visibleWins = state.windows.filter((w) => w.state !== 'minimized');
      const target = visibleWins[state.altTabIndex];
      return {
        ...state,
        isAltTabbing: false,
        altTabIndex: 0,
        ...(target ? {
          activeWindowId: target.id,
          windows: state.windows.map((w) =>
            w.id === target.id ? { ...w, isFocused: true, zIndex: state.nextZIndex } : { ...w, isFocused: false }
          ),
          nextZIndex: state.nextZIndex + 1,
        } : {}),
      };
    }

    case 'CASCADE_WINDOWS': {
      let z = state.nextZIndex;
      const updated = state.windows.map((w, i) => ({
        ...w,
        position: { x: 40 + i * 30, y: TOP_PANEL_HEIGHT + 20 + i * 30 },
        zIndex: z++,
        isFocused: i === state.windows.length - 1,
      }));
      return {
        ...state,
        windows: updated,
        activeWindowId: updated.length > 0 ? updated[updated.length - 1].id : null,
        nextZIndex: z,
      };
    }

    case 'MINIMIZE_ALL': {
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.state !== 'minimized'
            ? { ...w, state: 'minimized' as WindowState, isFocused: false }
            : w
        ),
        activeWindowId: null,
        dockItems: state.dockItems.map((d) => ({ ...d, isFocused: false })),
      };
    }

    default:
      return state;
  }
}

// ---- Context ----
interface OSContextType {
  state: OSState;
  dispatch: React.Dispatch<OSAction>;
}

const OSContext = createContext<OSContextType | null>(null);

export const OSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(osReducer, initialState);

  // Persist window position / size / state to localStorage whenever the
  // windows array changes. We're syncing to an external store, so a useEffect
  // is the right shape (vs. wrapping dispatch).
  useEffect(() => {
    const timer = window.setTimeout(() => persistWindows(state.windows), 180);
    return () => window.clearTimeout(timer);
  }, [state.windows]);

  // Per-app remembered geometry — survives close so reopening pulls
  // back the user's last frame.
  useEffect(() => {
    const timer = window.setTimeout(() => persistWindowGeometry(state.windowGeometry), 180);
    return () => window.clearTimeout(timer);
  }, [state.windowGeometry]);

  // Per-window snap state — persists across reload so a snapped FileManager
  // window comes back snapped. Cleared on CLOSE_WINDOW.
  useEffect(() => {
    persistWindowSnap(state.windowSnap);
  }, [state.windowSnap]);

  // Real-OS personalization persistence: wallpaper/theme, Dock position,
  // Dock size, auto-hide, and user-reordered app order survive reloads.
  useEffect(() => {
    persistTheme(state.theme);
  }, [state.theme]);

  // User "Keep in Dock" / "Remove from Dock" choices survive reloads.
  useEffect(() => {
    persistDockPins(state.dockItems);
  }, [state.dockItems]);

  // Sprint B Phase 5.4f — clipboard permission cache.
  useEffect(() => {
    persistClipboardPermission(state.clipboardPermission);
  }, [state.clipboardPermission]);

  return (
    <OSContext.Provider value={{ state, dispatch }}>
      {children}
    </OSContext.Provider>
  );
};

export const useOS = () => {
  const ctx = useContext(OSContext);
  if (!ctx) throw new Error('useOS must be used within OSProvider');
  return ctx;
};

// ---- Convenience hooks ----
export const useWindows = () => {
  const { state, dispatch } = useOS();
  return {
    windows: state.windows,
    openWindow: useCallback((appId: string, title?: string) => dispatch({ type: 'OPEN_WINDOW', appId, title }), [dispatch]),
    closeWindow: useCallback((windowId: string) => dispatch({ type: 'CLOSE_WINDOW', windowId }), [dispatch]),
    minimizeWindow: useCallback((windowId: string) => dispatch({ type: 'MINIMIZE_WINDOW', windowId }), [dispatch]),
    maximizeWindow: useCallback((windowId: string) => dispatch({ type: 'MAXIMIZE_WINDOW', windowId }), [dispatch]),
    restoreWindow: useCallback((windowId: string) => dispatch({ type: 'RESTORE_WINDOW', windowId }), [dispatch]),
    focusWindow: useCallback((windowId: string) => dispatch({ type: 'FOCUS_WINDOW', windowId }), [dispatch]),
    moveWindow: useCallback((windowId: string, position: { x: number; y: number }) => dispatch({ type: 'MOVE_WINDOW', windowId, position }), [dispatch]),
    resizeWindow: useCallback((windowId: string, size: { width: number; height: number }) => dispatch({ type: 'RESIZE_WINDOW', windowId, size }), [dispatch]),
    snapWindow: useCallback((windowId: string, kind: SnapKind) => dispatch({ type: 'SNAP_WINDOW', windowId, kind }), [dispatch]),
    unsnapWindow: useCallback((windowId: string) => dispatch({ type: 'UNSNAP_WINDOW', windowId }), [dispatch]),
    activeWindowId: state.activeWindowId,
    windowSnap: state.windowSnap,
  };
};

export const useNotifications = () => {
  const { state, dispatch } = useOS();
  return {
    notifications: state.notifications,
    addNotification: useCallback(
      (n: Omit<Notification, 'id' | 'timestamp'>) => dispatch({ type: 'ADD_NOTIFICATION', notification: n }),
      [dispatch]
    ),
    removeNotification: useCallback((id: string) => dispatch({ type: 'REMOVE_NOTIFICATION', id }), [dispatch]),
    clearNotifications: useCallback(() => dispatch({ type: 'CLEAR_NOTIFICATIONS' }), [dispatch]),
  };
};

/**
 * Provider-tolerant variant — returns a no-op `addNotification` when
 * the consumer isn't wrapped in `OSProvider` (e.g. in unit tests that
 * render a single component without a full OSStore). Production code
 * paths always have a provider, so the no-op branch is test-only.
 */
export const useOptionalNotifications = () => {
  const ctx = useContext(OSContext);
  const dispatch = ctx?.dispatch;
  return {
    addNotification: useCallback(
      (n: Omit<Notification, 'id' | 'timestamp'>) => {
        if (!dispatch) return;
        dispatch({ type: 'ADD_NOTIFICATION', notification: n });
      },
      [dispatch],
    ),
  };
};
