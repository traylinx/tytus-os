/**
 * Tests for install-host-externals.ts — the boot shim that exposes the
 * host's React + host-api singletons to installed apps via
 * `window.__TYTUS_EXTERNALS__`. Phase 1 of SPRINT-TYTUS-APP-SYSTEM-V1.
 *
 * The shim modules at `app/public/__tytus_externals/*.js` read this
 * object. If install is broken, every installed app crashes with
 * "React is undefined" or splits the React tree (two copies, hooks
 * misbehave). These tests make those regressions loud.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as HostApi from '@tytus/host-api';
import {
  __resetHostExternalsForTests,
  installHostExternals,
} from './install-host-externals';

describe('installHostExternals', () => {
  beforeEach(() => {
    __resetHostExternalsForTests();
  });
  afterEach(() => {
    __resetHostExternalsForTests();
  });

  it('populates globalThis.__TYTUS_EXTERNALS__ with all four expected keys', () => {
    expect((globalThis as { __TYTUS_EXTERNALS__?: unknown }).__TYTUS_EXTERNALS__).toBeUndefined();
    installHostExternals();
    const ext = (globalThis as { __TYTUS_EXTERNALS__?: Record<string, unknown> })
      .__TYTUS_EXTERNALS__;
    expect(ext).toBeDefined();
    expect(ext).toHaveProperty('react');
    expect(ext).toHaveProperty('reactDom');
    expect(ext).toHaveProperty('reactJsxRuntime');
    expect(ext).toHaveProperty('hostApi');
  });

  it('exposes the host-resolved React module identity (not a copy)', () => {
    installHostExternals();
    const ext = (globalThis as { __TYTUS_EXTERNALS__?: Record<string, unknown> })
      .__TYTUS_EXTERNALS__!;
    expect(ext.react).toBe(React);
    expect(ext.reactDom).toBe(ReactDOM);
    expect(ext.reactJsxRuntime).toBe(ReactJsxRuntime);
    expect(ext.hostApi).toBe(HostApi);
  });

  it('does NOT pollute window.React (single-React invariant)', () => {
    installHostExternals();
    // Apps that incorrectly assume `window.React` exists would import
    // their own React copy. We guard against accidentally setting it.
    expect((globalThis as { React?: unknown }).React).toBeUndefined();
    expect((globalThis as { ReactDOM?: unknown }).ReactDOM).toBeUndefined();
  });

  it('is idempotent — calling twice is a no-op', () => {
    installHostExternals();
    const firstRef = (globalThis as { __TYTUS_EXTERNALS__?: unknown }).__TYTUS_EXTERNALS__;
    installHostExternals();
    const secondRef = (globalThis as { __TYTUS_EXTERNALS__?: unknown }).__TYTUS_EXTERNALS__;
    // Same object reference — second call did not rebuild.
    expect(secondRef).toBe(firstRef);
  });

  it('exposes a host-api with the validateManifest export', () => {
    installHostExternals();
    const ext = (globalThis as { __TYTUS_EXTERNALS__?: Record<string, unknown> })
      .__TYTUS_EXTERNALS__!;
    const hostApi = ext.hostApi as { validateManifest?: unknown };
    expect(typeof hostApi.validateManifest).toBe('function');
  });
});
