/**
 * remote-loader.test.ts — unit tests for transport B (CDN-loaded apps).
 *
 * Covers:
 *   - happy path: fixture module loads, default export is a function
 *   - cache dedupe: two concurrent loads to the same URL share one
 *     `import()` round-trip
 *   - cache survival: a successful load is reused on the next call
 *   - missing entry.url
 *   - module without default export
 *   - default export that isn't a function
 *   - cache eviction on failure (so the next attempt can retry)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '@tytus/host-api';

import {
  RemoteAppLoadError,
  __clearRemoteModuleCacheForTests,
  loadRemoteApp,
} from './remote-loader';

const REMOTE_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-fake@v0.1.0/dist/index.js';

function manifestWithUrl(url: string | undefined): Manifest {
  // Cast to Manifest — typed as Manifest for the loader's signature.
  // `url: undefined` is set when we want to test the missing-url branch.
  const entry: Manifest['entry'] = url === undefined ? undefined : { url };
  return {
    id: 'fake',
    name: 'Fake',
    version: '0.1.0',
    icon: 'Box',
    category: 'Utilities',
    description: 'remote-loader test fixture.',
    window: {
      defaultSize: { width: 400, height: 300 },
      minSize: { width: 200, height: 150 },
    },
    permissions: [],
    kind: 'installed',
    entry,
  };
}

afterEach(() => {
  __clearRemoteModuleCacheForTests();
});

describe('loadRemoteApp', () => {
  it('imports a fixture module and returns the default export when it is a function', async () => {
    // Load via the fixture URL. The injected importer returns the
    // dynamically-imported real fixture module, exercising end-to-end
    // ESM default-export shape detection.
    const fixtureModule = await import('./__fixtures__/fake-remote-app.js');
    const importModule = vi.fn(async () => fixtureModule);

    const bootApp = await loadRemoteApp(manifestWithUrl(REMOTE_URL), {
      importModule,
    });

    expect(typeof bootApp).toBe('function');
    expect(importModule).toHaveBeenCalledWith(REMOTE_URL);

    // Calling bootApp(env) returns a function (FakeApp component) — same
    // shape every installed app must satisfy.
    const Comp = bootApp({} as never);
    expect(typeof Comp).toBe('function');
  });

  it('dedupes concurrent loads of the same URL (one network round-trip)', async () => {
    let calls = 0;
    const importModule = vi.fn(async (url: string) => {
      calls++;
      // A trivial-but-real ESM-shaped object so the loader sees a fn default.
      return { default: () => `comp-from-${url}` };
    });

    const [a, b, c] = await Promise.all([
      loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule }),
      loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule }),
      loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule }),
    ]);

    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it('reuses the cache on a subsequent load of the same URL (no extra import)', async () => {
    const importModule = vi.fn(async () => ({ default: () => 'comp' }));

    await loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule });
    await loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule });

    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it('refetches a different URL (cache key is the URL)', async () => {
    const importModule = vi.fn(async (url: string) => ({
      default: () => `comp-${url}`,
    }));

    const otherUrl =
      'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-other@v0.1.0/dist/index.js';
    await loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule });
    await loadRemoteApp(manifestWithUrl(otherUrl), { importModule });

    expect(importModule).toHaveBeenCalledTimes(2);
    expect(importModule).toHaveBeenCalledWith(REMOTE_URL);
    expect(importModule).toHaveBeenCalledWith(otherUrl);
  });

  it('throws RemoteAppLoadError when manifest.entry.url is missing', async () => {
    await expect(loadRemoteApp(manifestWithUrl(undefined))).rejects.toThrow(
      RemoteAppLoadError,
    );
    await expect(loadRemoteApp(manifestWithUrl(undefined))).rejects.toThrow(
      /entry\.url is missing/,
    );
  });

  it('throws RemoteAppLoadError when the loaded module has no default export', async () => {
    const importModule = vi.fn(async () => ({ named: 'thing' }) as never);

    await expect(
      loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule }),
    ).rejects.toThrow(RemoteAppLoadError);
    await expect(
      loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule }),
    ).rejects.toThrow(/no default export/);
  });

  it('throws RemoteAppLoadError when the default export is not a function', async () => {
    const importModule = vi.fn(async () => ({ default: { not: 'a fn' } }));

    await expect(
      loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule }),
    ).rejects.toThrow(RemoteAppLoadError);
    await expect(
      loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule }),
    ).rejects.toThrow(/default export is not a function/);
  });

  it('attaches the URL + cause onto the thrown RemoteAppLoadError', async () => {
    const cause = new Error('network unreachable');
    const importModule = vi.fn(async () => {
      throw cause;
    });

    let caught: unknown;
    try {
      await loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RemoteAppLoadError);
    const e = caught as RemoteAppLoadError;
    expect(e.url).toBe(REMOTE_URL);
    expect(e.cause).toBe(cause);
    expect(e.message).toContain(REMOTE_URL);
    expect(e.message).toContain('network unreachable');
  });

  it('evicts a failed URL from the cache so a retry can succeed', async () => {
    let attempt = 0;
    const importModule = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error('flake');
      return { default: () => 'comp' };
    });

    await expect(
      loadRemoteApp(manifestWithUrl(REMOTE_URL), { importModule }),
    ).rejects.toThrow(RemoteAppLoadError);

    // Second call must hit the importer again (cache evicted on failure).
    const bootApp = await loadRemoteApp(manifestWithUrl(REMOTE_URL), {
      importModule,
    });
    expect(typeof bootApp).toBe('function');
    expect(importModule).toHaveBeenCalledTimes(2);
  });
});
