import type { FileNode, WindowArgsByApp } from '@tytus/contracts';
import type { EventsApi } from './events';
import type { Manifest } from './manifest';
import type { AppCreateSession } from './session';

/**
 * Top-level Host API surface. The shell binds one `HostClient` per app at
 * mount time via `makeHostForApp(appId, manifest, entryUrls)`. Apps consume
 * it through `AppBootEnv.host`. The engine and any future headless agent
 * accept a HostClient directly; tests inject mocks.
 */
export interface HostClient {
  /** The app id this client is bound to. Read-only. */
  readonly appId: string;

  fs: FsApi;
  daemon: DaemonApi;
  windows: WindowsApi;
  notifications: NotificationsApi;
  shellMenu: ShellMenuApi;
  i18n: I18nApi;
  storage: StorageApi;
  events: EventsApi;
  media: MediaApi;
  assets: AssetsApi;
}

/**
 * Per-app boot environment passed to every workspace package's default
 * export. Includes the bound HostClient plus a pre-bound engine
 * `createSession` factory (already wired with the engine's AssetResolver,
 * so AI apps don't import shell internals to use AI). Apps that don't
 * need AI ignore `createSession`.
 */
export interface AppBootEnv {
  host: HostClient;
  createSession: AppCreateSession;
}

// ─── host.fs ─────────────────────────────────────────────────────────

export interface FsChangeEvent {
  kind: 'created' | 'modified' | 'deleted' | 'renamed';
  fileNodeId: string;
  parentId: string;
  name: string;
  /** Present only for `kind === 'renamed'`. */
  oldName?: string;
  isDirectory: boolean;
  mtimeMs: number;
}

export type UserFolderName =
  | 'music'
  | 'documents'
  | 'desktop'
  | 'downloads'
  | 'pictures';

export interface FsApi {
  ensureUserFolder(name: UserFolderName): Promise<string>;
  read(fileNodeId: string): Promise<string | Uint8Array>;
  write(fileNodeId: string, content: string | Uint8Array): Promise<void>;
  createFile(
    parentId: string,
    name: string,
    content: string | Uint8Array,
    opts?: { mimeType?: string; refTrackId?: string },
  ): Promise<string>;
  /** Returns the new folder's FileNode id. */
  createFolder(parentId: string, name: string): Promise<string>;
  /** Used for atomic _index.json rename-into-place patterns. */
  rename(fileNodeId: string, newName: string): Promise<void>;
  list(parentId: string): Promise<FileNode[]>;
  findChildByName(
    parentId: string,
    name: string,
  ): Promise<FileNode | null>;
  getNodeById(id: string): Promise<FileNode | null>;
  getIconForFileName(name: string): string;
  /** Watch a node by id (NOT path-glob). `recursive` fires on any descendant
   *  change. Returns a disposer. */
  watch(
    parentId: string,
    onChange: (event: FsChangeEvent) => void,
    opts?: { recursive?: boolean },
  ): () => void;
}

// ─── host.daemon ─────────────────────────────────────────────────────

/** Pod gateway state. The full shape lives in the shell's
 *  `useDaemonStateContext` and is refined as features land — apps only
 *  need to know the structural shape (id, status, listable). */
export interface Agent {
  id: string;
  status: 'idle' | 'busy' | 'offline' | string;
  meta?: Record<string, unknown>;
}

export interface Pod {
  id: string;
  agentId?: string;
  status: 'starting' | 'running' | 'stopped' | 'error' | string;
  /** Public HTTPS URL of the pod's gateway. Apps never assemble this
   *  manually — they go through `daemon.callPodEndpoint(podId, path)` so
   *  the bearer is injected without leaking into app code. Optional
   *  because pods that haven't fully booted may not have a public URL yet. */
  publicUrl?: string;
  /** Gateway kind. `'ail'` = switchAILocal-style OpenAI-compatible
   *  surface. Future kinds (vLLM-direct, llama.cpp HTTP, etc.) extend
   *  this string. Open-ended so apps can branch on the kind they
   *  support without the host-api needing a release for every new
   *  gateway shape. */
  kind?: 'ail' | string;
  meta?: Record<string, unknown>;
}

