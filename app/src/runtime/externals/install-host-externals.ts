/**
 * install-host-externals.ts — host-side bootstrap that publishes the
 * shell's loaded React + host-api singletons onto
 * `window.__TYTUS_EXTERNALS__`.
 *
 * The shim modules in `app/public/__tytus_externals/*.js` (which the
 * importmap in `app/index.html` points installed apps at) read from
 * this object. Calling this once during host boot guarantees every
 * installed app sees the same React instance the host renders with —
 * essential for hooks / context / suspense across the host ↔ app
 * boundary.
 *
 * Must run BEFORE the first `loadRemoteApp()` call (i.e. before the
 * App Router mounts an installed-app window). Today the safe place is
 * `app/src/main.tsx`, immediately after the top-level React + ReactDOM
 * imports — see `EXTERNAL_APP_BUILD.md` for the contract.
 */

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as HostApi from '@tytus/host-api';

interface TytusExternals {
  react: typeof React;
  reactDom: typeof ReactDOM;
  reactJsxRuntime: typeof ReactJsxRuntime;
  hostApi: typeof HostApi;
}

declare global {
  // eslint-disable-next-line no-var
  var __TYTUS_EXTERNALS__: TytusExternals | undefined;
}

let installed = false;

/**
 * Idempotent — calling twice is a no-op (and not an error). The host
 * may run this from multiple entry points (main.tsx + a test harness)
 * without us double-shimming.
 */
export function installHostExternals(): void {
  if (installed) return;
  if (typeof globalThis === 'undefined') return;

  globalThis.__TYTUS_EXTERNALS__ = {
    react: React,
    reactDom: ReactDOM,
    reactJsxRuntime: ReactJsxRuntime,
    hostApi: HostApi,
  };
  installed = true;
}

/** Test-only: forget the install so a fresh test can re-run it. */
export function __resetHostExternalsForTests(): void {
  installed = false;
  if (typeof globalThis !== 'undefined') {
    delete (globalThis as { __TYTUS_EXTERNALS__?: unknown }).__TYTUS_EXTERNALS__;
  }
}
