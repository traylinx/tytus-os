/**
 * Dynamic loader bridge between `installed_apps` rows and the workspace
 * / remote app boot flow. This is the PRODUCTION path used by
 * `WorkspaceAppHost.useLoadedApp` for every window the user opens.
 *
 * Dual-loader split (post audit 2026-05-04)
 * -----------------------------------------
 * The codebase has two loader modules with overlapping responsibilities:
 *
 *   - `runtime/loader.ts`      — the M3.5 mount path. Owns CSS fetch +
 *                                 style-isolator transform + inline
 *                                 `<style>` injection + bundled-package
 *                                 dynamic import. Used today by tests
 *                                 and as the legacy entry point. Has its
 *                                 own `loadRemoteApp` branch when the
 *                                 manifest carries `entry.url`.
 *
 *   - `runtime/dynamic-loader.ts` (this file) — the M3.6 production
 *                                 path. Sits one layer up: accepts an
 *                                 `InstalledAppRow` from the SQLite
 *                                 registry, resolves its `entryUrl`,
 *                                 and dispatches to either:
 *                                   (a) native dynamic `import()` for
 *                                       workspace-package shapes
 *                                       (`@tytus/app-<id>` / built chunk
 *                                       URLs), or
 *                                   (b) `loadRemoteApp` from
 *                                       `remote-loader.ts` for fully
 *                                       qualified `https://` URLs (so
 *                                       installed third-party apps get
 *                                       per-URL caching + typed
 *                                       RemoteAppLoadError shaping).
 *
 * Both files MUST stay in sync on the bootApp(env) contract — a
 * workspace package's default export receives the same `AppBootEnv`
 * regardless of which loader called it. The cleanup PR (post-Phase-5)
 * will fold loader.ts into dynamic-loader.ts once style isolation moves
 * out of the loader and into a per-window wrapper component.
 *
 * Resolution rules (entry.url / entry.module):
 *   - DEV (Vite serves source): the entryUrl is a synthetic
 *     `@tytus/app-<id>` package identifier. Forwarded verbatim to
 *     `import()`; Vite resolves via the workspace symlink in
 *     `node_modules/@tytus/app-<id>/`.
 *   - PROD bundled (transport A): the entryUrl is the chunk URL
 *     emitted by `npm run build:packages`
 *     (e.g. `/packages/app-<id>/dist/index.js`). `import()` fetches it
 *     relative to the document.
 *   - INSTALLED third-party (transport B): the entryUrl is a fully
 *     qualified CDN URL (jsDelivr / GitHub Pages). Routed to
 *     `loadRemoteApp` so React + host-api remain singletons via the
 *     importmap defined in `app/index.html`.
 *
 * Failures are normalised to `AppLoadError` so the shell's error
 * boundary has a single error type to switch on.
 *
 * Per spec §"Loader topology" / W5 PR-DynLoader (M3.6).
 */

import type {
  AppBootEnv,
  Manifest,
} from '@tytus/host-api';
import type { ComponentType } from 'react';
import type { Db } from '@/lib/db/types';

import { getInstalledApp, type InstalledAppRow } from './installed-apps-repo';
import { makeAppBootEnv } from './host-impl';
import { loadRemoteApp, RemoteAppLoadError } from './remote-loader';
import { importBundledOrUrl } from './bundled-app-loaders';
import {
  coerceWorkspaceRebrandRow,
  LEGACY_WORKSPACE_APP_ID,
  WORKSPACE_APP_ID,
} from './app-rebrand-migrations';

/** Public result the window manager renders. */
export interface LoadedApp {
  appId: string;
  /** React component returned by the workspace package's bootApp. */
  Component: ComponentType;
  /** Resolved manifest from installed_apps. */
  manifest: Manifest;
}

/** Every workspace package's default export has this shape. */
export type AppEntry = (env: AppBootEnv) => unknown;

/**
 * Normalised failure mode. The shell's error fallback switches on
 * `appId` for the user-facing message; `cause` carries the underlying
 * exception for telemetry / dev-mode `console.error`.
 */
export class AppLoadError extends Error {
  appId: string;
  override cause: unknown;
  constructor(appId: string, message: string, cause?: unknown) {
    super(`[tytus-loader] app "${appId}" failed to load: ${message}`);
    this.name = 'AppLoadError';
    this.appId = appId;
    this.cause = cause;
  }
}

