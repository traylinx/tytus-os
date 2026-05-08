import { beforeEach, describe, expect, it } from 'vitest';
import type { Manifest } from '@tytus/host-api';
import type { Db, SqlValue } from '@/lib/db/types';
import {
  insertInstalledApp,
  listInstalledApps,
  type InstalledAppRow,
} from './installed-apps-repo';
import {
  __clearInstalledAppsCacheForTests,
  addToInstalledAppsCache,
  getInstalledAppRow,
} from './installed-apps-cache';
import {
  LEGACY_WORKSPACE_APP_ID,
  migrateWorkspaceRebrandIfPresent,
  WORKSPACE_APP_ENTRY_URL,
  WORKSPACE_APP_ID,
  WORKSPACE_APP_MANIFEST_URL,
  WORKSPACE_APP_VERSION,
} from './app-rebrand-migrations';

class MemoryDb implements Db {
  rows: Array<Record<string, SqlValue>> = [];

  async exec(): Promise<void> {}

  async query<T>(sql: string, bindings: SqlValue[] = []): Promise<T[]> {
    if (/WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const id = String(bindings[0]);
      return this.rows.filter((r) => r.id === id) as unknown as T[];
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
      this.rows.push({
        id,
        kind,
        manifest_json,
        entry_url,
        assets_url,
        manifest_url,
        installed_at,
        enabled,
        builtin_protected,
      });
      return;
    }
    if (/DELETE\s+FROM\s+installed_apps/i.test(sql)) {
      const id = String(bindings[0]);
      this.rows = this.rows.filter((r) => r.id !== id);
      return;
    }
    if (/UPDATE\s+installed_apps/i.test(sql)) {
      const [
        id,
        kind,
        manifest_json,
        entry_url,
        assets_url,
        manifest_url,
        enabled,
        builtin_protected,
        legacyId,
      ] = bindings;
      const row = this.rows.find((r) => r.id === legacyId);
      if (row) {
        row.id = id;
        row.kind = kind;
        row.manifest_json = manifest_json;
        row.entry_url = entry_url;
        row.assets_url = assets_url;
        row.manifest_url = manifest_url;
        row.enabled = enabled;
        row.builtin_protected = builtin_protected;
      }
    }
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

const legacyManifest: Manifest = {
  id: LEGACY_WORKSPACE_APP_ID,
  name: 'Tytus Forge',
  version: '0.1.0',
  icon: 'Sparkles',
  category: 'Productivity',
  description: 'Old workspace app.',
  window: {
    defaultSize: { width: 1200, height: 780 },
    minSize: { width: 760, height: 520 },
  },
  permissions: [],
  entry: {
    url: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-forge@0.1.0/dist/index.js',
  },
};

const legacyRow: InstalledAppRow = {
  id: LEGACY_WORKSPACE_APP_ID,
  kind: 'installed',
  manifest: legacyManifest,
  entryUrl: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-forge@0.1.0/dist/index.js',
  assetsUrl: null,
  manifestUrl:
    'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-forge@0.1.0/tytus-app.json',
  installedAt: 123,
  enabled: true,
  builtinProtected: false,
};

let db: MemoryDb;

beforeEach(() => {
  db = new MemoryDb();
  __clearInstalledAppsCacheForTests();
});

describe('migrateWorkspaceRebrandIfPresent', () => {
  it('rewrites the legacy workspace row to the current installed app', async () => {
    await insertInstalledApp(db, legacyRow);
    addToInstalledAppsCache(legacyRow);

    const report = await migrateWorkspaceRebrandIfPresent(db);

    expect(report.migrated).toBe(true);
    expect(report.reason).toMatch(/migrated forge to atomek/);

    const rows = await listInstalledApps(db);
    expect(rows.map((r) => r.id)).toEqual([WORKSPACE_APP_ID]);
    expect(rows[0]).toMatchObject({
      id: WORKSPACE_APP_ID,
      kind: 'installed',
      entryUrl: WORKSPACE_APP_ENTRY_URL,
      manifestUrl: WORKSPACE_APP_MANIFEST_URL,
      enabled: true,
      builtinProtected: false,
    });
    expect(rows[0].manifest).toMatchObject({
      id: WORKSPACE_APP_ID,
      name: 'Atomek',
      version: WORKSPACE_APP_VERSION,
    });
    expect(getInstalledAppRow(LEGACY_WORKSPACE_APP_ID)).toBeUndefined();
    expect(getInstalledAppRow(WORKSPACE_APP_ID)?.entryUrl).toBe(
      WORKSPACE_APP_ENTRY_URL,
    );
  });

  it('deletes the duplicate legacy row when the canonical row already exists', async () => {
    const canonical: InstalledAppRow = {
      ...legacyRow,
      id: WORKSPACE_APP_ID,
      manifest: {
        ...legacyManifest,
        id: WORKSPACE_APP_ID,
        name: 'Atomek',
        version: WORKSPACE_APP_VERSION,
        entry: { url: WORKSPACE_APP_ENTRY_URL },
      },
      entryUrl: WORKSPACE_APP_ENTRY_URL,
      manifestUrl: WORKSPACE_APP_MANIFEST_URL,
    };
    await insertInstalledApp(db, legacyRow);
    await insertInstalledApp(db, canonical);

    const report = await migrateWorkspaceRebrandIfPresent(db);

    expect(report.migrated).toBe(true);
    expect((await listInstalledApps(db)).map((r) => r.id)).toEqual([
      WORKSPACE_APP_ID,
    ]);
  });
});
