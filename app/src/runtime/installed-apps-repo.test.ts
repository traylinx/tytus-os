import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getInstalledApp,
  listInstalledApps,
  resolveSharedTableNames,
  seedInstalledApps,
} from './installed-apps-repo';
import type { Db, SqlValue } from '@/lib/db/types';
import type { Manifest } from '@tytus/host-api';

class MemoryInstalledAppsDb implements Db {
  private rows: Array<Record<string, SqlValue>> = [];

  async exec(): Promise<void> {}

  async query<T>(sql: string, bindings: SqlValue[] = []): Promise<T[]> {
    if (/WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const id = String(bindings[0]);
      return this.rows.filter((r) => r.id === id) as unknown as T[];
    }
    if (/WHERE\s+kind\s*=\s*'bundled'/i.test(sql)) {
      return this.rows.filter((r) => r.kind === 'bundled') as unknown as T[];
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
        manifest_url,
        installed_at,
        enabled,
        builtin_protected,
      ] = bindings;
      const existing = this.rows.findIndex((r) => r.id === id);
      const row: Record<string, SqlValue> = {
        id,
        kind,
        manifest_json,
        entry_url,
        assets_url,
        manifest_url,
        installed_at,
        enabled,
        builtin_protected,
      };
      if (existing >= 0) {
        // Mimic ON CONFLICT DO UPDATE — only the three excluded fields.
        this.rows[existing].manifest_json = manifest_json;
        this.rows[existing].entry_url = entry_url;
        this.rows[existing].assets_url = assets_url;
      } else {
        this.rows.push(row);
      }
      return;
    }
    if (/DELETE\s+FROM\s+installed_apps/i.test(sql)) {
      const id = String(bindings[0]);
      const requireBundled = /AND\s+kind\s*=\s*'bundled'/i.test(sql);
      this.rows = this.rows.filter((r) => {
        if (r.id !== id) return true;
        if (requireBundled && r.kind !== 'bundled') return true;
        return false;
      });
      return;
    }
    if (/UPDATE\s+installed_apps/i.test(sql)) {
      const [manifest_json, entry_url, assets_url, manifest_url, id] = bindings;
      const idx = this.rows.findIndex((r) => r.id === id);
      if (idx >= 0) {
        this.rows[idx].manifest_json = manifest_json;
        this.rows[idx].entry_url = entry_url;
        this.rows[idx].assets_url = assets_url;
        this.rows[idx].manifest_url = manifest_url;
      }
      return;
    }
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  /** Test helper. */
  __seed(rows: Array<Record<string, SqlValue>>): void {
    this.rows = rows;
  }
}

const baseManifest = (
  id: string,
  overrides: Partial<Manifest> = {},
): Manifest => ({
  id,
  name: id,
  version: '1.0.0',
  icon: 'Box',
  category: 'System',
  description: id,
  window: {
    defaultSize: { width: 100, height: 100 },
    minSize: { width: 100, height: 100 },
  },
  permissions: [],
  entry: { module: `./${id}/index.js` },
  ...overrides,
});

let db: MemoryInstalledAppsDb;

beforeEach(() => {
  db = new MemoryInstalledAppsDb();
});

afterEach(() => {});

