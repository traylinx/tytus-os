/**
 * `makeHostForApp` — builds a HostClient bound to a specific app's identity.
 *
 * This is the implementation site for the function declared in
 * `@tytus/host-api/src/client.ts`. The loader calls this at mount time;
 * the React-side `useHost` hook reuses the same factory through
 * `HostContext` so in-tree consumers (FileManager, Settings, Launcher)
 * see the same surface.
 *
 * In M1 most namespaces are stubs that throw a clear message pointing to
 * the milestone where the real wiring lands. The shape is locked here so
 * callers can compile against the full surface today; the implementations
 * fill in incrementally:
 *
 * - `events`, `assets`, `i18n` (passthrough), `notifications` (noop):
 *   real-ish today. Apps relying on these for housekeeping work.
 * - `fs`: PR5 wires a localStorage-backed minimal implementation for
 *   Notes; M3 lifts to FileRef-backed under the existing useFileSystem.
 * - `storage`: M3 wires per-app SQLite via host.storage.forApp(appId)
 *   on top of the existing app/src/lib/db/ worker.
 * - `daemon`, `windows`, `shellMenu`, `media`: M3+ wires to existing
 *   contexts (useDaemonStateContext, useOSStore, useShellMenu).
 */

import type {
  AnyWindowArgs,
  AppBootEnv,
  AppCreateSession,
  AppDb,
  AssetsApi,
  DaemonApi,
  DaemonState,
  EventsApi,
  FsApi,
  FsChangeEvent,
  HostClient,
  I18nApi,
  Juli3taFileLibraryResponse,
  Juli3taFileTrack,
  Juli3taLibraryApi,
  LocalApi,
  LocalJob,
  LocalJobHandlers,
  LocalJobInput,
  LocalTool,
  Manifest,
  MediaApi,
  MicrophoneStream,
  MissionWriteResult,
  MissionsApi,
  MusicConnectorStatus,
  MusicDaemonApi,
  MusicProviderStatus,
  MusicSearchResult,
  MusicStatus,
  MusicStreamInfo,
  NotificationsApi,
  Pod,
  ResourcesApi,
  SharedDb,
  ShellEventName,
  ShellEventPayload,
  ShellMenuApi,
  ShellMenuSpec,
  SkillsApi,
  StorageApi,
  TytusResourceGraph,
  TytusMission,
  TytusSkillPack,
  TytusSkillSummary,
  UnifiedMusicSearchResponse,
  WindowsApi,
} from '@tytus/host-api';
import {
  AssetEscapeError,
  AssetTooLargeError,
  PermissionDeniedError,
} from '@tytus/host-api';

import type { EntryUrls } from './loader';
import { createDaemonFs } from './host-fs-daemon';
import { createLocalStorageFs } from './host-fs-localstorage';
import { createAppDb } from './storage-impl';
import { resolveManifestMigrations } from './app-migrations';
import {
  listInstalledApps,
  resolveSharedTableNames,
} from './installed-apps-repo';
import { getDb } from '@/lib/db';
import { makeAiApi } from './ai/host-api';

const ASSET_SIZE_LIMIT_BYTES = 1024 * 1024; // 1 MB per spec.

const notImpl = (name: string, milestone: string) => {
  return () => {
    throw new Error(
      `host.${name} is not implemented yet — wired in ${milestone}.`,
    );
  };
};

// ─── Shell bridges ────────────────────────────────────────────────────
// host-impl is plain JS — it can't read React context. The shell wires
// its live state and dispatch handlers in via setter functions below.
// Tests inject mocks the same way. Each setter is a clear seam so the
// data flow from React → host-impl is explicit.

/** Pod descriptor as the host-api Pod type sees it, plus a private
 *  `bearer` field the shell injects so callPodEndpoint can attach the
 *  Authorization header without exposing the secret to apps. */
export interface ShellPodDescriptor {
  pod: Pod;
  /** Bearer token. Populated by the shell from the daemon's Secret-typed
   *  user_key via `revealSecret(secret, 'user_gesture')`. */
  bearer: string | null;
}

interface DaemonStateProvider {
  getState(): DaemonState;
  /** Resolve a pod by id including its bearer; null if the pod is not
   *  in the current included set. */
  getPod(podId: string): ShellPodDescriptor | null;
  subscribe(fn: (s: DaemonState) => void): () => void;
}

