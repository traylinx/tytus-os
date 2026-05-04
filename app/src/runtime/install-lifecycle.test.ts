/**
 * Phase 8 of SPRINT-TYTUS-APP-SYSTEM-V1 — multi-app install lifecycle.
 *
 * Exercises the full path against a single MemoryDb in one continuous
 * sequence: boot-seed bundled rows → install 5 user apps via URL →
 * list → uninstall a subset → reinstall one → final assert. This is
 * the integration smoke that the per-function tests in
 * `installer.test.ts` and `seed-bundled-apps.test.ts` don't cover
 * collectively.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppFromManifestUrl,
  reinstallApp,
  uninstallApp,
} from './installer';
import { listInstalledApps } from './installed-apps-repo';
import { seedBundledAppsAtBoot } from './seed-bundled-apps';
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
      const existing = this.rows.findIndex((r) => r.id === id);
      if (existing >= 0) {
        this.rows[existing].manifest_json = manifest_json;
        this.rows[existing].entry_url = entry_url;
        this.rows[existing].assets_url = assets_url;
        this.rows[existing].manifest_url = manifest_url;
      } else {
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
      }
      return;
    }
    if (/DELETE\s+FROM\s+installed_apps/i.test(sql)) {
      const id = String(bindings[0]);
      this.rows = this.rows.filter((r) => r.id !== id);
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
}

const userAppManifest = (id: string, version = '1.0.0'): Manifest => ({
  id,
  name: id,
  version,
  icon: 'Box',
  category: 'Productivity',
  description: `${id} description`,
  window: {
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 400, height: 300 },
  },
  permissions: [],
  entry: { url: `https://cdn.jsdelivr.net/gh/traylinx/tytus-app-${id}@v${version}/dist/index.js` },
});

const manifestUrlFor = (id: string) =>
  `https://cdn.jsdelivr.net/gh/traylinx/tytus-app-${id}@latest/tytus-app.json`;

let db: MemoryDb;
beforeEach(() => {
  db = new MemoryDb();
});

describe('install lifecycle (Phase 8 smoke)', () => {
  it('seed → install 5 → list → uninstall 3 → reinstall 1', async () => {
    // 1. Boot seed: 5 bundled rows (system apps only — user apps are
    //    distributed via CDN and discovered through App Store Featured).
    await seedBundledAppsAtBoot(db);
    expect((await listInstalledApps(db)).length).toBe(5);
    for (const row of await listInstalledApps(db)) {
      expect(row.kind).toBe('bundled');
    }

    // 2. Simulate App Store install of 5 fresh user-app URLs.
    //    These have NEW ids (not the bundled skeleton ids) so the
    //    installer doesn't trip the duplicate guard. In production,
    //    a third-party id like `tytus-app-todoist`.
    const newAppIds = ['todoist', 'calculator-pro', 'notes-plus', 'json-tree', 'kanban'];
    const fetchImpl = vi.fn(async (url: string) => {
      const id = newAppIds.find((x) => url.includes(`tytus-app-${x}`));
      if (!id) throw new Error(`unexpected fetch URL: ${url}`);
      return {
        ok: true,
        status: 200,
        json: async () => userAppManifest(id),
      };
    });

    for (const id of newAppIds) {
      const row = await installAppFromManifestUrl({
        manifestUrl: manifestUrlFor(id),
        db,
        fetchImpl,
      });
      expect(row.id).toBe(id);
      expect(row.kind).toBe('installed');
      expect(row.builtinProtected).toBe(false);
      expect(row.manifestUrl).toBe(manifestUrlFor(id));
    }

    // 3. List: now 5 bundled + 5 installed = 10 total.
    const afterInstall = await listInstalledApps(db);
    expect(afterInstall.length).toBe(10);
    expect(afterInstall.filter((r) => r.kind === 'installed').length).toBe(5);

    // 4. Uninstall 3 of the 5 installed apps.
    const toUninstall = ['todoist', 'calculator-pro', 'notes-plus'];
    for (const id of toUninstall) {
      await uninstallApp({ appId: id, db });
    }
    const afterUninstall = await listInstalledApps(db);
    expect(afterUninstall.length).toBe(7);
    expect(afterUninstall.filter((r) => r.kind === 'installed').map((r) => r.id).sort())
      .toEqual(['json-tree', 'kanban']);

    // 5. Reinstall json-tree with a bumped version. Manifest URL is
    //    re-fetched via the stored manifest_url column → UPDATE in place.
    const fetchV2 = vi.fn(async (url: string) => {
      expect(url).toBe(manifestUrlFor('json-tree'));
      return { ok: true, status: 200, json: async () => userAppManifest('json-tree', '2.0.0') };
    });
    const reinstalledRow = await reinstallApp({
      appId: 'json-tree',
      db,
      fetchImpl: fetchV2,
    });
    expect(reinstalledRow.id).toBe('json-tree');
    expect(reinstalledRow.kind).toBe('installed');
    expect(reinstalledRow.manifest.version).toBe('2.0.0');

    // 6. Final shape: 5 bundled + 2 installed = 7. json-tree is v2.0.0.
    const final = await listInstalledApps(db);
    expect(final.length).toBe(7);
    expect(final.filter((r) => r.kind === 'installed').map((r) => r.id).sort())
      .toEqual(['json-tree', 'kanban']);
  });

  it('protects system apps from uninstall even mid-lifecycle', async () => {
    await seedBundledAppsAtBoot(db);
    // System apps (builtin_protected=1): memo, sheet, studio, music-player,
    // voice-recorder. Try to uninstall each — all should throw.
    const systemApps = ['memo', 'sheet', 'studio', 'music-player', 'voice-recorder'];
    for (const id of systemApps) {
      await expect(uninstallApp({ appId: id, db })).rejects.toMatchObject({
        code: 'protected',
      });
    }
    // Bundled count unchanged.
    expect((await listInstalledApps(db)).length).toBe(5);
  });

  it('rejects duplicate install of a system-app id (e.g. memo)', async () => {
    await seedBundledAppsAtBoot(db);
    // memo is a system app seeded at boot (kind='bundled',
    // builtin_protected=1). A fresh install under the same id fails
    // with code 'duplicate' before the protected check fires.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => userAppManifest('memo'),
    }));
    await expect(
      installAppFromManifestUrl({
        manifestUrl: manifestUrlFor('memo'),
        db,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'duplicate' });
  });
});
