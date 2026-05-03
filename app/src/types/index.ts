// ============================================================
// Tytus OS — Core Type Definitions
// ============================================================

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type WindowState = 'normal' | 'minimized' | 'maximized';

/**
 * Per-window startup args. Set by OPEN_WINDOW callers that want to
 * pre-seed an app with context (e.g. Files → right-click → "Open with
 * Image Viewer" passes the file name in `file`). Each app component
 * is free to ignore unfamiliar keys; missing args means the app should
 * launch with its default state.
 */
export interface WindowArgs {
  /** Pod-relative file path or pure name, surfaced as a viewer banner. */
  file?: string;
  /** The pod the file lives on, when set. Optional for app-level launches. */
  podId?: string;
  /** Hash route dispatch nonce. Distinguishes repeated tray clicks. */
  routeNonce?: string;
  /** Help app route request. */
  help?: {
    /**
     * Either a diagnostic tab id, or a user-manual doc slug prefixed
     * with `docs:` (e.g. `docs:keyboard-shortcuts`). The Help app
     * resolves `docs:<slug>` against the bundled docs registry.
     */
    tab: 'doctor' | 'test' | 'logs' | 'about' | 'channels-catalog' | `docs:${string}`;
    autoRun?: boolean;
  };
  /** Pod Inspector route request. Destructive actions still require UI confirm. */
  podAction?: {
    podId: string;
    action: 'overview' | 'output' | 'restart' | 'revoke' | 'uninstall' | 'stop-forwarder';
    params?: Record<string, string>;
  };
  /** Channels route request. */
  channels?: {
    podId: string;
    action?: 'add' | 'remove';
    type?: string;
  };
  /** Files route request. */
  files?: {
    podId: string;
    tab?: 'inbox' | 'downloads' | 'shared';
  };
  /** Terminal launch request. `shell` opens the user's login shell; `tytus` runs an allow-listed Tytus CLI flow in a PTY. */
  terminal?: {
    command: 'shell' | 'tytus';
    args?: string[];
  };
  /** API Tester preset request. `ail` seeds the Collections panel with the
   * full AIL endpoint catalog wired to the active included pod's URL+key. */
  apiTester?: {
    collection?: 'ail';
  };
  /** Text Editor pre-load. `nodeId` opens an existing VFS file. `initialContent`
   * (with optional `fileName`) opens a fresh untitled buffer — Save lands it in
   * Documents. Used by Music Creator to push generated lyrics into the editor. */
  editor?: {
    nodeId?: string;
    fileName?: string;
    initialContent?: string;
  };
  /** Music Player play intent — `trackId` resolves against the SQLite gallery. */
  music?: {
    trackId?: string;
  };
}

export interface Window {
  id: string;
  appId: string;
  title: string;
  position: Position;
  size: Size;
  state: WindowState;
  prevPosition?: Position;
  prevSize?: Size;
  isFocused: boolean;
  zIndex: number;
  icon: string;
  createdAt: number;
  args?: WindowArgs;
}

export type AppCategory = 'System' | 'Internet' | 'Productivity' | 'Media' | 'DevTools' | 'Games' | 'Creative';

export interface AppDefinition {
  id: string;
  name: string;
  icon: string;
  category: AppCategory;
  description: string;
  defaultSize: Size;
  minSize: Size;
  component?: string;
  /** Roadmap phase the real implementation lands in (placeholder until then). */
  phase?: number;
  /**
   * Manifest AN8 — apps gated behind the Settings → Display
   * "Show demo apps" toggle. Default OFF for paid users so the
   * launcher only shows the apps with a real product role.
   */
  isDemo?: boolean;
}

// --------------------------------------------------------
// Virtual File System
// --------------------------------------------------------

export type FileNodeType = 'file' | 'folder';

export interface FileSystemNode {
  id: string;
  name: string;
  type: FileNodeType;
  parentId: string | null;
  createdAt: number;
  modifiedAt: number;
  content?: string;
  size?: number;
  isHidden?: boolean;
  /** Optional MIME hint — drives icon + open-with for non-text files. */
  mimeType?: string;
  /** Shortcut to a SQLite-stored Music Creator track. The VFS node is just
   * a metadata stub; audio bytes live in `music_creator_tracks.audio_data_url`.
   * Lets `.mp3` files exist on Desktop without bloating localStorage. */
  refTrackId?: string;
}

export interface TrashItemMetadata {
  originalPath: string;
  deletedAt: number;
}

