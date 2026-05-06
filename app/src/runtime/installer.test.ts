/**
 * Tests for installer.ts — Phase 2 of SPRINT-TYTUS-APP-SYSTEM-V1.
 *
 * Mirrors the MemoryDb pattern used in seed-bundled-apps.test.ts /
 * installed-apps-repo.test.ts so the install pipeline is exercised
 * without spinning a real SQLite worker.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InstallerError,
  installAppFromManifestUrl,
  reinstallApp,
  updateInstalledAppFromManifestUrl,
  uninstallApp,
} from './installer';
import { listInstalledApps } from './installed-apps-repo';
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
      if (this.rows.some((r) => r.id === id)) {
        // Mimic SQLite PRIMARY KEY violation. The installer's
        // duplicate check should fire BEFORE we reach this branch in
        // tests, but we throw here so a missing check would surface.
        throw new Error(
          `UNIQUE constraint failed: installed_apps.id (${String(id)})`,
        );
      }
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

const goodManifest = (
  id: string,
  overrides: Partial<Manifest> = {},
): Manifest => ({
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
  ...overrides,
});

interface MockResponse {
  ok?: boolean;
  status?: number;
  body?: unknown;
  /** When set, the json() call rejects (simulates a non-JSON body). */
  jsonError?: Error;
  /** When set, fetch() itself rejects (simulates DNS / offline). */
  fetchError?: Error;
}

function mockFetch(responses: Record<string, MockResponse>) {
  return vi.fn(async (url: string) => {
    const r = responses[url];
    if (!r) throw new Error(`unexpected fetch URL in test: ${url}`);
    if (r.fetchError) throw r.fetchError;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => {
        if (r.jsonError) throw r.jsonError;
        return r.body;
      },
    };
  });
}

let db: MemoryDb;
beforeEach(() => {
  db = new MemoryDb();
});

describe('installAppFromManifestUrl', () => {
  it('inserts a kind=installed row when given a valid manifest URL', async () => {
    const manifest = goodManifest('cool-app');
    const fetchImpl = mockFetch({
      'https://cdn.example.com/cool-app/tytus-app.json': { body: manifest },
    });
    const row = await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/cool-app/tytus-app.json',
      db,
      now: () => 1700000000000,
      fetchImpl,
    });

    expect(row.id).toBe('cool-app');
    expect(row.kind).toBe('installed');
    expect(row.builtinProtected).toBe(false);
    expect(row.entryUrl).toBe('https://cdn.example.com/cool-app/dist/index.js');
    expect(row.manifestUrl).toBe(
      'https://cdn.example.com/cool-app/tytus-app.json',
    );
    expect(row.installedAt).toBe(1700000000000);

    // Round-trip through listInstalledApps to verify the row was actually
    // persisted (and the JSON parses back into a manifest).
    const all = await listInstalledApps(db);
    expect(all).toHaveLength(1);
    expect(all[0].manifest.name).toBe('cool-app');
  });

  it('throws InstallerError(invalid_manifest) when the JSON fails validation', async () => {
    const fetchImpl = mockFetch({
      'https://cdn.example.com/bad/tytus-app.json': {
        body: { id: 'BAD ID WITH SPACES', name: 'broken' },
      },
    });
    const err = await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/bad/tytus-app.json',
      db,
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('invalid_manifest');
    expect(Array.isArray(err.details)).toBe(true);
  });

  it('throws InstallerError(bad_transport) when manifest uses entry.module instead of entry.url', async () => {
    const manifest = goodManifest('module-app', {
      entry: { module: './index.js' },
    });
    const fetchImpl = mockFetch({
      'https://cdn.example.com/module/tytus-app.json': { body: manifest },
    });
    const err = await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/module/tytus-app.json',
      db,
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('bad_transport');
  });

  it('throws InstallerError(duplicate) when the id is already installed', async () => {
    const manifest = goodManifest('dup-app');
    const url = 'https://cdn.example.com/dup/tytus-app.json';
    const fetchImpl = mockFetch({ [url]: { body: manifest } });

    await installAppFromManifestUrl({ manifestUrl: url, db, fetchImpl });
    const err = await installAppFromManifestUrl({
      manifestUrl: url,
      db,
      fetchImpl,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('duplicate');
    expect((err.details as { existingId: string }).existingId).toBe('dup-app');
  });

  it('throws InstallerError(fetch_failed) on non-2xx responses', async () => {
    const fetchImpl = mockFetch({
      'https://cdn.example.com/missing/tytus-app.json': {
        ok: false,
        status: 404,
      },
    });
    const err = await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/missing/tytus-app.json',
      db,
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('fetch_failed');
    expect((err.details as { status: number }).status).toBe(404);
  });

  it('throws InstallerError(parse_failed) when the body is not JSON', async () => {
    const fetchImpl = mockFetch({
      'https://cdn.example.com/garbage/tytus-app.json': {
        jsonError: new SyntaxError('Unexpected token < in JSON at position 0'),
      },
    });
    const err = await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/garbage/tytus-app.json',
      db,
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('parse_failed');
  });
});