describe('seedInstalledApps', () => {
  it('inserts a new bundled row with manifest JSON', async () => {
    await seedInstalledApps(db, [
      {
        manifest: baseManifest('sheet'),
        entryUrl: '/_apps/sheet/index.js',
        assetsUrl: '/_apps/sheet/assets/',
      },
    ]);
    const rows = await listInstalledApps(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sheet');
    expect(rows[0].kind).toBe('bundled');
    expect(rows[0].manifest.id).toBe('sheet');
  });

  it('flags built-in-protected for the v1 system apps', async () => {
    await seedInstalledApps(db, [
      { manifest: baseManifest('sheet'), entryUrl: '', assetsUrl: '' },
      { manifest: baseManifest('settings'), entryUrl: '', assetsUrl: '' },
    ]);
    const rows = await listInstalledApps(db);
    expect(rows.find((r) => r.id === 'sheet')?.builtinProtected).toBe(true);
    expect(rows.find((r) => r.id === 'settings')?.builtinProtected).toBe(false);
  });

  it('garbage-collects orphan bundled rows that disappear from the seed list', async () => {
    // Seed an old bundled row that the new build no longer ships
    // (mimics the user's local DB carrying a stale `markdown-preview`
    // row from a prior build).
    db.__seed([
      {
        id: 'markdown-preview',
        kind: 'bundled',
        manifest_json: JSON.stringify(baseManifest('markdown-preview')),
        entry_url: '@tytus/app-markdown-preview',
        assets_url: null,
        manifest_url: null,
        installed_at: 0,
        enabled: 1,
        builtin_protected: 0,
      },
    ]);

    await seedInstalledApps(db, [
      { manifest: baseManifest('sheet'), entryUrl: '@tytus/app-sheet', assetsUrl: null },
    ]);

    const remaining = (await listInstalledApps(db)).map((r) => r.id).sort();
    expect(remaining).toEqual(['sheet']);
  });

  it('preserves kind="installed" rows even when their id is not in the seed list', async () => {
    // A user-installed third-party app must NEVER be touched by the
    // boot-seed garbage collector — only kind='bundled' orphans are
    // swept.
    db.__seed([
      {
        id: 'todoist',
        kind: 'installed',
        manifest_json: JSON.stringify(baseManifest('todoist')),
        entry_url: 'https://cdn.example.com/todoist/index.js',
        assets_url: null,
        manifest_url: 'https://cdn.example.com/todoist/tytus-app.json',
        installed_at: 0,
        enabled: 1,
        builtin_protected: 0,
      },
    ]);

    await seedInstalledApps(db, [
      { manifest: baseManifest('sheet'), entryUrl: '@tytus/app-sheet', assetsUrl: null },
    ]);

    const ids = (await listInstalledApps(db)).map((r) => r.id).sort();
    expect(ids).toEqual(['sheet', 'todoist']);
  });

  it('re-asserts manifest_json on conflict (idempotent for boot seed)', async () => {
    await seedInstalledApps(db, [
      {
        manifest: baseManifest('sheet', { version: '1.0.0' }),
        entryUrl: '',
        assetsUrl: '',
      },
    ]);
    await seedInstalledApps(db, [
      {
        manifest: baseManifest('sheet', { version: '1.1.0' }),
        entryUrl: '',
        assetsUrl: '',
      },
    ]);
    const row = await getInstalledApp(db, 'sheet');
    expect(row?.manifest.version).toBe('1.1.0');
  });
});

describe('getInstalledApp', () => {
  it('returns null when the id is not installed', async () => {
    expect(await getInstalledApp(db, 'missing')).toBeNull();
  });

  it('returns the row when installed', async () => {
    await seedInstalledApps(db, [
      { manifest: baseManifest('sheet'), entryUrl: '', assetsUrl: '' },
    ]);
    const r = await getInstalledApp(db, 'sheet');
    expect(r?.id).toBe('sheet');
  });
});

describe('resolveSharedTableNames', () => {
  it('returns empty when reader is not installed', async () => {
    expect(await resolveSharedTableNames(db, 'unknown')).toEqual([]);
  });

  it('returns empty when reader has no storage.shared.<key> permissions', async () => {
    await seedInstalledApps(db, [
      {
        manifest: baseManifest('sheet', {
          permissions: ['storage.app'],
        }),
        entryUrl: '',
        assetsUrl: '',
      },
    ]);
    expect(await resolveSharedTableNames(db, 'sheet')).toEqual([]);
  });

  it('resolves a key declared by the reader to the owner\'s physical table', async () => {
    await seedInstalledApps(db, [
      {
        manifest: baseManifest('voice-recorder', {
          storage: {
            shares: {
              voice_recordings: 'app_voice_recorder_recordings',
            },
          },
        }),
        entryUrl: '',
        assetsUrl: '',
      },
      {
        manifest: baseManifest('music-creator', {
          permissions: ['storage.app', 'storage.shared.voice_recordings'],
        }),
        entryUrl: '',
        assetsUrl: '',
      },
    ]);
    const tables = await resolveSharedTableNames(db, 'music-creator');
    expect(tables).toEqual(['app_voice_recorder_recordings']);
  });

  it('ignores keys the reader does NOT declare even if owner shares them', async () => {
    await seedInstalledApps(db, [
      {
        manifest: baseManifest('voice-recorder', {
          storage: {
            shares: {
              voice_recordings: 'app_voice_recorder_recordings',
              voice_settings: 'app_voice_recorder_settings',
            },
          },
        }),
        entryUrl: '',
        assetsUrl: '',
      },
      {
        manifest: baseManifest('music-creator', {
          permissions: ['storage.shared.voice_recordings'],
        }),
        entryUrl: '',
        assetsUrl: '',
      },
    ]);
    const tables = await resolveSharedTableNames(db, 'music-creator');
    expect(tables).toEqual(['app_voice_recorder_recordings']);
  });

  it('skips the reader\'s own shares (an app does not consume itself)', async () => {
    await seedInstalledApps(db, [
      {
        manifest: baseManifest('voice-recorder', {
          permissions: ['storage.shared.voice_recordings'],
          storage: {
            shares: {
              voice_recordings: 'app_voice_recorder_recordings',
            },
          },
        }),
        entryUrl: '',
        assetsUrl: '',
      },
    ]);
    const tables = await resolveSharedTableNames(db, 'voice-recorder');
    expect(tables).toEqual([]);
  });

  it('de-duplicates when multiple owners share the same physical table', async () => {
    await seedInstalledApps(db, [
      {
        manifest: baseManifest('owner-a', {
          storage: { shares: { foo: 'app_owner_table' } },
        }),
        entryUrl: '',
        assetsUrl: '',
      },
      {
        manifest: baseManifest('owner-b', {
          storage: { shares: { foo: 'app_owner_table' } },
        }),
        entryUrl: '',
        assetsUrl: '',
      },
      {
        manifest: baseManifest('reader', {
          permissions: ['storage.shared.foo'],
        }),
        entryUrl: '',
        assetsUrl: '',
      },
    ]);
    const tables = await resolveSharedTableNames(db, 'reader');
    expect(tables).toEqual(['app_owner_table']);
  });
});

describe('insertInstalledApp / deleteInstalledApp / updateInstalledApp', () => {
  // Direct coverage for the CRUD helpers added in Phase 2
  // (SPRINT-TYTUS-APP-SYSTEM-V1). Today these are also exercised
  // transitively via installer.test.ts, but a regression in the SQL
  // shape would be invisible at the installer layer.

  // Lazy-import keeps the existing test imports unchanged above.
  const repo = () =>
    import('./installed-apps-repo') as Promise<typeof import('./installed-apps-repo')>;

  it('insertInstalledApp writes a kind=installed row with manifestUrl', async () => {
    const { insertInstalledApp } = await repo();
    await insertInstalledApp(db, {
      id: 'todoist',
      kind: 'installed',
      manifest: baseManifest('todoist'),
      entryUrl: 'https://cdn.example.com/todoist/index.js',
      assetsUrl: null,
      manifestUrl: 'https://cdn.example.com/todoist/tytus-app.json',
      installedAt: 1700000000000,
      enabled: true,
      builtinProtected: false,
    });
    const row = await getInstalledApp(db, 'todoist');
    expect(row).not.toBeNull();
    expect(row!.id).toBe('todoist');
    expect(row!.kind).toBe('installed');
    expect(row!.manifestUrl).toBe('https://cdn.example.com/todoist/tytus-app.json');
    expect(row!.builtinProtected).toBe(false);
    expect(row!.enabled).toBe(true);
  });

  it('deleteInstalledApp removes the row by id', async () => {
    const { insertInstalledApp, deleteInstalledApp } = await repo();
    await insertInstalledApp(db, {
      id: 'todoist',
      kind: 'installed',
      manifest: baseManifest('todoist'),
      entryUrl: 'https://cdn.example.com/todoist/index.js',
      assetsUrl: null,
      manifestUrl: 'https://cdn.example.com/todoist/tytus-app.json',
      installedAt: 1700000000000,
      enabled: true,
      builtinProtected: false,
    });
    expect(await getInstalledApp(db, 'todoist')).not.toBeNull();
    await deleteInstalledApp(db, 'todoist');
    expect(await getInstalledApp(db, 'todoist')).toBeNull();
  });

  it('deleteInstalledApp on non-existent id is a no-op (does not throw)', async () => {
    const { deleteInstalledApp } = await repo();
    await expect(deleteInstalledApp(db, 'never-existed')).resolves.toBeUndefined();
  });

  it('updateInstalledApp swaps manifest + entry + manifestUrl in place', async () => {
    const { insertInstalledApp, updateInstalledApp } = await repo();
    await insertInstalledApp(db, {
      id: 'todoist',
      kind: 'installed',
      manifest: baseManifest('todoist', { version: '1.0.0' }),
      entryUrl: 'https://cdn.example.com/todoist@v1/index.js',
      assetsUrl: null,
      manifestUrl: 'https://cdn.example.com/todoist@v1/tytus-app.json',
      installedAt: 1700000000000,
      enabled: true,
      builtinProtected: false,
    });
    await updateInstalledApp(db, 'todoist', {
      manifest: baseManifest('todoist', { version: '2.0.0' }),
      entryUrl: 'https://cdn.example.com/todoist@v2/index.js',
      assetsUrl: null,
      manifestUrl: 'https://cdn.example.com/todoist@v2/tytus-app.json',
    });
    const row = await getInstalledApp(db, 'todoist');
    expect(row).not.toBeNull();
    expect(row!.manifest.version).toBe('2.0.0');
    expect(row!.entryUrl).toBe('https://cdn.example.com/todoist@v2/index.js');
    expect(row!.manifestUrl).toBe('https://cdn.example.com/todoist@v2/tytus-app.json');
    // Other fields preserved.
    expect(row!.installedAt).toBe(1700000000000);
    expect(row!.builtinProtected).toBe(false);
  });
});
