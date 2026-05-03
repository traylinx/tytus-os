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
  AppBootEnv,
  AppCreateSession,
  AppDb,
  AssetsApi,
  DaemonApi,
  EventsApi,
  FsApi,
  HostClient,
  I18nApi,
  Manifest,
  MediaApi,
  NotificationsApi,
  ShellEventName,
  ShellEventPayload,
  ShellMenuApi,
  StorageApi,
  WindowsApi,
} from '@tytus/host-api';
import {
  AssetEscapeError,
  AssetTooLargeError,
} from '@tytus/host-api';

import type { EntryUrls } from './loader';
import { createLocalStorageFs } from './host-fs-localstorage';
import { createAppDb } from './storage-impl';
import { resolveSharedTableNames } from './installed-apps-repo';
import { getDb } from '@/lib/db';

const ASSET_SIZE_LIMIT_BYTES = 1024 * 1024; // 1 MB per spec.

const notImpl = (name: string, milestone: string) => {
  return () => {
    throw new Error(
      `host.${name} is not implemented yet — wired in ${milestone}.`,
    );
  };
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

/** Build the notifications namespace. M1: console + in-memory queue
 *  (shells observe via getNotificationQueue()). M3+ wires to sonner
 *  which the existing app already uses. */
const NOTIFICATION_QUEUE: Array<{
  appId: string;
  title: string;
  body?: string;
  level?: string;
  durationMs?: number;
  ts: number;
}> = [];
export function getNotificationQueue() {
  return NOTIFICATION_QUEUE.slice();
}
export function clearNotificationQueue(): void {
  NOTIFICATION_QUEUE.length = 0;
}
function makeNotificationsApi(appId: string): NotificationsApi {
  return {
    notify(opts) {
      NOTIFICATION_QUEUE.push({
        appId,
        title: opts.title,
        body: opts.body,
        level: opts.level,
        durationMs: opts.durationMs,
        ts: Date.now(),
      });
      // Surface in dev so missing UI doesn't hide bugs.
      console.info('[host.notifications]', appId, opts.title, opts.body ?? '');
    },
  };
}

/** Build the fs namespace. M1 PR5: localStorage-backed minimal real
 *  implementation (created in host-fs-localstorage.ts) so Notes-style
 *  proofs work end-to-end. M3 swaps in the FileRef-backed implementation
 *  wired to the existing useFileSystem context. */
function makeFsApi(): FsApi {
  return createLocalStorageFs({
    onChange: (event) => {
      // Bridge fs change events into the shell event bus so other apps
      // listening on `vfs.changed` see them.
      getShellEventBus().emit('vfs.changed', {
        fileNodeId: event.fileNodeId,
        parentId: event.parentId,
        kind: event.kind,
      });
    },
  });
}

/** Build a stub daemon namespace. M3+ wires to useDaemonStateContext. */
function makeStubDaemonApi(): DaemonApi {
  return {
    state: { agents: [], included: [] },
    onStateChange: () => () => {},
    callPodEndpoint: notImpl('daemon.callPodEndpoint', 'M3+'),
  };
}

/** Build a stub windows namespace. M3+ wires to useOSStore. */
function makeStubWindowsApi(appId: string): WindowsApi {
  return {
    current: { id: 'stub', appId },
    open: notImpl('windows.open', 'M3+'),
    openOrFocus: notImpl('windows.openOrFocus', 'M3+'),
    close: notImpl('windows.close', 'M3+'),
    addDesktopIcon: notImpl('windows.addDesktopIcon', 'M3+'),
  };
}

/** Build a stub shellMenu namespace. M3+ wires to useShellMenu. */
function makeStubShellMenuApi(): ShellMenuApi {
  return {
    register: () => () => {},
  };
}

/** Build the storage namespace bound to the given appId.
 *  M3: real per-app AppDb backed by the live SQLite worker, with the
 *  prefix guard enforcing physical-name discipline + cross-app shared
 *  reads resolved through installed_apps.manifest_json.storage.shares. */
function makeStorageApi(appId: string): StorageApi {
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
    return createAppDb({ db, appId, sharedTableNames: sharedTableCache });
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
    forSharedKey: (key) => {
      // Sync surface — cached lookup. If the cache is empty, return
      // null and let the next async run/query refresh it. Apps using
      // forSharedKey for read access call query() right after, which
      // triggers the lazy refresh path.
      void key;
      // M3 PR3+ adds a real SharedDb impl here. Today: still null so
      // existing callers continue to handle the not-shared path.
      return null;
    },
  };
}

/** Build a stub media namespace. M3+ wires to navigator.mediaDevices. */
function makeStubMediaApi(): MediaApi {
  return {
    requestMicrophone: notImpl('media.requestMicrophone', 'M3+ (Voice Recorder)'),
    requestDisplay: notImpl('media.requestDisplay', 'M3+'),
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
  _manifest: Manifest,
  entryUrls: EntryUrls,
): HostClient {
  return {
    appId,
    fs: makeFsApi(),
    daemon: makeStubDaemonApi(),
    windows: makeStubWindowsApi(appId),
    notifications: makeNotificationsApi(appId),
    shellMenu: makeStubShellMenuApi(),
    i18n: makeI18nApi(),
    storage: makeStorageApi(appId),
    events: getShellEventBus(),
    media: makeStubMediaApi(),
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