/**
 * Resolve an InstalledApp row's `entryUrl` to the URL string `import()`
 * should consume. Pure — no I/O — so unit tests can verify the
 * mapping without spinning up Vite.
 *
 * Convention (W5):
 *   - `'@tytus/app-<id>'` → DEV: passed through verbatim. Vite
 *     resolves it via the workspace symlink. PROD: only emitted when
 *     the install pipeline rewrites entry_url to a real chunk URL, so
 *     a package-spec passing through here in PROD is a programmer
 *     error.
 *   - `'/packages/app-<id>/dist/index.js'` (or any absolute / relative
 *     URL) → forwarded as-is.
 *
 * Returning the input verbatim is intentional — Vite + browser dynamic
 * import handle both shapes natively. Centralising the resolution
 * keeps the option open to layer caching / version pinning later
 * without re-touching every call site.
 */
export function resolveEntryUrl(entryUrl: string): string {
  const rawGithub = entryUrl.match(
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i,
  );
  if (rawGithub) {
    const [, owner, repo, ref, path] = rawGithub;
    return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path}`;
  }
  return entryUrl;
}

/** Heuristic: is this entryUrl a fully-qualified URL that should go
 *  through the remote-loader (transport B) rather than transport A? */
function isRemoteEntryUrl(entryUrl: string): boolean {
  return /^https?:\/\//i.test(entryUrl);
}

const JULI3TA_GATEWAY_FIX_VERSION = '0.3.24';
const JULI3TA_GATEWAY_FIX_MANIFEST_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-juli3ta@juli3ta-0.3.24/tytus-app.json';
const JULI3TA_GATEWAY_FIX_ENTRY_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-juli3ta@juli3ta-0.3.24/dist/index.js';

const JULI3TA_GATEWAY_FIX_MANIFEST: Manifest = {
  $schema: 'https://tytus.traylinx.com/schema/app/v1.json',
  id: 'juli3ta',
  name: 'JULI3TA',
  version: JULI3TA_GATEWAY_FIX_VERSION,
  icon: 'juli3ta:mark',
  category: 'Creative',
  description:
    'JULI3TA — full AI-native music creator for Tytus OS. Create songs, lyrics, covers, and manage your local music workbench.',
  window: {
    defaultSize: { width: 1100, height: 760 },
    minSize: { width: 720, height: 540 },
  },
  permissions: [
    'vfs.user.music',
    'daemon.read',
    'daemon.network',
    'storage.app',
    'shell.openWindow',
    'shell.notifications',
    'shell.menu',
  ],
  storage: {
    tables: [
      { name: 'tracks', schema: 'migrations/0002_legacy_compat_tables.sql' },
      { name: 'settings', schema: 'migrations/0002_legacy_compat_tables.sql' },
      { name: 'voice-recordings', schema: 'migrations/0002_legacy_compat_tables.sql' },
      { name: 'music-library', schema: 'migrations/0002_legacy_compat_tables.sql' },
      { name: 'music-playlists', schema: 'migrations/0002_legacy_compat_tables.sql' },
    ],
  },
  entry: { url: JULI3TA_GATEWAY_FIX_ENTRY_URL },
};

const versionParts = (version: string): number[] =>
  version
    .split(/[^0-9]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10));

const isVersionBefore = (actual: string, minimum: string): boolean => {
  const a = versionParts(actual);
  const b = versionParts(minimum);
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
};

const withJuli3taGatewayFix = (row: InstalledAppRow): InstalledAppRow => {
  if (row.id !== 'juli3ta') return row;
  const version = row.manifest.version ?? '';
  const staleByVersion = isVersionBefore(version, JULI3TA_GATEWAY_FIX_VERSION);
  const staleByUrl = /tytus-app-juli3ta@juli3ta-0\.(?:0|1|2|3\.[0-9])\b/.test(
    `${row.entryUrl ?? ''} ${row.manifestUrl ?? ''}`,
  );
  if (!staleByVersion && !staleByUrl) return row;
  return {
    ...row,
    manifest: JULI3TA_GATEWAY_FIX_MANIFEST,
    entryUrl: JULI3TA_GATEWAY_FIX_ENTRY_URL,
    assetsUrl: null,
    manifestUrl: JULI3TA_GATEWAY_FIX_MANIFEST_URL,
  };
};

// ── Local-dev override (build-flag gated; default OFF) ────────────────
// Only active when the OS is built with `VITE_LOCAL_ATOMEK=1` — a local
// verification build. CI / real releases never set this var, so
// `LOCAL_*_OVERRIDE` is `false`, `withLocalDevOverride` is a no-op
// pass-through, and the production CDN/catalog reconciliation path is
// byte-for-byte unchanged.
//
// When on, it rewrites a CDN-reconciled installed-app row to load the
// tray/vite-served local bundle at `/dev-<app>/dist/index.js`, so local
// standalone-app changes are visible in the shell before publishing to
// the CDN catalog. Same shape as the `withJuli3taGatewayFix` row-rewrite
// above. (Atomek 2026-05-29, OpenHouse 2026-05-31)
const LOCAL_ATOMEK_OVERRIDE =
  (import.meta.env as Record<string, string | undefined>).VITE_LOCAL_ATOMEK ===
  '1';
const LOCAL_OPENHOUSE_OVERRIDE =
  (import.meta.env as Record<string, string | undefined>).VITE_LOCAL_OPENHOUSE ===
  '1';
const LOCAL_DEV_APP_URLS: Record<string, { entryPath: string; manifestPath: string; enabled: boolean }> = {
  atomek: {
    enabled: LOCAL_ATOMEK_OVERRIDE,
    entryPath: '/dev-atomek/dist/index.js',
    manifestPath: '/dev-atomek/tytus-app.json',
  },
  openhouse: {
    enabled: LOCAL_OPENHOUSE_OVERRIDE,
    entryPath: '/dev-openhouse/dist/index.js',
    manifestPath: '/dev-openhouse/tytus-app.json',
  },
};

const LOCAL_DEV_CACHE_BUST = '20260531-atomek-honesty';

const localDevUrl = (path: string): string => {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:4242';
  const url = new URL(path, origin);
  url.searchParams.set('v', LOCAL_DEV_CACHE_BUST);
  return url.toString();
};

const withLocalDevOverride = (row: InstalledAppRow): InstalledAppRow => {
  const local = LOCAL_DEV_APP_URLS[row.id];
  if (!local?.enabled) return row;
  const entryUrl = localDevUrl(local.entryPath);
  const manifestUrl = localDevUrl(local.manifestPath);
  return {
    ...row,
    entryUrl,
    assetsUrl: null,
    manifestUrl,
    manifest: { ...row.manifest, entry: { url: entryUrl } },
  };
};

export interface LoadAppOptions {
  /** Injected for testability. Production code uses native dynamic
   *  import. The function returns the imported module — the loader
   *  reads `.default` off it and calls it as `bootApp(env)`. */
  importModule?: (url: string) => Promise<{ default?: unknown }>;
}

/**
 * Load an installed app: resolve entryUrl → dynamic-import →
 * `bootApp(env)` → wrap as `LoadedApp`. Any failure throws
 * `AppLoadError`.
 *
 * The caller (window-manager / AppRouter) is responsible for:
 *   - Wrapping the returned Component in a Suspense boundary if it
 *     uses async APIs internally.
 *   - Catching `AppLoadError` in an error boundary so a bad app
 *     doesn't crash the shell.
 */
export async function loadApp(
  app: InstalledAppRow,
  env: AppBootEnv,
  opts: LoadAppOptions = {},
): Promise<LoadedApp> {
  const { importModule = importBundledOrUrl } = opts;

  if (!app.entryUrl) {
    throw new AppLoadError(
      app.id,
      'installed_apps row has null entry_url; the app is not loadable until the seed/install pipeline writes a real entry url.',
    );
  }

  const url = resolveEntryUrl(app.entryUrl);
  const manifestForLoad: Manifest =
    isRemoteEntryUrl(url) && app.manifest.entry?.url !== url
      ? {
          ...app.manifest,
          entry: {
            ...app.manifest.entry,
            url,
          },
        }
      : app.manifest;

  // Transport B (installed third-party app on https:// CDN): delegate
  // to the remote-loader so we get the per-URL module dedupe + typed
  // RemoteAppLoadError shaping. Transport A (workspace package via
  // `@tytus/app-<id>` or built chunk URL) stays on the inlined import
  // path below — its module identity is already managed by the
  // bundler / Vite, so adding the dedupe layer would be redundant.
  let bootApp: AppEntry;
  if (isRemoteEntryUrl(url)) {
    try {
      bootApp = (await loadRemoteApp(manifestForLoad, {
        importModule,
      })) as AppEntry;
    } catch (err) {
      // Re-wrap as AppLoadError so callers (WorkspaceAppHost's error
      // boundary) can switch on a single error type. Preserve the
      // RemoteAppLoadError as `cause` for telemetry.
      const message =
        err instanceof RemoteAppLoadError
          ? err.message
          : `remote import of "${url}" rejected: ${(err as Error)?.message ?? String(err)}`;
      throw new AppLoadError(app.id, message, err);
    }
  } else {
    let mod: { default?: unknown };
    try {
      mod = await importModule(url);
    } catch (err) {
      throw new AppLoadError(
        app.id,
        `dynamic import of "${url}" rejected: ${(err as Error)?.message ?? String(err)}`,
        err,
      );
    }

    if (mod.default === undefined || mod.default === null) {
      throw new AppLoadError(
        app.id,
        `module "${url}" has no default export. Workspace apps must export a default \`bootApp(env)\` function.`,
      );
    }
    if (typeof mod.default !== 'function') {
      throw new AppLoadError(
        app.id,
        `module "${url}" default export is not a function (got ${typeof mod.default}). Workspace apps must export a default \`bootApp(env)\` function.`,
      );
    }
    bootApp = mod.default as AppEntry;
  }

  let returned: unknown;
  try {
    returned = bootApp(env);
  } catch (err) {
    throw new AppLoadError(
      app.id,
      `bootApp(env) threw: ${(err as Error)?.message ?? String(err)}`,
      err,
    );
  }

  if (typeof returned !== 'function') {
    throw new AppLoadError(
      app.id,
      `bootApp(env) returned ${typeof returned}; expected a React component (() => ReactNode).`,
    );
  }

  return {
    appId: app.id,
    Component: returned as ComponentType,
    manifest: manifestForLoad,
  };
}