let DAEMON_STATE_PROVIDER: DaemonStateProvider | null = null;
const EMPTY_DAEMON_STATE: DaemonState = { agents: [], included: [] };
const DAEMON_STATE_SUBSCRIBERS = new Set<(s: DaemonState) => void>();
let daemonProviderUnsubscribe: (() => void) | null = null;

function emitDaemonState(state: DaemonState): void {
  for (const fn of [...DAEMON_STATE_SUBSCRIBERS]) {
    try {
      fn(state);
    } catch {
      // subscriber faults must not break the shell bridge
    }
  }
}

function subscribeDaemonState(fn: (s: DaemonState) => void): () => void {
  DAEMON_STATE_SUBSCRIBERS.add(fn);
  const provider = DAEMON_STATE_PROVIDER;
  if (provider) {
    queueMicrotask(() => {
      if (DAEMON_STATE_SUBSCRIBERS.has(fn)) {
        try {
          fn(provider.getState());
        } catch {
          // subscriber faults must not break the shell bridge
        }
      }
    });
  }
  return () => {
    DAEMON_STATE_SUBSCRIBERS.delete(fn);
  };
}

export function setDaemonStateProvider(
  provider: DaemonStateProvider | null,
): void {
  daemonProviderUnsubscribe?.();
  daemonProviderUnsubscribe = null;
  DAEMON_STATE_PROVIDER = provider;
  if (!provider) return;

  // One shell-level subscription fans out to every HostClient. This keeps
  // host.daemon subscriptions valid even when an app's HostClient was built
  // before HostBridgeWiring mounted (browser reload + restored windows).
  daemonProviderUnsubscribe = provider.subscribe(emitDaemonState);
  emitDaemonState(provider.getState());
}

interface WindowsActions {
  open(appId: string, args?: AnyWindowArgs): string;
  openOrFocus(appId: string, args?: AnyWindowArgs): string;
  close(windowId: string): void;
  addDesktopIcon(opts: {
    label: string;
    iconUrl: string;
    onClick: () => void;
  }): void;
  /** The active window the calling app currently owns. Null when the
   *  app has no open window — apps that need a window-id at boot should
   *  open one first. */
  current(appId: string): { id: string; appId: string; args?: AnyWindowArgs };
}

let WINDOWS_ACTIONS: WindowsActions | null = null;
export function setWindowsActions(actions: WindowsActions | null): void {
  WINDOWS_ACTIONS = actions;
}

interface ShellMenuActions {
  registerForApp(spec: ShellMenuSpec): () => void;
}

let SHELL_MENU_ACTIONS: ShellMenuActions | null = null;
export function setShellMenuActions(actions: ShellMenuActions | null): void {
  SHELL_MENU_ACTIONS = actions;
}

// ─── Same-origin JSON helpers ─────────────────────────────────────────
// These bind to whatever `globalThis.fetch` resolves to at call time so
// tests can swap fetch via vi.stubGlobal without touching this module.

interface JsonHttpError extends Error {
  status: number;
  code: string;
}

const httpError = (status: number, code: string, message: string): JsonHttpError => {
  const err = new Error(message) as JsonHttpError;
  err.status = status;
  err.code = code;
  return err;
};

const sameOriginGetJson = async <T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> => {
  const res = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const maybe = body as { error?: unknown } | null;
    const code =
      typeof maybe?.error === 'string' ? maybe.error : `http_${res.status}`;
    throw httpError(res.status, code, code);
  }
  return body as T;
};

const sameOriginPostJson = async <T>(
  path: string,
  body: unknown,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> => {
  const res = await fetch(path, {
    method: 'POST',
    ...(init ?? {}),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const maybe = parsed as { error?: unknown } | null;
    const code =
      typeof maybe?.error === 'string' ? maybe.error : `http_${res.status}`;
    throw httpError(res.status, code, code);
  }
  return parsed as T;
};

/**
 * In-memory shell event bus. One instance per shell boot, shared across
 * every HostClient. Apps subscribe through their bound `host.events.on`;
 * the shell's own privileged emissions (from the registry, the loader,
 * etc.) go through `getShellEventBus().emit` directly.
 */
class ShellEventBus implements EventsApi {
  private listeners = new Map<
    ShellEventName,
    Set<(payload: unknown) => void>
  >();

  on<E extends ShellEventName>(
    name: E,
    fn: (payload: ShellEventPayload[E]) => void,
  ): () => void {
    let bucket = this.listeners.get(name);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(name, bucket);
    }
    bucket.add(fn as (payload: unknown) => void);
    return () => {
      const b = this.listeners.get(name);
      if (b) {
        b.delete(fn as (payload: unknown) => void);
        if (b.size === 0) this.listeners.delete(name);
      }
    };
  }

  emit<E extends ShellEventName>(
    name: E,
    payload: ShellEventPayload[E],
  ): void {
    const bucket = this.listeners.get(name);
    if (!bucket) return;
    // Snapshot before iterating — handlers may unsubscribe during dispatch.
    for (const fn of [...bucket]) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[host.events] listener threw', { name, err });
      }
    }
  }

  /** Test-only: clear every subscription. */
  __reset(): void {
    this.listeners.clear();
  }
}