describe('uninstallApp', () => {
  it('removes the row when the app is a non-protected install', async () => {
    const manifest = goodManifest('rm-me');
    const fetchImpl = mockFetch({
      'https://cdn.example.com/rm-me/tytus-app.json': { body: manifest },
    });
    await installAppFromManifestUrl({
      manifestUrl: 'https://cdn.example.com/rm-me/tytus-app.json',
      db,
      fetchImpl,
    });
    expect((await listInstalledApps(db)).length).toBe(1);

    await uninstallApp({ appId: 'rm-me', db });

    expect(await listInstalledApps(db)).toHaveLength(0);
  });

  it('throws InstallerError(not_found) when the id is not installed', async () => {
    const err = await uninstallApp({ appId: 'ghost', db }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('not_found');
  });

  it('throws InstallerError(protected) when the app is builtin_protected=true', async () => {
    // Hand-seed a protected row so we don't depend on the real seed.
    db.rows.push({
      id: 'sheet',
      kind: 'bundled',
      manifest_json: JSON.stringify(goodManifest('sheet')),
      entry_url: null,
      assets_url: null,
      manifest_url: null,
      installed_at: 0,
      enabled: 1,
      builtin_protected: 1,
    });
    const err = await uninstallApp({ appId: 'sheet', db }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('protected');
    // Row must NOT have been deleted.
    expect((await listInstalledApps(db)).length).toBe(1);
  });
});

describe('reinstallApp', () => {
  it('updates the row in place, preserving installed_at', async () => {
    const v1 = goodManifest('refresh', { version: '1.0.0' });
    const v2 = goodManifest('refresh', { version: '1.1.0' });
    const url = 'https://cdn.example.com/refresh/tytus-app.json';
    const fetchImpl = mockFetch({ [url]: { body: v1 } });

    await installAppFromManifestUrl({
      manifestUrl: url,
      db,
      now: () => 1000,
      fetchImpl,
    });

    // Swap the response to v2 and reinstall.
    fetchImpl.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => v2,
    }));

    const updated = await reinstallApp({
      appId: 'refresh',
      db,
      fetchImpl,
    });

    expect(updated.manifest.version).toBe('1.1.0');
    expect(updated.installedAt).toBe(1000);

    const all = await listInstalledApps(db);
    expect(all).toHaveLength(1);
    expect(all[0].manifest.version).toBe('1.1.0');
  });

  it('throws InstallerError(not_found) when the id is not installed', async () => {
    const err = await reinstallApp({
      appId: 'ghost',
      db,
      fetchImpl: mockFetch({}),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('not_found');
  });

  it('throws InstallerError(invalid_manifest) when the refetched manifest renames the id', async () => {
    const original = goodManifest('keep-id');
    const url = 'https://cdn.example.com/keep-id/tytus-app.json';
    const fetchImpl = mockFetch({ [url]: { body: original } });

    await installAppFromManifestUrl({
      manifestUrl: url,
      db,
      fetchImpl,
    });

    // Refetch returns the SAME url but a manifest with a different id.
    const renamed = goodManifest('renamed-id');
    fetchImpl.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => renamed,
    }));
    const err = await reinstallApp({
      appId: 'keep-id',
      db,
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('invalid_manifest');
  });

  it("rejects with code='cannot_reinstall' when the row has no manifestUrl on file", async () => {
    // Simulate a kind='bundled' row (e.g. a system app seeded at boot)
    // — those have null manifest_url and Reinstall must refuse rather
    // than mis-firing as 'not_found'.
    db.rows.push({
      id: 'memo',
      kind: 'bundled',
      manifest_json: JSON.stringify(goodManifest('memo')),
      entry_url: '@tytus/app-memo',
      assets_url: null,
      manifest_url: null,
      installed_at: 0,
      enabled: 1,
      builtin_protected: 1,
    });
    const err = await reinstallApp({
      appId: 'memo',
      db,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('cannot_reinstall');
    expect((err.details as { id: string }).id).toBe('memo');
  });
});

describe('updateInstalledAppFromManifestUrl', () => {
  it('updates an existing row from a caller-provided manifest URL, preserving installed_at', async () => {
    const v1 = goodManifest('openhouse', { version: '1.0.0' });
    const v2 = goodManifest('openhouse', {
      version: '1.1.4',
      entry: { url: 'https://cdn.example.com/openhouse/v114/index.js' },
    });
    const oldUrl = 'https://cdn.example.com/openhouse/old/tytus-app.json';
    const newUrl = 'https://cdn.example.com/openhouse/new/tytus-app.json';
    const fetchImpl = mockFetch({
      [oldUrl]: { body: v1 },
      [newUrl]: { body: v2 },
    });

    await installAppFromManifestUrl({
      manifestUrl: oldUrl,
      db,
      now: () => 1000,
      fetchImpl,
    });

    const updated = await updateInstalledAppFromManifestUrl({
      appId: 'openhouse',
      manifestUrl: newUrl,
      db,
      fetchImpl,
    });

    expect(updated.manifest.version).toBe('1.1.4');
    expect(updated.entryUrl).toBe(
      'https://cdn.example.com/openhouse/v114/index.js',
    );
    expect(updated.manifestUrl).toBe(newUrl);
    expect(updated.installedAt).toBe(1000);

    const all = await listInstalledApps(db);
    expect(all).toHaveLength(1);
    expect(all[0].manifest.version).toBe('1.1.4');
    expect(all[0].manifestUrl).toBe(newUrl);
    expect(all[0].installedAt).toBe(1000);
  });

  it('throws InstallerError(not_found) when the row is missing', async () => {
    const err = await updateInstalledAppFromManifestUrl({
      appId: 'ghost',
      manifestUrl: 'https://cdn.example.com/ghost/tytus-app.json',
      db,
      fetchImpl: mockFetch({}),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('not_found');
  });

  it('throws InstallerError(invalid_manifest) when the new manifest renames the id', async () => {
    const original = goodManifest('keep-id');
    const oldUrl = 'https://cdn.example.com/keep-id/old.json';
    const newUrl = 'https://cdn.example.com/keep-id/new.json';
    const fetchImpl = mockFetch({
      [oldUrl]: { body: original },
      [newUrl]: { body: goodManifest('renamed-id') },
    });

    await installAppFromManifestUrl({ manifestUrl: oldUrl, db, fetchImpl });
    const err = await updateInstalledAppFromManifestUrl({
      appId: 'keep-id',
      manifestUrl: newUrl,
      db,
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallerError);
    expect(err.code).toBe('invalid_manifest');
  });
});

describe('InstallerError', () => {
  it('exposes a code field that distinguishes failure modes', () => {
    const e = new InstallerError('duplicate', { existingId: 'foo' });
    expect(e.code).toBe('duplicate');
    expect(e.details).toEqual({ existingId: 'foo' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('InstallerError');
  });
});