/**
 * Convenience: look up an installed_apps row by id, build the
 * AppBootEnv for it, and dispatch through `loadApp`. Used by the
 * AppRouter glue when the shell only has an appId in hand.
 */
export async function loadAppById(
  appId: string,
  db: Db,
  opts: LoadAppOptions & {
    /** Test seam — production passes the live `makeAppBootEnv`. */
    makeEnv?: (appId: string, manifest: Manifest) => AppBootEnv;
  } = {},
): Promise<LoadedApp> {
  let storedRow = await getInstalledApp(db, appId);
  if (!storedRow && appId === WORKSPACE_APP_ID) {
    storedRow = await getInstalledApp(db, LEGACY_WORKSPACE_APP_ID);
  }
  if (!storedRow) {
    throw new AppLoadError(
      appId,
      `not found in installed_apps. Boot seed missed the row, or the app id is wrong.`,
    );
  }
  // React mounts before async boot cleanups finish. If a persisted
  // window opens a stale installed app during that race, it can
  // otherwise import an old immutable CDN bundle for the whole session.
  // Coerce at load time as a second line of defense; boot migrations
  // still repair the row permanently once they reach the DB.
  const row = withLocalDevOverride(
    coerceWorkspaceRebrandRow(withJuli3taGatewayFix(storedRow)),
  );
  const makeEnv =
    opts.makeEnv ??
    ((id: string, manifest: Manifest) =>
      makeAppBootEnv(id, manifest, {
        // Dynamic-loader-driven boot doesn't have a CSS-or-asset
        // bundle URL today (workspace packages ship CSS via their
        // own React imports / lib build). Pass synthetic empty
        // entries; assets-namespace consumers degrade with a
        // 404 — apps that need a real assets root use a manifest
        // entry instead (post-W5).
        module: row.entryUrl ?? '',
        assets: '/',
        css: null,
      }));
  const env = makeEnv(row.id, row.manifest);
  return loadApp(row, env, opts);
}
