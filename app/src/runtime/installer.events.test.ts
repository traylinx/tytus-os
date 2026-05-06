/**
 * Verifies that installer.ts dispatches `'changed'` on the
 * `installed-apps-events` bus after every successful mutation. The
 * `useInstalledAppIds` hook subscribes to that bus, which is what
 * makes the App Store → Open round-trip work for freshly-installed
 * third-party apps.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppFromManifestUrl,
  reinstallApp,
  updateInstalledAppFromManifestUrl,
  uninstallApp,
} from './installer';
import { subscribeInstalledAppsChanged } from './installed-apps-events';
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

const goodManifest = (id: string): Manifest => ({
  id,
  name: id,
  version: '1.0.0',
  icon: 'Box',
  category: 'Productivity',
  description: `${id} description`,
  window: {
    defaultSize: { width: 600, height: 400 },
    minSize: { width: 300, height: 200 },
  },
  permissions: [],
  entry: { url: `https://cdn.example.com/${id}/dist/index.js` },
});

function mockFetch(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}

let db: MemoryDb;
let listener: ReturnType<typeof vi.fn<() => void>>;
let unsubscribe: () => void;

beforeEach(() => {
  db = new MemoryDb();
  listener = vi.fn<() => void>();
  unsubscribe = subscribeInstalledAppsChanged(listener);
});

describe('installer events', () => {
  it('fires on successful install', async () => {
    const manifest = goodManifest('cool-app');
    await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/cool-app/tytus-app.json',
      db,
      fetchImpl: mockFetch(manifest),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('fires on successful uninstall', async () => {
    const manifest = goodManifest('cool-app');
    await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/cool-app/tytus-app.json',
      db,
      fetchImpl: mockFetch(manifest),
    });
    listener.mockClear();
    await uninstallApp({ appId: 'cool-app', db });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('fires on successful reinstall', async () => {
    const manifest = goodManifest('cool-app');
    await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/cool-app/tytus-app.json',
      db,
      fetchImpl: mockFetch(manifest),
    });
    listener.mockClear();
    const updated = { ...manifest, version: '2.0.0' };
    await reinstallApp({
      appId: 'cool-app',
      db,
      fetchImpl: mockFetch(updated),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('fires on successful featured manifest-url update', async () => {
    const manifest = goodManifest('cool-app');
    await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/cool-app/old.json',
      db,
      fetchImpl: mockFetch(manifest),
    });
    listener.mockClear();
    const updated = { ...manifest, version: '2.0.0' };
    await updateInstalledAppFromManifestUrl({
      appId: 'cool-app',
      manifestUrl: 'https://cdn.example.com/cool-app/new.json',
      db,
      fetchImpl: mockFetch(updated),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does NOT fire when install rejects (duplicate id)', async () => {
    const manifest = goodManifest('cool-app');
    await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/cool-app/tytus-app.json',
      db,
      fetchImpl: mockFetch(manifest),
    });
    listener.mockClear();

    await expect(
      installAppFromManifestUrl({
        manifestUrl: 'https://cdn.example.com/cool-app/tytus-app.json',
        db,
        fetchImpl: mockFetch(manifest),
      }),
    ).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