let SHELL_EVENT_BUS: ShellEventBus | null = null;
export function getShellEventBus(): ShellEventBus {
  if (!SHELL_EVENT_BUS) SHELL_EVENT_BUS = new ShellEventBus();
  return SHELL_EVENT_BUS;
}

/** Build the assets namespace bound to this app's bundle root. */
function makeAssetsApi(appId: string, assetsRoot: string): AssetsApi {
  const ensureSafe = (path: string): string => {
    if (path.startsWith('/')) {
      throw new AssetEscapeError(path);
    }
    if (path.includes('..')) {
      throw new AssetEscapeError(path);
    }
    // Normalize trailing slash on root + leading slash on path so we always
    // produce a single slash join.
    const root = assetsRoot.endsWith('/') ? assetsRoot : `${assetsRoot}/`;
    return root + path.replace(/^\/+/, '');
  };
  return {
    async text(path: string): Promise<string> {
      const url = ensureSafe(path);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `host.assets.text: fetch failed (${res.status}) for ${url}`,
        );
      }
      const text = await res.text();
      if (text.length > ASSET_SIZE_LIMIT_BYTES) {
        throw new AssetTooLargeError({
          path,
          sizeBytes: text.length,
          limitBytes: ASSET_SIZE_LIMIT_BYTES,
        });
      }
      return text;
    },
    async bytes(path: string): Promise<Uint8Array> {
      const url = ensureSafe(path);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `host.assets.bytes: fetch failed (${res.status}) for ${url}`,
        );
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > ASSET_SIZE_LIMIT_BYTES) {
        throw new AssetTooLargeError({
          path,
          sizeBytes: buf.byteLength,
          limitBytes: ASSET_SIZE_LIMIT_BYTES,
        });
      }
      return new Uint8Array(buf);
    },
    url(path: string): string {
      return ensureSafe(path);
    },
  };
  // appId is deliberately not used — assets are app-scoped via assetsRoot,
  // which the loader resolves per-app at mount time.
  void appId;
}

/** Build the i18n namespace. M1: passthrough — apps see keys verbatim
 *  unless the shell injects a real implementation later via setI18n(). */
let I18N_OVERRIDE: I18nApi | null = null;
export function setI18nOverride(api: I18nApi | null): void {
  I18N_OVERRIDE = api;
}
function makeI18nApi(): I18nApi {
  if (I18N_OVERRIDE) return I18N_OVERRIDE;
  const noChange = () => () => {};
  return {
    locale: 'en',
    t: (key, vars) => {
      if (!vars) return key;
      // Trivial substitution so AppBootEnv consumers can use t('hello, {name}')
      // and get something sensible in M1.
      return key.replace(
        /\{([a-zA-Z0-9_-]+)\}/g,
        (_match, name) => String(vars[name] ?? `{${name}}`),
      );
    },
    onLocaleChange: noChange,
  };
}

/** Build the notifications namespace. Records each notify call into an
 *  inspectable queue (the shell drains this into the OS notification
 *  store on a timer). The bound `appId` is the caller's identity by
 *  default; `opts.appId` overrides it for the rare privileged shell
 *  surface that posts on behalf of another app. `unread` defaults to
 *  true — apps like Memo that want a silent audit trail pass `false`. */
const NOTIFICATION_QUEUE: Array<{
  appId: string;
  title: string;
  body?: string;
  level?: string;
  durationMs?: number;
  unread: boolean;
  ts: number;
}> = [];
export function getNotificationQueue() {
  return NOTIFICATION_QUEUE.slice();
}
export function clearNotificationQueue(): void {
  NOTIFICATION_QUEUE.length = 0;
}
function makeNotificationsApi(boundAppId: string): NotificationsApi {
  return {
    notify(opts) {
      const appId = opts.appId ?? boundAppId;
      const unread = opts.unread ?? true;
      NOTIFICATION_QUEUE.push({
        appId,
        title: opts.title,
        body: opts.body,
        level: opts.level,
        durationMs: opts.durationMs,
        unread,
        ts: Date.now(),
      });
      // Surface in dev so missing UI doesn't hide bugs.
      console.info('[host.notifications]', appId, opts.title, opts.body ?? '');
    },
  };
}

