/**
 * Tests for cleanupJuli3taAlphaIfPresent — the one-shot boot sweep
 * that removes a stale `juli3ta` alpha placeholder row.
 *
 * The alpha (versions 0.0.x) is intentionally NOT shipped as a default
 * Featured app today. This sweep handles users whose IndexedDB still
 * has the row from when it briefly was.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { cleanupJuli3taAlphaIfPresent, upgradeJuli3taGatewayFixIfStale } from './cleanup-juli3ta-alpha';
import {
  insertInstalledApp,
  listInstalledApps,
  type InstalledAppRow,
} from './installed-apps-repo';
import {
  __clearInstalledAppsCacheForTests,
  addToInstalledAppsCache,
  listCachedInstalledApps,
} from './installed-apps-cache';
import type { Db, SqlValue } from '@/lib/db/types';
import type { Manifest } from '@tytus/host-api';

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
      const [manifest_json, entry_url, assets_url, manifest_url, id] = bindings;
      const row = this.rows.find((r) => r.id === id);
      if (row) {
        row.manifest_json = manifest_json;
        row.entry_url = entry_url;
        row.assets_url = assets_url;
        row.manifest_url = manifest_url;
      }
      return;
    }
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

const baseManifest = (version: string): Manifest => ({
  id: 'juli3ta',
  name: 'JULI3TA',
  version,
  icon: 'Music',
  category: 'Creative',
  description: 'AI-native music creator.',
  window: {
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 400, height: 320 },
  },
  permissions: [],
  entry: { url: 'https://cdn.example.com/juli3ta.js' },
});

const alphaRow = (version: string): InstalledAppRow => ({
  id: 'juli3ta',
  kind: 'installed',
  manifest: baseManifest(version),
  entryUrl: 'https://cdn.example.com/juli3ta.js',
  assetsUrl: null,
  manifestUrl: 'https://cdn.example.com/tytus-app.json',
  installedAt: 0,
  enabled: true,
  builtinProtected: false,
});

let db: MemoryDb;

beforeEach(() => {
  db = new MemoryDb();
  __clearInstalledAppsCacheForTests();
});

describe('cleanupJuli3taAlphaIfPresent', () => {
  it('removes a 0.0.x alpha placeholder row', async () => {
    const row = alphaRow('0.0.2-alpha.1');
    await insertInstalledApp(db, row);
    addToInstalledAppsCache(row);
    const report = await cleanupJuli3taAlphaIfPresent(db);
    expect(report.removed).toBe(true);
    expect(report.reason).toMatch(/0\.0\.2/);
    expect((await listInstalledApps(db)).map((r) => r.id)).toEqual([]);
    expect(listCachedInstalledApps().map((r) => r.id)).toEqual([]);
  });

  it('removes the incomplete v0.1.x standalone row', async () => {
    const row = alphaRow('0.1.0');
    await insertInstalledApp(db, row);
    addToInstalledAppsCache(row);
    const report = await cleanupJuli3taAlphaIfPresent(db);
    expect(report.removed).toBe(true);
    expect(report.reason).toMatch(/incomplete standalone 0\.1\.0/);
    expect((await listInstalledApps(db)).map((r) => r.id)).toEqual([]);
    expect(listCachedInstalledApps().map((r) => r.id)).toEqual([]);
  });


  it('keeps the verified v0.2+ standalone extraction row', async () => {
    const row = alphaRow('0.2.1-dev');
    await insertInstalledApp(db, row);
    addToInstalledAppsCache(row);
    const report = await cleanupJuli3taAlphaIfPresent(db);
    expect(report.removed).toBe(false);
    expect(report.reason).toBe('version 0.2.1-dev is not incomplete standalone');
    expect((await listInstalledApps(db)).map((r) => r.id)).toEqual(['juli3ta']);
    expect(listCachedInstalledApps().map((r) => r.id)).toEqual(['juli3ta']);
  });

  it('is a no-op when no juli3ta row exists', async () => {
    const report = await cleanupJuli3taAlphaIfPresent(db);
    expect(report.removed).toBe(false);
    expect(report.reason).toBe('no juli3ta row');
  });

  it('is idempotent — second run after a removal is a no-op', async () => {
    const row = alphaRow('0.0.2-alpha.1');
    await insertInstalledApp(db, row);
    addToInstalledAppsCache(row);
    const first = await cleanupJuli3taAlphaIfPresent(db);
    expect(first.removed).toBe(true);
    const second = await cleanupJuli3taAlphaIfPresent(db);
    expect(second.removed).toBe(false);
    expect(second.reason).toBe('no juli3ta row');
  });
});


describe('upgradeJuli3taGatewayFixIfStale', () => {
  it('upgrades existing standalone JULI3TA rows below v0.3.11 to the gateway-fix tag', async () => {
    await insertInstalledApp(db, alphaRow('0.3.2'));

    const report = await upgradeJuli3taGatewayFixIfStale(db);

    expect(report.upgraded).toBe(true);
    expect(report.reason).toMatch(/0\.3\.2 to 0\.3\.11/);
    const [row] = await listInstalledApps(db);
    expect(row?.manifest.version).toBe('0.3.11');
    expect(row?.entryUrl).toBe(
      'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-juli3ta@juli3ta-0.3.11/dist/index.js',
    );
    expect(row?.manifestUrl).toBe(
      'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-juli3ta@juli3ta-0.3.11/tytus-app.json',
    );
  });

  it('keeps current standalone JULI3TA rows unchanged', async () => {
    await insertInstalledApp(db, alphaRow('0.3.11'));

    const report = await upgradeJuli3taGatewayFixIfStale(db);

    expect(report.upgraded).toBe(false);
    expect(report.reason).toBe('version 0.3.11 is current');
    const [row] = await listInstalledApps(db);
    expect(row?.manifest.version).toBe('0.3.11');
    expect(row?.entryUrl).toBe('https://cdn.example.com/juli3ta.js');
  });
});
