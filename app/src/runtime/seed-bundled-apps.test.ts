import { describe, expect, it } from 'vitest';
import {
  BUNDLED_APP_MANIFESTS,
  seedBundledAppsAtBoot,
} from './seed-bundled-apps';
import { listInstalledApps } from './installed-apps-repo';
import type { Db, SqlValue } from '@/lib/db/types';

class MemoryDb implements Db {
  private rows: Array<Record<string, SqlValue>> = [];
  async exec(): Promise<void> {}
  async query<T>(): Promise<T[]> {
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
    }
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

const SYSTEM_APP_IDS = [
  'memo',
  'music-creator',
  'music-player',
  'sheet',
  'studio',
  'voice-recorder',
];
const USER_APP_IDS = [
  'api-tester',
  'code-editor',
  'markdown-preview',
  'photo-editor',
  'text-editor',
];
const ALL_BUNDLED_IDS = [...SYSTEM_APP_IDS, ...USER_APP_IDS].sort();

describe('BUNDLED_APP_MANIFESTS', () => {
  it('contains every system + user-app skeleton manifest', () => {
    const ids = BUNDLED_APP_MANIFESTS.map((b) => b.manifest.id).sort();
    expect(ids).toEqual(ALL_BUNDLED_IDS);
  });

  it('every manifest has the required fields', () => {
    for (const b of BUNDLED_APP_MANIFESTS) {
      expect(b.manifest.id).toBeTruthy();
      expect(b.manifest.name).toBeTruthy();
      expect(b.manifest.version).toBeTruthy();
      expect(b.manifest.window).toBeDefined();
      expect(b.manifest.permissions).toBeDefined();
    }
  });
});

describe('seedBundledAppsAtBoot', () => {
  it('seeds every bundled manifest into installed_apps', async () => {
    const db = new MemoryDb();
    await seedBundledAppsAtBoot(db);
    const installed = await listInstalledApps(db);
    expect(installed.map((r) => r.id).sort()).toEqual(ALL_BUNDLED_IDS);
    for (const row of installed) {
      expect(row.kind).toBe('bundled');
    }
  });

  it('marks system apps protected and user-app skeletons unprotected', async () => {
    const db = new MemoryDb();
    await seedBundledAppsAtBoot(db);
    const installed = await listInstalledApps(db);
    const byId = new Map(installed.map((r) => [r.id, r]));
    for (const id of SYSTEM_APP_IDS) {
      expect(byId.get(id)?.builtinProtected).toBe(true);
    }
    for (const id of USER_APP_IDS) {
      expect(byId.get(id)?.builtinProtected).toBe(false);
    }
  });

  it('is idempotent — re-running does not duplicate rows', async () => {
    const db = new MemoryDb();
    await seedBundledAppsAtBoot(db);
    await seedBundledAppsAtBoot(db);
    await seedBundledAppsAtBoot(db);
    expect((await listInstalledApps(db)).length).toBe(ALL_BUNDLED_IDS.length);
  });
});