/** Build the fs namespace. Real daemon-backed files are preferred so
 *  standalone apps write into OS-visible folders. localStorage remains a
 *  fallback for browser-only tests/offline demos where the daemon is absent. */
function makeFsApi(): FsApi {
  const emitFsChange = (event: FsChangeEvent) => {
    getShellEventBus().emit('vfs.changed', {
      fileNodeId: event.fileNodeId,
      parentId: event.parentId,
      kind: event.kind,
    });
  };
  const fallback = createLocalStorageFs({ onChange: emitFsChange });
  return createDaemonFs({ fallback, onChange: emitFsChange });
}


/** Build the daemon namespace. Reads live state through the
 *  shell-injected DaemonStateProvider so the React side owns the polling
 *  loop and host-impl stays React-free. `callPodEndpoint` delegates to
 *  the same-origin tray proxy so browser apps never call public pod
 *  origins directly (CORS) and never receive gateway secrets. The music
 *  and juli3taLibrary sub-clients hit same-origin daemon HTTP routes. */
function makeDaemonApi(): DaemonApi {
  const callPodEndpoint = async (
    podId: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const provider = DAEMON_STATE_PROVIDER;
    if (!provider) {
      throw new Error(
        'host.daemon.callPodEndpoint: no DaemonStateProvider wired. ' +
          'Call setDaemonStateProvider() at shell boot or in tests.',
      );
    }
    const descriptor = provider.getPod(podId);
    if (!descriptor) {
      throw new Error(
        `host.daemon.callPodEndpoint: pod "${podId}" not found in current daemon state.`,
      );
    }
    const headers = new Headers(init?.headers ?? {});
    headers.delete('Authorization');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `/api/pods/${encodeURIComponent(podId)}/proxy${normalizedPath}`;
    return fetch(url, { ...init, headers });
  };

  return {
    get state() {
      return DAEMON_STATE_PROVIDER?.getState() ?? EMPTY_DAEMON_STATE;
    },
    onStateChange: subscribeDaemonState,
    callPodEndpoint,
    music: makeMusicDaemonApi(),
    juli3taLibrary: makeJuli3taLibraryApi(),
  };
}

/** Same-origin music gateway client. Mirrors the verbs from
 *  app/src/lib/musicDaemon.ts so the in-tree extraction can swap import
 *  sites for `host.daemon.music.*` without behavior change. */
function makeMusicDaemonApi(): MusicDaemonApi {
  return {
    getStatus: (signal) =>
      sameOriginGetJson<MusicStatus>('/api/music/status', signal),
    getProviders: async (signal) => {
      const body = await sameOriginGetJson<{ providers: MusicProviderStatus[] }>(
        '/api/music/providers',
        signal,
      );
      return body.providers ?? [];
    },
    getConnectors: async (signal) => {
      const body = await sameOriginGetJson<{
        connectors: MusicConnectorStatus[];
      }>('/api/music/connectors', signal);
      return body.connectors ?? [];
    },
    configureConnector: (provider, credentials, signal) =>
      sameOriginPostJson<MusicConnectorStatus>(
        '/api/music/connectors/configure',
        { provider, credentials },
        undefined,
        signal,
      ),
    disconnectConnector: (provider, signal) =>
      sameOriginPostJson<MusicConnectorStatus>(
        '/api/music/connectors/disconnect',
        { provider },
        undefined,
        signal,
      ),
    search: async (query, limit = 20, signal) => {
      const q = new URLSearchParams({ q: query, limit: String(limit) });
      const body = await sameOriginGetJson<{ results: MusicSearchResult[] }>(
        `/api/music/search?${q.toString()}`,
        signal,
      );
      return body.results ?? [];
    },
    searchUnified: (
      query,
      types = 'tracks,albums,artists,playlists',
      limit = 20,
      signal,
    ) => {
      const q = new URLSearchParams({
        q: query,
        types,
        provider: 'auto',
        limit: String(limit),
      });
      return sameOriginGetJson<UnifiedMusicSearchResponse>(
        `/api/music/search2?${q.toString()}`,
        signal,
      );
    },
    getStream: (videoId, signal) => {
      const q = new URLSearchParams({ videoId });
      return sameOriginGetJson<MusicStreamInfo>(
        `/api/music/stream?${q.toString()}`,
        signal,
      );
    },
  };
}

