/**
 * dynamic-loader.test.ts — unit tests for the loader bridge that
 * mounts workspace-package apps from `installed_apps` rows.
 *
 * The lower-level `loader.ts` already has its own coverage for style
 * isolation + dynamic import + bootApp call. These tests cover the
 * NEW surface that W5 introduces: AppLoadError normalisation,
 * `loadAppById` lookup, and the entryUrl resolution mapping.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AppBootEnv, Manifest } from '@tytus/host-api';

import {
  AppLoadError,
  loadApp,
  loadAppById,
  resolveEntryUrl,
} from './dynamic-loader';
import type { InstalledAppRow } from './installed-apps-repo';
import type { Db, SqlValue } from '@/lib/db/types';

const fakeManifest: Manifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  icon: 'Box',
  category: 'Utilities',
  description: 'Test fixture for dynamic-loader.',
  window: {
    defaultSize: { width: 400, height: 300 },
    minSize: { width: 200, height: 150 },
  },
  permissions: [],
  entry: { module: '@tytus/app-demo' },
};

const fakeRow: InstalledAppRow = {
  id: 'demo',
  kind: 'bundled',
  manifest: fakeManifest,
  entryUrl: '@tytus/app-demo',
  assetsUrl: null,
  manifestUrl: null,
  installedAt: 0,
  enabled: true,
  builtinProtected: true,
};

const fakeEnv: AppBootEnv = {
  // The dynamic-loader does NOT introspect env; the test env can be a
  // shallow stub. Cast through unknown to satisfy AppBootEnv.host shape.
  host: { appId: 'demo' } as unknown as AppBootEnv['host'],
  createSession: () => {
    throw new Error('not used in this test');
  },
};

describe('resolveEntryUrl', () => {
  it('returns @tytus/app-* package identifiers verbatim', () => {
    expect(resolveEntryUrl('@tytus/app-memo')).toBe('@tytus/app-memo');
  });

  it('returns absolute URLs verbatim', () => {
    expect(resolveEntryUrl('/packages/app-memo/dist/index.js')).toBe(
      '/packages/app-memo/dist/index.js',
    );
  });
});

describe('loadApp', () => {
  it('imports the entry module and returns the bootApp Component', async () => {
    const FakeComponent = () => null;
    const importModule = vi.fn(async () => ({
      default: () => FakeComponent,
    }));
    const result = await loadApp(fakeRow, fakeEnv, { importModule });

    expect(importModule).toHaveBeenCalledWith('@tytus/app-demo');
    expect(result.appId).toBe('demo');
    expect(result.Component).toBe(FakeComponent);
    expect(result.manifest).toBe(fakeManifest);
  });

  it('passes the AppBootEnv into bootApp', async () => {
    const captured: { env?: AppBootEnv } = {};
    await loadApp(fakeRow, fakeEnv, {
      importModule: async () => ({
        default: (env: AppBootEnv) => {
          captured.env = env;
          return () => null;
        },
      }),
    });
    expect(captured.env).toBe(fakeEnv);
  });

  it('throws AppLoadError when entry_url is null', async () => {
    const row = { ...fakeRow, entryUrl: null };
    await expect(loadApp(row, fakeEnv)).rejects.toBeInstanceOf(
      AppLoadError,
    );
    await expect(loadApp(row, fakeEnv)).rejects.toThrow(
      /null entry_url/,
    );
  });

  it('throws AppLoadError when default export is missing', async () => {
    await expect(
      loadApp(fakeRow, fakeEnv, {
        importModule: async () => ({}),
      }),
    ).rejects.toBeInstanceOf(AppLoadError);
    await expect(
      loadApp(fakeRow, fakeEnv, {
        importModule: async () => ({}),
      }),
    ).rejects.toThrow(/no default export/);
  });

  it('throws AppLoadError when default export is not a function', async () => {
    await expect(
      loadApp(fakeRow, fakeEnv, {
        importModule: async () => ({ default: 'not-a-function' }),
      }),
    ).rejects.toThrow(/default export is not a function/);
  });

  it('throws AppLoadError when importModule rejects, and preserves cause', async () => {
    const cause = new Error('network failed');
    let caught: AppLoadError | null = null;
    try {
      await loadApp(fakeRow, fakeEnv, {
        importModule: async () => {
          throw cause;
        },
      });
    } catch (err) {
      caught = err as AppLoadError;
    }
    expect(caught).toBeInstanceOf(AppLoadError);
    expect(caught?.appId).toBe('demo');
    expect(caught?.cause).toBe(cause);
    expect(caught?.message).toMatch(/network failed/);
  });

  it('throws AppLoadError when bootApp throws, and preserves cause', async () => {
    const cause = new Error('boom in bootApp');
    let caught: AppLoadError | null = null;
    try {
      await loadApp(fakeRow, fakeEnv, {
        importModule: async () => ({
          default: () => {
            throw cause;
          },
        }),
      });
    } catch (err) {
      caught = err as AppLoadError;
    }
    expect(caught).toBeInstanceOf(AppLoadError);
    expect(caught?.cause).toBe(cause);
    expect(caught?.message).toMatch(/bootApp\(env\) threw/);
  });

  it('throws AppLoadError when bootApp returns a non-component value', async () => {
    await expect(
      loadApp(fakeRow, fakeEnv, {
        importModule: async () => ({
          default: () => ({ __tytus_placeholder: true }),
        }),
      }),
    ).rejects.toThrow(/expected a React component/);
  });
});

class MemoryDb implements Db {
  private rows: Array<Record<string, SqlValue>> = [];
  async exec(): Promise<void> {}
  async query<T>(sql: string, bindings: SqlValue[] = []): Promise<T[]> {
    if (/installed_apps/i.test(sql) && /WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const id = bindings[0];
      const row = this.rows.find((r) => r.id === id);
      return (row ? [row] : []) as unknown as T[];
    }
    return this.rows as unknown as T[];
  }
  async run(sql: string, bindings: SqlValue[] = []): Promise<void> {
    if (/INSERT\s+INTO\s+installed_apps/i.test(sql)) {
      const [
        id,
        kind,
        manifest_json,
        entry_url,
        assets_url,
        installed_at,
        enabled,
        builtin_protected,
      ] = bindings;
      this.rows.push({
        id,
        kind,
        manifest_json,
        entry_url,
        assets_url,
        installed_at,
        enabled,
        builtin_protected,
      });
    }
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

describe('loadAppById', () => {
  it('looks up the row, builds env via the injected makeEnv, and dispatches loadApp', async () => {
    const db = new MemoryDb();
    await db.run(
      `INSERT INTO installed_apps (id, kind, manifest_json, entry_url, assets_url, installed_at, enabled, builtin_protected) VALUES (?,?,?,?,?,?,?,?)`,
      [
        'demo',
        'bundled',
        JSON.stringify(fakeManifest),
        '@tytus/app-demo',
        null,
        0,
        1,
        1,
      ],
    );

    const FakeComponent = () => null;
    const makeEnv = vi.fn(() => fakeEnv);
    const importModule = vi.fn(async () => ({
      default: () => FakeComponent,
    }));

    const result = await loadAppById('demo', db, {
      importModule,
      makeEnv,
    });

    expect(makeEnv).toHaveBeenCalledTimes(1);
    expect(makeEnv).toHaveBeenCalledWith('demo', expect.objectContaining({
      id: 'demo',
    }));
    expect(importModule).toHaveBeenCalledWith('@tytus/app-demo');
    expect(result.Component).toBe(FakeComponent);
  });

  it('throws AppLoadError when the app is not in installed_apps', async () => {
    const db = new MemoryDb();
    await expect(loadAppById('missing', db)).rejects.toBeInstanceOf(
      AppLoadError,
    );
    await expect(loadAppById('missing', db)).rejects.toThrow(
      /not found in installed_apps/,
    );
  });
});