export interface FileSystemState {
  nodes: Record<string, FileSystemNode>;
  trashMetadata: Record<string, TrashItemMetadata>;
}

// --------------------------------------------------------
// Desktop
// --------------------------------------------------------

export interface DesktopIcon {
  id: string;
  name: string;
  icon: string;
  appId?: string;
  fileSystemNodeId?: string;
  /** Phase 3.1 — daemon-backed shortcut. Mirrors the daemon-side shape
   *  of `FileRef` minus the discriminator (which is implicit here:
   *  daemonShortcut == daemon backend). When set, double-click should
   *  open the file via the daemon API rather than reading vfs bytes. */
  daemonShortcut?: {
    source: string;
    path: string;
    binding?: number;
    pod?: string;
    readonly?: boolean;
  };
  position: Position;
  isSelected: boolean;
}

// --------------------------------------------------------
// Theme
// --------------------------------------------------------

export type ThemeMode = 'dark' | 'light';

/** Light/dark switching policy. Default is "manual" (whatever `mode` says). */
export type ModeSchedule = 'manual' | 'always-light' | 'always-dark' | 'auto';

export type DockPosition = 'bottom' | 'left' | 'right';
export type DockSize = 'small' | 'medium' | 'large';

export interface DockTheme {
  position: DockPosition;
  size: DockSize;
  autoHide: boolean;
  /**
   * Persisted Dock app order. App ids that are missing from the
   * registry default order are appended at the end. The Trash icon
   * is fixed-last and never appears in this array.
   */
  order: string[];
}

export interface Theme {
  mode: ThemeMode;
  accent: string;
  wallpaper: string;
  /** Phase 1.2 Dock customization (position / size / auto-hide / order). */
  dock: DockTheme;
  /** Phase 1.3 Font scale (50%–150%, default 1.0 = 100%). */
  fontScale: number;
  /** Phase 1.4 Light/dark schedule. */
  modeSchedule: ModeSchedule;
  /** Phase 1.5 Lock screen wallpaper matches desktop wallpaper. */
  lockWallpaperMatchesDesktop: boolean;
  /** Sprint B Phase 6.4 Reduce window/dock animations. */
  reduceMotion?: boolean;
  /** Sprint B Phase 7 OS sound theme on/off. */
  soundEnabled?: boolean;
}

// --------------------------------------------------------
// Notifications
// --------------------------------------------------------

export interface Notification {
  id: string;
  appId: string;
  appName: string;
  appIcon: string;
  title: string;
  message: string;
  timestamp: number;
  isRead: boolean;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  action: string;
}

// --------------------------------------------------------
// Dock
// --------------------------------------------------------

export interface DockItem {
  appId: string;
  isPinned: boolean;
  isOpen: boolean;
  isFocused: boolean;
  bounce: boolean;
}

// --------------------------------------------------------
// Context Menu
// --------------------------------------------------------

export type ContextMenuType = 'desktop' | 'file' | 'dockIcon' | 'windowTitle' | 'text';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  action: string;
  disabled?: boolean;
  divider?: boolean;
  submenu?: ContextMenuItem[];
  toggle?: boolean;
  toggled?: boolean;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  type: ContextMenuType;
  items: ContextMenuItem[];
  contextData?: Record<string, unknown>;
}

// --------------------------------------------------------
// Boot / Auth
// --------------------------------------------------------

export type BootPhase = 'off' | 'logo' | 'loading' | 'transition' | 'desktop' | 'login' | 'complete';

export interface AuthState {
  isAuthenticated: boolean;
  isGuest: boolean;
  userName: string;
  /**
   * Local screen lock. This is intentionally separate from daemon auth:
   * lock hides the desktop without revoking pods or clearing tokens.
   */
  locked: boolean;
}

// --------------------------------------------------------
// OS Store State
// --------------------------------------------------------

