/**
 * Tests for `autoInstallFeaturedAtBoot` — the boot-time pipeline that
 * installs every Featured catalog entry that isn't already present.
 *
 * The injected fakes mirror the real shapes:
 *   - `loadCatalog` returns FeaturedApp[]
 *   - `install` is the per-app installer; the test fake records
 *     manifestUrls and pushes a stub row into the in-memory DB so
 *     subsequent `listInstalledApps` calls observe the new state.
 */

import { describe, expect, it, vi } from 'vitest';

import { autoInstallFeaturedAtBoot } from './auto-install-featured';
import { InstallerError } from './installer';
import type { FeaturedApp } from '@/apps/featured-apps-catalog';
import type { Db, SqlValue } from '@/lib/db/types';

const FAKE_CATALOG: FeaturedApp[] = [
  {
    id: 'mock-music',
    name: 'Mock Music',
    description: 'Music creator.',
    icon: 'Music',
    category: 'Creative',
    manifestUrl: 'https://cdn.example.com/mock-music/tytus-app.json',
  },
  {
    id: 'text-editor',
    name: 'Text Editor',
    description: 'Editor.',
    icon: 'FileText',
    category: 'Productivity',
    manifestUrl: 'https://cdn.example.com/text-editor/tytus-app.json',
  },
  {
    id: 'photo-editor',
    name: 'Photo Editor',
    description: 'Photos.',
    icon: 'Image',
    category: 'Media',
    manifestUrl: 'https://cdn.example.com/photo-editor/tytus-app.json',
  },
];

class MemoryDb implements Db {
  rows: Array<Record<string, SqlValue>> = [];

  async exec(): Promise<void> {}

  async query<T>(sql: string): Promise<T[]> {
    if (/SELECT.*FROM\s+installed_apps/i.test(sql)) {
      return this.rows.map((r) => ({
        ...r,
        manifest_json: r.manifest_json ?? '{}',
      })) as unknown as T[];
    }
    return [] as T[];
  }

  async run(): Promise<void> {}

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  /** Test helper. */
  __seedRow(id: string, manifestUrl?: string): void {
    this.rows.push({
      id,
      kind: 'installed',
      manifest_json: JSON.stringify({ id }),
      entry_url: 'https://cdn.example.com/x.js',
      assets_url: null,
      manifest_url:
        manifestUrl ?? `https://cdn.example.com/${id}/tytus-app.json`,
      installed_at: 0,
      enabled: 1,
      builtin_protected: 0,
    });
  }
}

