// ============================================================
// OS State Management — React Context + useReducer
// ============================================================

import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import type { OSState, OSAction, Window, DesktopIcon, Notification, DockItem, WindowState } from '@/types';
import { APP_REGISTRY, getAppById, getDefaultDockApps } from '@/apps/registry';

// ---- Window persistence ----
const WINDOWS_STORAGE_KEY = 'tytus_windows';

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

const loadPersistedWindows = (): PersistedWindow[] | null => {
  try {
    const raw = localStorage.getItem(WINDOWS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(isPersistedWindow).filter((w) => getAppById(w.appId));
    return valid;
  } catch {
    return null;
  }
};

const persistWindows = (windows: Window[]): void => {
  try {
    const trimmed: PersistedWindow[] = windows
      .filter((w) => getAppById(w.appId))
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

// ---- Helpers ----
const generateId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const TOP_PANEL_HEIGHT = 28;

const createWindow = (state: OSState, appId: string, title?: string): Window => {
  const app = getAppById(appId);
  if (!app) throw new Error(`Unknown app: ${appId}`);
  const id = generateId();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const DOCK_HEIGHT = 48;
  const usableH = Math.max(MIN_VIEWPORT_H, vh - TOP_PANEL_HEIGHT - DOCK_HEIGHT - 20);
  const usableW = Math.max(MIN_VIEWPORT_W, vw - 40);
  // Clamp the window's default size to the viewport so apps don't open off-screen
  const width = Math.min(app.defaultSize.width, usableW);
  const height = Math.min(app.defaultSize.height, usableH);
  const offset = (state.windows.filter((w) => w.appId === appId && w.state !== 'minimized').length) * 30;
  const x = Math.max(20, Math.min(vw - width - 20, 60 + offset));
  const y = Math.max(TOP_PANEL_HEIGHT + 10, Math.min(vh - height - DOCK_HEIGHT - 20, 40 + offset));
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
  };
};

const MIN_VIEWPORT_W = 320;
const MIN_VIEWPORT_H = 240;

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
];

const createInitialDockItems = (): DockItem[] => {
  const pinned = getDefaultDockApps();
  return APP_REGISTRY.map((app) => ({
    appId: app.id,
    isPinned: pinned.includes(app.id),
    isOpen: false,
    isFocused: false,
    bounce: false,
  }));
};

const loadDesktopIcons = (): DesktopIcon[] => {
  try {
    const saved = localStorage.getItem('tytus_desktop_icons');
    if (saved) return JSON.parse(saved) as DesktopIcon[];
  } catch { /* ignore */ }
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
    dockItems = dockItems.map((d) =>
      openAppIds.has(d.appId) ? { ...d, isOpen: true } : d
    );
  }

  return {
    bootPhase: 'off',
    auth: { isAuthenticated: false, isGuest: false, userName: 'User' },
    windows: restoredWindows,
    apps: APP_REGISTRY,
    desktopIcons: loadDesktopIcons(),
    theme: {
      mode: 'dark',
      accent: '#7C4DFF',
      wallpaper: '/wallpaper-default.jpg',
    },
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
        auth: { isAuthenticated: true, isGuest: action.isGuest, userName: action.isGuest ? 'Guest' : 'User' },
        bootPhase: 'desktop',
      };
    }

    case 'LOGOUT': {
      return {
        ...state,
        auth: { isAuthenticated: false, isGuest: false, userName: 'User' },
        windows: [],
        bootPhase: 'login',
        activeWindowId: null,
      };
    }

    case 'LOCK': {
      // Returns to the login screen but keeps every open window and the layout
      // intact. Unlocking via LOGIN drops you back where you were.
      return {
        ...state,
        auth: { ...state.auth, isAuthenticated: false },
      };
    }

    case 'OPEN_WINDOW': {
      const win = createWindow(state, action.appId, action.title);
      const newWindows = state.windows.map((w) => ({ ...w, isFocused: false }));
      const updatedDock = state.dockItems.map((d) =>
        d.appId === action.appId ? { ...d, isOpen: true, isFocused: true, bounce: true } : { ...d, isFocused: false }
      );
      return {
        ...state,
        windows: [...newWindows, win],
        activeWindowId: win.id,
        nextZIndex: state.nextZIndex + 1,
        dockItems: updatedDock,
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
      return {
        ...state,
        windows: remaining,
        activeWindowId: newActiveId,
        dockItems: updatedDock,
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
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId
            ? {
                ...w,
                state: 'maximized' as WindowState,
                prevPosition: { ...w.position },
                prevSize: { ...w.size },
                position: { x: 0, y: TOP_PANEL_HEIGHT },
                size: { width: vw, height: vh - TOP_PANEL_HEIGHT - 48 },
              }
            : w
        ),
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
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId ? { ...w, position: action.position } : w
        ),
      };
    }

    case 'RESIZE_WINDOW': {
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.windowId ? { ...w, size: action.size } : w
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
      return { ...state, theme: { ...state.theme, ...action.theme } };
    }

    case 'TOGGLE_THEME': {
      const mode = state.theme.mode === 'dark' ? 'light' : 'dark';
      return { ...state, theme: { ...state.theme, mode } };
    }

    case 'PIN_DOCK_ITEM': {
      return {
        ...state,
        dockItems: state.dockItems.map((d) =>
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
    persistWindows(state.windows);
  }, [state.windows]);

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
    activeWindowId: state.activeWindowId,
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