/** JULI3TA generated-tracks library client. Saves/lists/deletes go
 *  through same-origin daemon routes so the daemon stays the source of
 *  truth for files under ~/Music/JULI3TA. Browser SQLite is a warm cache
 *  only. */
function makeJuli3taLibraryApi(): Juli3taLibraryApi {
  return {
    listGeneratedTracks: () =>
      sameOriginGetJson<Juli3taFileLibraryResponse>(
        '/api/juli3ta/library/tracks',
      ),
    saveGeneratedTrack: async (track: Juli3taFileTrack) => {
      const body: Juli3taFileTrack = {
        ...track,
        source: track.source ?? 'juli3ta',
        audioKind:
          track.audioKind ??
          (track.audioDataUrl ? 'data_url' : 'lyrics_only'),
      };
      const res = await sameOriginPostJson<{
        ok: boolean;
        rootPath: string;
        track: Juli3taFileTrack;
      }>(
        '/api/juli3ta/library/tracks',
        body,
        {
          headers: {
            'Idempotency-Key': `juli3ta-save-${track.id}-${track.createdAt}`,
          },
        },
      );
      return res.track;
    },
    deleteGeneratedTrack: async (id: string) => {
      await sameOriginPostJson<{ ok: boolean }>(
        '/api/juli3ta/library/delete',
        { id },
        {
          headers: { 'Idempotency-Key': `juli3ta-delete-${id}` },
        },
      );
    },
    openGeneratedTracksFolder: async () => {
      const res = await sameOriginPostJson<{ ok: boolean; path: string }>(
        '/api/juli3ta/library/open-folder',
        {},
        {
          headers: {
            'Idempotency-Key': `juli3ta-open-folder-${Date.now()}`,
          },
        },
      );
      return res.path;
    },
  };
}

