/**
 * Dynamic loader bridge between `installed_apps` rows and the
 * workspace-package boot flow.
 *
 * The lower-level `loader.ts` already does the heavy lifting (style
 * isolation, dynamic `import()`, `bootApp(env)` invocation, AppBootEnv
 * construction). This module sits one layer up: it accepts an
 * `InstalledApp` row from the SQLite registry and resolves its
 * `entryUrl` to a real ESM module URL the dev server (or production
 * bundle) can serve.
 *
 * Resolution rules:
 *   - DEV (Vite serves source): the entryUrl is a synthetic
 *     `@tytus/app-<id>` package identifier. We forward that string to
 *     `import()`; Vite resolves it through the workspace symlink in
 *     `node_modules/@tytus/app-<id>/`.
 *   - PROD (built bundle): the entryUrl is the chunk URL emitted by
 *     `npm run build:packages` (e.g. `/packages/app-<id>/dist/index.js`).
 *     `import()` fetches it relative to the document.
 *
 * Either way, the loader chains into `loadAppViaModule()` which calls
 * `bootApp(env)` and returns a `LoadedApp` wrapper for the window
 * manager to mount. Failures are normalised to `AppLoadError` so the
 * shell's error boundary has a single error type to switch on.
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
  return entryUrl;
}

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
  const { importModule = (url) => import(/* @vite-ignore */ url) } = opts;

  if (!app.entryUrl) {
    throw new AppLoadError(
      app.id,
      'installed_apps row has null entry_url; the app is not loadable until the seed/install pipeline writes a real entry url.',
    );
  }

  const url = resolveEntryUrl(app.entryUrl);

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

  const bootApp = mod.default as AppEntry;
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
    manifest: app.manifest,
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
  const row = await getInstalledApp(db, appId);
  if (!row) {
    throw new AppLoadError(
      appId,
      `not found in installed_apps. Boot seed missed the row, or the app id is wrong.`,
    );
  }
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