export interface OSState {
  bootPhase: BootPhase;
  auth: AuthState;
  windows: Window[];
  apps: AppDefinition[];
  desktopIcons: DesktopIcon[];
  theme: Theme;
  notifications: Notification[];
  dockItems: DockItem[];
  contextMenu: ContextMenuState;
  appLauncherOpen: boolean;
  notificationCenterOpen: boolean;
  activeWindowId: string | null;
  nextZIndex: number;
  isAltTabbing: boolean;
  altTabIndex: number;
  // Per-app remembered geometry. Written on every move/resize, read by
  // OPEN_WINDOW / OPEN_OR_FOCUS_WINDOW so an app reopens at the user's
  // last position+size instead of a cascade default. Keyed by appId so
  // it survives even after every window of that app has been closed.
  windowGeometry: Record<string, { x: number; y: number; width: number; height: number }>;
  // Sprint B Phase 6.1 — per-window snap state. Keyed by windowId so
  // two windows of the same app can be snapped independently
  // (left half + right half). Holds the pre-snap frame for restore
  // when the user drags away from the snap or hits Restore.
  windowSnap: Record<string, WindowSnapEntry>;
  // Sprint B Phase 5.4f — host browser clipboard permission cache.
  // Persisted across reload so we don't re-prompt on every paste.
  // 'prompt' = haven't asked / can't tell.
  clipboardPermission: 'granted' | 'denied' | 'prompt';
}

export type SnapKind = 'left' | 'right' | 'top';

export interface WindowSnapEntry {
  kind: SnapKind;
  prev: { x: number; y: number; width: number; height: number };
}

// --------------------------------------------------------
// Actions
// --------------------------------------------------------

export type OSAction =
  | { type: 'SET_BOOT_PHASE'; phase: BootPhase }
  | { type: 'LOGIN'; isGuest: boolean }
  | { type: 'LOGOUT' }
  | { type: 'LOCK' }
  | { type: 'UNLOCK' }
  | { type: 'OPEN_WINDOW'; appId: string; title?: string; args?: WindowArgs }
  | { type: 'OPEN_OR_FOCUS_WINDOW'; appId: string; title?: string; args?: WindowArgs }
  | { type: 'CLOSE_WINDOW'; windowId: string }
  | { type: 'MINIMIZE_WINDOW'; windowId: string }
  | { type: 'MAXIMIZE_WINDOW'; windowId: string }
  | { type: 'RESTORE_WINDOW'; windowId: string }
  | { type: 'FOCUS_WINDOW'; windowId: string }
  | { type: 'MOVE_WINDOW'; windowId: string; position: Position }
  | { type: 'RESIZE_WINDOW'; windowId: string; size: Size }
  | { type: 'SNAP_WINDOW'; windowId: string; kind: SnapKind }
  | { type: 'UNSNAP_WINDOW'; windowId: string }
  | { type: 'SET_CLIPBOARD_PERMISSION'; state: 'granted' | 'denied' | 'prompt' }
  | { type: 'UPDATE_WINDOW_TITLE'; windowId: string; title: string }
  | { type: 'SET_ACTIVE_WINDOW'; windowId: string | null }
  | { type: 'TOGGLE_APP_LAUNCHER' }
  | { type: 'SET_APP_LAUNCHER'; open: boolean }
  | { type: 'TOGGLE_NOTIFICATION_CENTER' }
  | { type: 'ADD_NOTIFICATION'; notification: Omit<Notification, 'id' | 'timestamp'> }
  | { type: 'REMOVE_NOTIFICATION'; id: string }
  | { type: 'CLEAR_NOTIFICATIONS' }
  | { type: 'MARK_NOTIFICATION_READ'; id: string }
  | { type: 'ADD_DESKTOP_ICON'; icon: Omit<DesktopIcon, 'id'> }
  | { type: 'REMOVE_DESKTOP_ICON'; id: string }
  | { type: 'UPDATE_DESKTOP_ICON_POSITION'; id: string; position: Position }
  | { type: 'SELECT_DESKTOP_ICON'; id: string | null }
  | { type: 'SET_THEME'; theme: Partial<Theme> }
  | { type: 'TOGGLE_THEME' }
  | { type: 'PIN_DOCK_ITEM'; appId: string }
  | { type: 'UNPIN_DOCK_ITEM'; appId: string }
  | { type: 'BOUNCE_DOCK_ITEM'; appId: string }
  | { type: 'SHOW_CONTEXT_MENU'; x: number; y: number; menuType: ContextMenuType; items: ContextMenuItem[]; contextData?: Record<string, unknown> }
  | { type: 'HIDE_CONTEXT_MENU' }
  | { type: 'START_ALT_TAB' }
  | { type: 'CYCLE_ALT_TAB' }
  | { type: 'END_ALT_TAB' }
  | { type: 'CASCADE_WINDOWS' }
  | { type: 'MINIMIZE_ALL' };

// --------------------------------------------------------
// File Associations
// --------------------------------------------------------

export interface FileAssociation {
  extension: string;
  appId: string;
  icon: string;
  mimeType: string;
}