export interface DaemonState {
  agents: Agent[];
  included: Pod[];
}

// ─── Music daemon (same-origin /api/music/*) ─────────────────────────

export interface MusicStatus {
  ready: boolean;
  installing: boolean;
  source: string;
  version?: string | null;
  error?: string | null;
}

export interface MusicSearchResult {
  id: string;
  source: 'youtube';
  title: string;
  durationMs?: number | null;
  thumbnailUrl?: string | null;
  channel?: string | null;
}

export interface MusicStreamInfo {
  videoId: string;
  proxyUrl: string;
  durationMs?: number | null;
  title?: string | null;
  container?: string | null;
  codec?: string | null;
}

export interface MusicProviderStatus {
  id: string;
  name: string;
  kind: string;
  state: string;
  configured: boolean;
  needs: string[];
  capabilities: {
    searchTracks: boolean;
    searchAlbums: boolean;
    searchArtists: boolean;
    searchPlaylists: boolean;
    streamResolve: boolean;
    libraryMetadata: boolean;
    accountConnect: boolean;
  };
  loadMs?: number | null;
  message: string;
}

export interface MusicConnectorCredentialSpec {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface MusicConnectorStatus {
  provider: string;
  name: string;
  connected: boolean;
  configurable: boolean;
  oauthRequired: boolean;
  account?: string | null;
  credentialSpecs: MusicConnectorCredentialSpec[];
  verifiedAt?: string | null;
  lastError?: string | null;
  message: string;
}

export interface UnifiedMusicSearchResponse {
  provider: string;
  results: {
    tracks: MusicSearchResult[];
    albums: MusicSearchResult[];
    artists: MusicSearchResult[];
    playlists: MusicSearchResult[];
  };
  warnings: string[];
}

/**
 * Same-origin music gateway exposed by the local daemon. Gated by the
 * `daemon.network` permission. All methods accept an `AbortSignal` so
 * apps can cancel in-flight requests on unmount or new search input.
 */
export interface MusicDaemonApi {
  getStatus(signal?: AbortSignal): Promise<MusicStatus>;
  getProviders(signal?: AbortSignal): Promise<MusicProviderStatus[]>;
  getConnectors(signal?: AbortSignal): Promise<MusicConnectorStatus[]>;
  configureConnector(
    provider: string,
    credentials: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<MusicConnectorStatus>;
  disconnectConnector(
    provider: string,
    signal?: AbortSignal,
  ): Promise<MusicConnectorStatus>;
  search(
    query: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<MusicSearchResult[]>;
  searchUnified(
    query: string,
    types?: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<UnifiedMusicSearchResponse>;
  getStream(videoId: string, signal?: AbortSignal): Promise<MusicStreamInfo>;
}

// ─── JULI3TA generated-tracks library (same-origin /api/juli3ta/*) ────

export interface Juli3taFileTrack {
  id: string;
  title: string;
  styleTags: string;
  lyricsPreview: string;
  durationMs: number;
  bitrate: number;
  sampleRate: number;
  sizeBytes: number;
  createdAt: number;
  audioDataUrl: string;
  specsJson: string;
  coverDataUrl: string;
  theme: string;
  source?: 'juli3ta' | 'youtube';
  audioKind?: 'data_url' | 'remote_stream' | 'lyrics_only';
  externalId?: string;
  externalUrl?: string;
  thumbnailUrl?: string;
  artist?: string;
  album?: string;
  folderPath?: string;
  audioPath?: string;
  lyricsPath?: string;
  metadataPath?: string;
}

export interface Juli3taFileLibraryResponse {
  rootPath: string;
  tracks: Juli3taFileTrack[];
}

/**
 * JULI3TA library client — generated-track CRUD against the local
 * daemon's `~/Music/JULI3TA/` mirror. Gated by `daemon.network`.
 */
export interface Juli3taLibraryApi {
  listGeneratedTracks(): Promise<Juli3taFileLibraryResponse>;
  saveGeneratedTrack(track: Juli3taFileTrack): Promise<Juli3taFileTrack>;
  deleteGeneratedTrack(id: string): Promise<void>;
  openGeneratedTracksFolder(): Promise<string>;
}

export interface DaemonApi {
  readonly state: DaemonState;
  onStateChange(fn: (state: DaemonState) => void): () => void;
  callPodEndpoint(
    podId: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response>;
  /** Same-origin music gateway. Gated by `daemon.network`. */
  music: MusicDaemonApi;
  /** JULI3TA generated-tracks library. Gated by `daemon.network`. */
  juli3taLibrary: Juli3taLibraryApi;
}

// ─── host.windows ────────────────────────────────────────────────────

export type AnyWindowArgs = WindowArgsByApp[keyof WindowArgsByApp];

export interface WindowsApi {
  readonly current: {
    id: string;
    appId: string;
    args?: AnyWindowArgs;
  };
  open(
    appId: string,
    args?: AnyWindowArgs,
    opts?: { focus?: boolean },
  ): string;
  openOrFocus(appId: string, args?: AnyWindowArgs): string;
  close(windowId: string): void;
  addDesktopIcon(opts: {
    label: string;
    iconUrl: string;
    onClick: () => void;
  }): void;
}

// ─── host.notifications ──────────────────────────────────────────────

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotifyOpts {
  title: string;
  body?: string;
  level?: NotificationLevel;
  /** Auto-dismiss after this many ms; default 6000. */
  durationMs?: number;
  /** Override the bound caller's appId. Rare — only privileged shell
   *  surfaces (settings, app store) post notifications on behalf of
   *  another app. App-bound clients should omit and let the host
   *  derive `appId` from the bound HostClient. */
  appId?: string;
  /** Notification starts unread. Default `true`. Apps like Memo (which
   *  surface user-driven action) may pass `false` so the badge does
   *  not pop for an interaction the user already saw. */
  unread?: boolean;
}

export interface NotificationsApi {
  notify(opts: NotifyOpts): void;
}

// ─── host.shellMenu ──────────────────────────────────────────────────

export interface ShellMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  /** Disabled items show but don't fire. */
  disabled?: boolean;
  /** Submenu of further items. */
  items?: ShellMenuItem[];
  onClick?: () => void;
}

export interface ShellMenuSpec {
  appId: string;
  /** Top-level menu groups (e.g. `File`, `Edit`, `View`). */
  groups: { label: string; items: ShellMenuItem[] }[];
}

export interface ShellMenuApi {
  /** Register the app's menu while it's the foreground app. Returns a
   *  disposer that unregisters the menu (call on unmount). */
  register(spec: ShellMenuSpec): () => void;
}

// ─── host.i18n ───────────────────────────────────────────────────────

export interface I18nApi {
  readonly locale: string;
  /** Translate `key` for the active locale, with optional `vars`
   *  substitution (`{name}` → vars.name). Falls back to `key` if missing. */
  t(key: string, vars?: Record<string, string | number>): string;
  onLocaleChange(fn: (locale: string) => void): () => void;
}

// ─── host.storage ────────────────────────────────────────────────────

export interface RunResult {
  /** Last inserted rowid for INSERT statements. */
  lastInsertRowid: number | bigint;
  /** Number of rows changed for INSERT/UPDATE/DELETE. */
  changes: number;
}

export interface AppDb {
  /** Run an SQL statement. The app uses physical table names
   *  (`app_<sqlAppId>_<name>`). The engine's prefix guard validates that
   *  every table referenced in the SQL starts with the app's prefix; queries
   *  that touch other apps' tables throw `PermissionDeniedError`. */
  run(sql: string, args?: readonly unknown[]): Promise<RunResult>;
  query<T>(sql: string, args?: readonly unknown[]): Promise<T[]>;
  /** Run SQL files in `migrationsDir/`. Each file is executed once and
   *  tracked in `app_<sqlAppId>__migrations`. */
  migrate(migrationsDir: string): Promise<void>;
  /** Return the app's tables visible to the system. Used by the uninstall
   *  algorithm and by Settings → Storage. */
  listOwnedTables(): Promise<string[]>;
}

export interface SharedDb {
  /** Read-only handle to a shared table OWNED by another app.
   *  Inserts/updates/deletes throw `PermissionDeniedError`. */
  query<T>(sql: string, args?: readonly unknown[]): Promise<T[]>;
}

export interface StorageApi {
  /** Returns the bound app's own DB handle. No appId argument — implicit
   *  from the HostClient's appId. Apps cannot ask for another app's
   *  handle through this surface. */
  current(): AppDb;
  /** Privileged: returns any app's DB handle. NOT exposed to apps; only
   *  shell-internal code (App Store install/uninstall flow, daemon sync
   *  routines) calls this. The HostClient created by `makeHostForApp`
   *  THROWS PermissionDeniedError if `forApp(otherId)` is called from
   *  app code. */
  forApp(appId: string): AppDb;
  /** Read-only handle to a shared table key (declared in both apps'
   *  manifests via `storage.shares` + `storage.shared.<key>`). Returns
   *  null if the share isn't declared on both sides at install time. */
  forSharedKey(key: string): SharedDb | null;
}

// ─── host.media ──────────────────────────────────────────────────────

export interface MicrophoneStream {
  /** Live microphone stream from `navigator.mediaDevices.getUserMedia`. */
  stream: MediaStream;
  /** First MediaRecorder mime type the browser supports (probe ladder:
   *  `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`,
   *  `audio/ogg;codecs=opus`). Empty string if none of the candidates
   *  match — callers should treat that as "let MediaRecorder pick". */
  mimeType: string;
}

export interface MediaApi {
  /** Prompt the user for mic access and return the stream plus the
   *  best-supported MediaRecorder mime type. */
  requestMicrophone(): Promise<MicrophoneStream>;
  requestDisplay(): Promise<MediaStream>;
}

// ─── host.assets ─────────────────────────────────────────────────────

/**
 * App-bundled static assets. Paths are relative to the app bundle's
 * resolved `entry.assets` root. NO permission required — apps reading
 * their own bundle is free.
 *
 * Maximum size 1 MB; throws AssetTooLargeError if larger.
 * Path traversal (`../../etc`) throws AssetEscapeError.
 */
export interface AssetsApi {
  text(path: string): Promise<string>;
  bytes(path: string): Promise<Uint8Array>;
  /** Resolved absolute URL for an asset (use as `<img src>` etc.). */
  url(path: string): string;
}

// ─── Loader factory + React hook (declarations only) ──────────────────

/**
 * Build a HostClient bound to a specific app's identity. Called by the
 * shell's loader when mounting an app. Each app gets its OWN client whose
 * permissions, sqlAppId, asset root, and event scope are derived from the
 * app's manifest — apps cannot leak permissions or read other apps'
 * asset roots through this client. Implementation in
 * `apps/host/src/runtime/loader.ts`.
 */
export declare function makeHostForApp(
  appId: string,
  manifest: Manifest,
  entryUrls: { module: string; assets: string; css: string | null },
): HostClient;

/**
 * React hook for IN-TREE consumers ONLY (FileManager, Settings, Launcher,
 * legacy apps). Workspace-package apps receive `AppBootEnv` via their
 * default export — they do NOT call `useHost()`. Implementation in
 * `apps/host/src/hooks/useHost.ts`.
 */
export declare function useHost(): HostClient;
