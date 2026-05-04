/**
 * remote-loader.ts — install transport B: load user-installed apps from
 * a fully-qualified `https://` URL via native dynamic `import(url)`.
 *
 * Companion to the workspace-package transport in `dynamic-loader.ts`
 * (transport A). The two share the same boot-time contract — every app
 * exports `default: bootApp(env): Component` — but resolve differently:
 *
 *   - transport A (`entry.module`): the ESM URL is a workspace package
 *     identifier (`@tytus/app-<id>`) or a built chunk path. Vite /
 *     bundler resolves it and the host bundles its own copy of React.
 *   - transport B (`entry.url`): the ESM URL is a CDN URL (jsDelivr /
 *     GitHub Pages). The browser fetches the module at runtime, the
 *     external app's bundle has React + @tytus/host-api marked as
 *     externals, and an importmap in `app/index.html` re-routes the
 *     imports back to the host's already-loaded copies (so we don't
 *     end up with two Reacts in one tab).
 *
 * React-externalisation strategy — Option A: importmap
 * ----------------------------------------------------
 * `app/index.html` ships a `<script type="importmap">` mapping
 *   - `react`              → `/__tytus_externals/react.js`
 *   - `react-dom`          → `/__tytus_externals/react-dom.js`
 *   - `react/jsx-runtime`  → `/__tytus_externals/react-jsx-runtime.js`
 *   - `@tytus/host-api`    → `/__tytus_externals/host-api.js`
 *
 * Those URLs serve tiny shim modules (`app/src/runtime/externals/`) that
 * re-export the host's already-loaded React + host-api singletons via
 * `window.__TYTUS_EXTERNALS__`. The shim approach keeps native ESM
 * resolution (no `window.X.useState` ergonomics in app code) while
 * guaranteeing single-singleton across host + every installed app.
 *
 * External apps configure their bundler (Vite, esbuild, rollup) to mark
 * `react`, `react-dom`, `react/jsx-runtime`, and `@tytus/host-api` as
 * externals — see `packages/host-api/EXTERNAL_APP_BUILD.md` for the
 * full build recipe.
 *
 * If the importmap turns out not to fit a constraint we don't see yet
 * (e.g. some bundler emits hashed import specifiers we can't map
 * statically), fall back to Option B (globals on `window.__TYTUS__`).
 * As of v1 the importmap path is the chosen design.
 *
 * Per Phase 1 of SPRINT-TYTUS-APP-SYSTEM-V1.
 */

import type { AppBootEnv, Manifest } from '@tytus/host-api';
import type { ComponentType } from 'react';

/** Default export shape every installed app must satisfy. */
export type RemoteAppEntry = (env: AppBootEnv) => ComponentType | unknown;

/** Minimal shape we accept from the imported module. */
export interface RemoteAppModule {
  default?: unknown;
}

/**
 * Typed failure mode for transport-B loads. The shell's error fallback
 * can switch on `name === 'RemoteAppLoadError'` to render a "couldn't
 * load app from CDN" placeholder; `cause` carries the underlying
 * exception (network rejection, bad MIME, missing default export…) for
 * dev `console.error` + telemetry.
 */
export class RemoteAppLoadError extends Error {
  readonly url: string;
  override readonly cause: unknown;
  constructor(url: string, message: string, cause?: unknown) {
    super(`[tytus-remote-loader] failed to load app from ${url}: ${message}`);
    this.name = 'RemoteAppLoadError';
    this.url = url;
    this.cause = cause;
  }
}

/**
 * Per-session module cache. Concurrent calls for the same URL share a
 * single `import()` promise, so two windows opening the same app within
 * a tick don't trigger two network round-trips. Subsequent opens within
 * the same browser session skip the network entirely.
 *
 * NOTE: this is a Promise<Module> cache, not a Module cache — caching
 * the promise is critical for dedupe (two parallel callers must hit
 * the same in-flight request, not race two of them).
 */
const remoteModuleCache = new Map<string, Promise<RemoteAppModule>>();

/** Test-only: clear the module cache between tests. */
export function __clearRemoteModuleCacheForTests(): void {
  remoteModuleCache.clear();
}

export interface LoadRemoteAppOptions {
  /** Injected for testability. Production code uses native dynamic
   *  `import()`. The function returns the imported module — the loader
   *  reads `.default` off it and calls it as `bootApp(env)`. */
  importModule?: (url: string) => Promise<RemoteAppModule>;
}

/**
 * Resolve a manifest with `entry.url` set to a `bootApp` factory.
 *
 * Throws `RemoteAppLoadError` (only) on any failure. The host caller is
 * responsible for fall-back UX — the loader's job is to either return a
 * usable factory or throw a typed error with the URL on it.
 */
export async function loadRemoteApp(
  manifest: Manifest,
  opts: LoadRemoteAppOptions = {},
): Promise<RemoteAppEntry> {
  const url = manifest.entry?.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new RemoteAppLoadError(
      String(url ?? ''),
      'manifest.entry.url is missing or empty',
    );
  }

  const { importModule = (u: string) => import(/* @vite-ignore */ u) } = opts;

  let cached = remoteModuleCache.get(url);
  if (!cached) {
    // Wrap the dynamic import so the cached promise rejects with a
    // RemoteAppLoadError (preserving the url + cause). If we cached the
    // raw import() rejection, two callers that both await the same URL
    // would each get the bare network error and have to re-wrap it
    // themselves. Failed loads are also evicted from the cache so the
    // next attempt can retry instead of being stuck on a stale 404.
    cached = importModule(url).catch((err: unknown) => {
      remoteModuleCache.delete(url);
      throw new RemoteAppLoadError(
        url,
        `dynamic import rejected: ${(err as Error)?.message ?? String(err)}`,
        err,
      );
    });
    remoteModuleCache.set(url, cached);
  }

  const mod = await cached;

  if (mod === null || typeof mod !== 'object') {
    throw new RemoteAppLoadError(
      url,
      `imported module is not an object (got ${mod === null ? 'null' : typeof mod})`,
    );
  }
  if (mod.default === undefined || mod.default === null) {
    throw new RemoteAppLoadError(
      url,
      'module has no default export. Installed apps must `export default function bootApp(env) { … }`.',
    );
  }
  if (typeof mod.default !== 'function') {
    throw new RemoteAppLoadError(
      url,
      `default export is not a function (got ${typeof mod.default}). Installed apps must export a default \`bootApp(env)\` function.`,
    );
  }

  return mod.default as RemoteAppEntry;
}