function makeLocalApi(): LocalApi {
  return {
    async listTools(signal?: AbortSignal): Promise<LocalTool[]> {
      const body = await sameOriginGetJson<{ tools?: LocalTool[] }>(
        '/api/local/tools',
        signal,
      );
      return body.tools ?? [];
    },
    async openTerminal(input = {}): Promise<void> {
      if (!WINDOWS_ACTIONS) {
        throw new Error(
          'host.local.openTerminal: no WindowsActions wired. Call setWindowsActions() at shell boot.',
        );
      }
      const launchLine = terminalLaunchLine(input);
      WINDOWS_ACTIONS.openOrFocus('terminal', {
        terminal: {
          command: 'shell',
          initialInput: launchLine,
        },
      } as unknown as AnyWindowArgs);
    },
    async runJob(input: LocalJobInput, signal?: AbortSignal): Promise<LocalJob> {
      return sameOriginPostJson<LocalJob>(
        '/api/local/jobs',
        input,
        undefined,
        signal,
      );
    },
    streamJob(jobId: string, handlers: LocalJobHandlers): () => void {
      const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
      source.addEventListener('log', (event) => {
        const data = (event as MessageEvent<string>).data;
        handlers.onEvent?.({ kind: 'log', data });
        handlers.onLog?.(data);
      });
      source.addEventListener('done', (event) => {
        const data = (event as MessageEvent<string>).data;
        handlers.onEvent?.({ kind: 'done', data });
        handlers.onDone?.(data);
      });
      source.addEventListener('fail', (event) => {
        const data = (event as MessageEvent<string>).data;
        handlers.onEvent?.({ kind: 'fail', data });
        handlers.onFail?.(data);
        source.close();
      });
      source.addEventListener('exit', (event) => {
        const data = (event as MessageEvent<string>).data;
        handlers.onEvent?.({ kind: 'exit', data });
        try {
          handlers.onExit?.(JSON.parse(data).code ?? -1);
        } catch {
          handlers.onExit?.(-1);
        }
        source.close();
      });
      source.onerror = (event) => handlers.onError?.(event);
      return () => source.close();
    },
    async cancelJob(jobId: string, signal?: AbortSignal): Promise<void> {
      await sameOriginPostJson<{ ok?: boolean }>(
        `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
        {},
        undefined,
        signal,
      );
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function terminalLaunchLine(input: { toolId?: string; command?: string; prompt?: string; cwd?: string; args?: string[] }): string {
  const lines: string[] = [];
  if (input.cwd) lines.push(`cd ${shellQuote(input.cwd)}`);
  if (input.prompt) {
    lines.push(`# Tytus context: ${input.prompt.replace(/\r?\n/g, ' ').slice(0, 500)}`);
  }
  const command = input.command && input.command !== 'shell' ? input.command : input.toolId;
  if (command && command !== 'terminal') {
    const args = input.args?.map(shellQuote).join(' ') ?? '';
    lines.push(`${command}${args ? ` ${args}` : ''}`);
  }
  const text = lines.filter(Boolean).join('\n');
  return text ? `${text}` : '';
}

function makeSkillsApi(): SkillsApi {
  return {
    async list(input = {}): Promise<TytusSkillSummary[]> {
      const q = new URLSearchParams();
      if (input.appId) q.set('appId', input.appId);
      if (input.source) q.set('source', input.source);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      const body = await sameOriginGetJson<{ skills?: TytusSkillSummary[] }>(
        `/api/skills${suffix}`,
        input.signal,
      );
      return body.skills ?? [];
    },
    get(id: string, signal?: AbortSignal): Promise<TytusSkillPack> {
      return sameOriginGetJson<TytusSkillPack>(
        `/api/skills/${encodeURIComponent(id)}`,
        signal,
      );
    },
    async resolve(input): Promise<TytusSkillSummary[]> {
      const body = await sameOriginPostJson<{ skills?: TytusSkillSummary[] }>(
        '/api/skills/resolve',
        {
          prompt: input.prompt,
          appId: input.appId,
          mimeType: input.mimeType,
        },
        undefined,
        input.signal,
      );
      return body.skills ?? [];
    },
  };
}

function makeResourcesApi(): ResourcesApi {
  const list = (signal?: AbortSignal): Promise<TytusResourceGraph> =>
    sameOriginGetJson<TytusResourceGraph>('/api/resources', signal);
  return {
    list,
    refresh: list,
  };
}

function makeMissionsApi(): MissionsApi {
  return {
    async list(signal?: AbortSignal) {
      const body = await sameOriginGetJson<{ missions?: import('@tytus/host-api').TytusMissionSummary[] }>(
        '/api/missions',
        signal,
      );
      return body.missions ?? [];
    },
    async listRuns(rootPath: string, signal?: AbortSignal) {
      const body = await sameOriginGetJson<{ runs?: import('@tytus/host-api').TytusMissionRun[] }>(
        `/api/missions/runs?rootPath=${encodeURIComponent(rootPath)}`,
        signal,
      );
      return body.runs ?? [];
    },
    create(input): Promise<TytusMission> {
      return sameOriginPostJson<TytusMission>(
        '/api/missions',
        { title: input.title, goal: input.goal ?? '' },
        undefined,
        input.signal,
      );
    },
    write(input): Promise<MissionWriteResult> {
      return sameOriginPostJson<MissionWriteResult>(
        '/api/missions/write',
        { rootPath: input.rootPath, files: input.files },
        undefined,
        input.signal,
      );
    },
  };
}

/** Build the windows namespace. The shell wires its useOSStore dispatch
 *  surface in via setWindowsActions; calls before the wiring lands
 *  throw a clear "no shell yet" error rather than a no-op so missing
 *  initialization is visible. */
function makeWindowsApi(appId: string): WindowsApi {
  const requireActions = (): WindowsActions => {
    if (!WINDOWS_ACTIONS) {
      throw new Error(
        'host.windows: no WindowsActions wired. Call setWindowsActions() at shell boot.',
      );
    }
    return WINDOWS_ACTIONS;
  };
  return {
    get current() {
      // `current` reads through every access so the bound app sees the
      // most recently focused window, not whatever was active at boot.
      // When no shell is wired (legacy in-tree calls during the shell's
      // own boot), fall back to a synthetic descriptor — apps that need
      // a real window-id call open() first.
      if (!WINDOWS_ACTIONS) return { id: 'stub', appId };
      try {
        return WINDOWS_ACTIONS.current(appId);
      } catch {
        return { id: 'stub', appId };
      }
    },
    open: (id, args) => requireActions().open(id, args),
    openOrFocus: (id, args) => requireActions().openOrFocus(id, args),
    close: (id) => requireActions().close(id),
    addDesktopIcon: (opts) => requireActions().addDesktopIcon(opts),
  };
}

/** Build the shellMenu namespace. Forwards `register(spec)` to the
 *  shell's per-app menu store; the shell maps the app's spec onto the
 *  active window when one becomes foreground. Without a wired actions
 *  surface (tests that don't care about menus, host pre-shell-boot)
 *  the call is a no-op disposer so app code stays simple. */
function makeShellMenuApi(): ShellMenuApi {
  return {
    register: (spec) => {
      if (!SHELL_MENU_ACTIONS) {
        return () => {};
      }
      return SHELL_MENU_ACTIONS.registerForApp(spec);
    },
  };
}

/** Build the storage namespace bound to the given appId.
 *  Per-app AppDb backed by the live SQLite worker, with the prefix
 *  guard enforcing physical-name discipline. `forSharedKey(key)` reads
 *  the bound app's manifest synchronously to confirm the permission is
 *  declared, then returns a SharedDb that lazily resolves the owner's
 *  physical table on first query — installed_apps may not be seeded
 *  yet at construction time and the host-api surface is sync. */
function makeStorageApi(appId: string, manifest: Manifest): StorageApi {
  // Cache resolved shared-table names so we don't query installed_apps
  // on every host.storage.current() call. The cache is invalidated on
  // app.installed / app.uninstalled / app.updated events from the
  // shell event bus.
  let sharedTableCache: string[] | null = null;
  const bus = getShellEventBus();
  const invalidate = () => {
    sharedTableCache = null;
  };
  bus.on('app.installed', invalidate);
  bus.on('app.uninstalled', invalidate);
  bus.on('app.updated', invalidate);

  const migrations = resolveManifestMigrations(manifest);

  const lazyAppDb = async (): Promise<AppDb> => {
    const db = getDb();
    if (!db) {
      throw new Error(
        `host.storage.current(): SQLite DB not initialized yet. Call initDb() at boot or setDbForTesting() in tests.`,
      );
    }
    if (sharedTableCache === null) {
      try {
        sharedTableCache = await resolveSharedTableNames(db, appId);
      } catch {
        // installed_apps may not exist yet (M5 wires the seed). Treat
        // as no shared tables — the prefix guard still permits the
        // app's own tables.
        sharedTableCache = [];
      }
    }
    return createAppDb({
      db,
      appId,
      sharedTableNames: sharedTableCache,
      migrations,
    });
  };

  // host.storage.current() in the host-api spec is sync — but its
  // returned AppDb's methods are async, so we can resolve shared
  // tables on the first run/query call. Wrap a thin async-aware proxy.
  const proxyDb: AppDb = {
    async run(sql, args) {
      const inner = await lazyAppDb();
      return inner.run(sql, args);
    },
    async query<T>(sql: string, args?: readonly unknown[]) {
      const inner = await lazyAppDb();
      return inner.query<T>(sql, args);
    },
    async migrate(dir) {
      const inner = await lazyAppDb();
      return inner.migrate(dir);
    },
    async listOwnedTables() {
      const inner = await lazyAppDb();
      return inner.listOwnedTables();
    },
  };

  return {
    current: () => proxyDb,
    forApp: () => {
      throw new Error(
        `host.storage.forApp is not callable from app code — privileged path only. App "${appId}" attempted.`,
      );
    },
    forSharedKey: (key: string): SharedDb | null => {
      // Sync permission check from the bound manifest — apps that don't
      // declare `storage.shared.<key>` get a clear PermissionDeniedError
      // immediately (NOT a silent null) so the foot-gun is visible at
      // call time, not when the empty result confuses the consumer.
      const requested = `storage.shared.${key}`;
      const granted = (manifest.permissions ?? []).some(
        (p) => p === requested,
      );
      if (!granted) {
        throw new PermissionDeniedError({
          permission: requested,
          appId,
          message: `App "${appId}" did not declare permission "${requested}" — add it to the manifest's permissions[] to read shared key "${key}".`,
        });
      }

      // Lazy owner-table resolution. The shared-key SharedDb only
      // exposes query(); inserts/updates/deletes throw at the AppDb
      // layer because SharedDb has no run/migrate surface. The
      // underlying AppDb is constructed with `sharedTableNames: [resolved]`
      // so the prefix guard accepts that one physical table.
      let cachedReadOnly: AppDb | null = null;
      let cachedSharedTables: string[] | null = null;
      const resolveOwner = async (): Promise<{
        appDb: AppDb;
        tables: string[];
      }> => {
        if (cachedReadOnly && cachedSharedTables) {
          return { appDb: cachedReadOnly, tables: cachedSharedTables };
        }
        const db = getDb();
        if (!db) {
          throw new Error(
            `host.storage.forSharedKey("${key}"): SQLite DB not initialized yet.`,
          );
        }
        // Ask the registry which physical tables this reader is
        // allowed to consume; if the requested key isn't backed by an
        // installed owner, throw — silent empty would shadow a real
        // installation gap.
        const installed = await listInstalledApps(db);
        const owners = installed.filter((row) => {
          if (row.id === appId) return false;
          const shares = row.manifest.storage?.shares;
          return shares && Object.prototype.hasOwnProperty.call(shares, key);
        });
        if (owners.length === 0) {
          throw new Error(
            `host.storage.forSharedKey("${key}"): no installed app declares storage.shares.${key}.`,
          );
        }
        const tables = await resolveSharedTableNames(db, appId);
        cachedSharedTables = tables;
        cachedReadOnly = createAppDb({
          db,
          appId,
          sharedTableNames: tables,
        });
        return { appDb: cachedReadOnly, tables };
      };

      return {
        async query<T>(sql: string, args?: readonly unknown[]): Promise<T[]> {
          const { appDb } = await resolveOwner();
          return appDb.query<T>(sql, args);
        },
      } satisfies SharedDb;
    },
  };
}

/** Build the media namespace. `requestMicrophone` runs the same probe
 *  ladder as the in-tree VoiceRecorder so callers don't have to repeat
 *  the logic — the host returns the live stream + the best-supported
 *  MediaRecorder mime type in one call. `requestDisplay` stays stubbed
 *  until a real shell consumer surfaces. */
const MIC_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function makeMediaApi(): MediaApi {
  return {
    requestMicrophone: async (): Promise<MicrophoneStream> => {
      const md = navigator?.mediaDevices;
      if (!md || typeof md.getUserMedia !== 'function') {
        throw new Error(
          'host.media.requestMicrophone: navigator.mediaDevices.getUserMedia is unavailable.',
        );
      }
      const stream = await md.getUserMedia({ audio: true });
      const recorderCtor =
        (globalThis as unknown as {
          MediaRecorder?: { isTypeSupported(type: string): boolean };
        }).MediaRecorder;
      const mimeType = recorderCtor
        ? MIC_MIME_CANDIDATES.find((m) => recorderCtor.isTypeSupported(m)) ??
          ''
        : '';
      return { stream, mimeType };
    },
    requestDisplay: notImpl('media.requestDisplay', 'post-W2'),
  };
}

/**
 * Real implementation of `makeHostForApp` from `@tytus/host-api`. Builds a
 * HostClient bound to the given appId, with each namespace either real
 * (events, assets, i18n, notifications) or a clearly-labelled stub
 * (fs, daemon, windows, shellMenu, storage, media) for downstream
 * milestones to fill in.
 */
export function makeHostForApp(
  appId: string,
  manifest: Manifest,
  entryUrls: EntryUrls,
): HostClient {
  const daemon = makeDaemonApi();
  return {
    appId,
    fs: makeFsApi(),
    daemon,
    windows: makeWindowsApi(appId),
    notifications: makeNotificationsApi(appId),
    shellMenu: makeShellMenuApi(),
    i18n: makeI18nApi(),
    storage: makeStorageApi(appId, manifest),
    events: getShellEventBus(),
    ai: makeAiApi({ appId, manifest, daemon }),
    local: makeLocalApi(),
    skills: makeSkillsApi(),
    resources: makeResourcesApi(),
    missions: makeMissionsApi(),
    media: makeMediaApi(),
    assets: makeAssetsApi(appId, entryUrls.assets),
  };
}

/** Stub createSession — throws if called. M2 (ai-engine package) replaces
 *  this with a real factory that returns Session instances. */
export function createSessionStub(): AppCreateSession {
  return () => {
    throw new Error(
      'createSession is not available — wired in M2 (ai-engine package).',
    );
  };
}

/** Helper used by the loader to build the AppBootEnv tuple in one call. */
export function makeAppBootEnv(
  appId: string,
  manifest: Manifest,
  entryUrls: EntryUrls,
): AppBootEnv {
  return {
    host: makeHostForApp(appId, manifest, entryUrls),
    createSession: createSessionStub(),
  };
}