describe('autoInstallFeaturedAtBoot', () => {
  it('installs every Featured app that is missing from installed_apps', async () => {
    const db = new MemoryDb();
    const install = vi.fn(async ({ manifestUrl }: { manifestUrl: string }) => {
      const id = manifestUrl.split('/')[3]; // /mock-music/...
      db.__seedRow(id);
    });
    const report = await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => FAKE_CATALOG,
      install,
      logger: { info: () => undefined, warn: () => undefined },
    });

    expect(report.attempted).toBe(3);
    expect(report.installed.sort()).toEqual([
      'mock-music',
      'photo-editor',
      'text-editor',
    ]);
    expect(report.updated).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(install).toHaveBeenCalledTimes(3);
  });

  it('skips apps that are already installed', async () => {
    const db = new MemoryDb();
    db.__seedRow(
      'mock-music',
      'https://cdn.example.com/mock-music/tytus-app.json',
    );
    db.__seedRow(
      'text-editor',
      'https://cdn.example.com/text-editor/tytus-app.json',
    );

    const install = vi.fn(async ({ manifestUrl }: { manifestUrl: string }) => {
      const id = manifestUrl.split('/')[3];
      db.__seedRow(id);
    });

    const report = await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => FAKE_CATALOG,
      install,
      logger: { info: () => undefined, warn: () => undefined },
    });

    expect(report.attempted).toBe(1);
    expect(report.installed).toEqual(['photo-editor']);
    expect(report.updated).toEqual([]);
    expect(report.skipped.sort()).toEqual(['mock-music', 'text-editor']);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — second run installs nothing when first was successful', async () => {
    const db = new MemoryDb();
    const install = vi.fn(async ({ manifestUrl }: { manifestUrl: string }) => {
      const id = manifestUrl.split('/')[3];
      db.__seedRow(id);
    });

    const first = await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => FAKE_CATALOG,
      install,
      logger: { info: () => undefined, warn: () => undefined },
    });
    expect(first.installed).toHaveLength(3);

    install.mockClear();

    const second = await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => FAKE_CATALOG,
      install,
      logger: { info: () => undefined, warn: () => undefined },
    });
    expect(second.attempted).toBe(0);
    expect(second.installed).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.skipped.sort()).toEqual(FAKE_CATALOG.map((f) => f.id).sort());
    expect(install).not.toHaveBeenCalled();
  });

  it('updates existing Featured apps when their stored manifest URL is stale', async () => {
    const db = new MemoryDb();
    db.__seedRow('mock-music', 'https://cdn.example.com/mock-music/old.json');

    const install = vi.fn();
    const update = vi.fn(
      async ({
        appId,
        manifestUrl,
      }: {
        appId: string;
        manifestUrl: string;
      }) => {
        const row = db.rows.find((r) => r.id === appId);
        if (!row) throw new Error(`missing seeded row ${appId}`);
        row.manifest_url = manifestUrl;
        row.manifest_json = JSON.stringify({ id: appId, version: '2.0.0' });
      },
    );

    const report = await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => [FAKE_CATALOG[0]],
      install,
      update,
      logger: { info: () => undefined, warn: () => undefined },
    });

    expect(report.attempted).toBe(1);
    expect(report.installed).toEqual([]);
    expect(report.updated).toEqual(['mock-music']);
    expect(report.failed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(install).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'mock-music',
        manifestUrl: 'https://cdn.example.com/mock-music/tytus-app.json',
      }),
    );
  });

  it('records per-app failures without short-circuiting the rest', async () => {
    const db = new MemoryDb();
    const install = vi.fn(async ({ manifestUrl }: { manifestUrl: string }) => {
      const id = manifestUrl.split('/')[3];
      if (id === 'text-editor') {
        throw new InstallerError('fetch_failed', { url: manifestUrl });
      }
      db.__seedRow(id);
    });

    const report = await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => FAKE_CATALOG,
      install,
      logger: { info: () => undefined, warn: () => undefined },
    });

    expect(report.installed.sort()).toEqual(['mock-music', 'photo-editor']);
    expect(report.updated).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].id).toBe('text-editor');
    expect(report.failed[0].reason).toMatch(/fetch_failed/);
  });

  it('auto-installs verified standalone JULI3TA now that the real lift shipped', async () => {
    const db = new MemoryDb();
    const catalog = [
      {
        id: 'juli3ta',
        name: 'JULI3TA',
        description: 'verified standalone',
        icon: 'juli3ta:mark',
        category: 'Creative',
        manifestUrl: 'https://cdn.example.com/juli3ta-0.2.1/tytus-app.json',
      },
      {
        id: 'text-editor',
        name: 'Text Editor',
        description: 'editor',
        icon: 'FileText',
        category: 'Productivity',
        manifestUrl: 'https://cdn.example.com/text-editor/tytus-app.json',
      },
    ];
    const install = vi.fn(async ({ manifestUrl }: { manifestUrl: string }) => {
      const id = manifestUrl.split('/')[3];
      db.__seedRow(id);
    });
    const report = await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => catalog,
      install,
      logger: { info: () => undefined, warn: () => undefined },
    });
    expect(report.installed.sort()).toEqual(['juli3ta', 'text-editor']);
    expect(report.updated).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(install).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestUrl: 'https://cdn.example.com/juli3ta-0.2.1/tytus-app.json',
      }),
    );
  });

  it('returns an empty report when the catalog fails to load', async () => {
    const db = new MemoryDb();
    const report = await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => {
        throw new Error('catalog offline');
      },
      install: vi.fn(),
      logger: { info: () => undefined, warn: () => undefined },
    });
    expect(report).toEqual({
      attempted: 0,
      installed: [],
      updated: [],
      failed: [],
      skipped: [],
    });
  });

  it('respects the concurrency cap (no more than N installs in flight)', async () => {
    const db = new MemoryDb();
    let active = 0;
    let peak = 0;
    const install = vi.fn(async ({ manifestUrl }: { manifestUrl: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      // Yield to the microtask queue so concurrency can saturate.
      await new Promise((r) => setTimeout(r, 5));
      const id = manifestUrl.split('/')[3];
      db.__seedRow(id);
      active -= 1;
    });

    await autoInstallFeaturedAtBoot(db, {
      loadCatalog: async () => FAKE_CATALOG,
      install,
      concurrency: 2,
      logger: { info: () => undefined, warn: () => undefined },
    });

    expect(peak).toBeLessThanOrEqual(2);
  });
});
