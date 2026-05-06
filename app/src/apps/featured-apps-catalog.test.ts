/**
 * Tests for loadFeaturedApps — the remote-fetched Featured catalog with
 * fallback to the hardcoded baseline (Phase 10).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  FEATURED_APPS,
  FEATURED_CATALOG_URL,
  loadFeaturedApps,
} from './featured-apps-catalog';

const VALID_REMOTE = {
  version: 1,
  updatedAt: '2026-05-04T00:00:00Z',
  apps: [
    {
      id: 'cool-app',
      name: 'Cool App',
      description: 'Does cool things',
      icon: 'Sparkles',
      category: 'Creative',
      manifestUrl: 'https://cdn.jsdelivr.net/gh/example/cool-app@v0.1.0/tytus-app.json',
    },
    {
      id: 'second-app',
      name: 'Second App',
      description: 'Also cool',
      icon: 'Box',
      category: 'Productivity',
      manifestUrl: 'https://cdn.jsdelivr.net/gh/example/second-app@v0.1.0/tytus-app.json',
    },
  ],
};

const mockFetch = (impl: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>) =>
  vi.fn(impl);

describe('loadFeaturedApps', () => {
  it('returns parsed remote catalog on a successful fetch', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: true,
      json: async () => VALID_REMOTE,
    }));
    const list = await loadFeaturedApps({ fetchImpl });
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('cool-app');
    expect(list[1].id).toBe('second-app');
  });

  it('falls back to FEATURED_APPS on non-2xx response', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: false,
      json: async () => ({}),
    }));
    const list = await loadFeaturedApps({ fetchImpl });
    expect(list).toBe(FEATURED_APPS);
  });

  it('falls back to FEATURED_APPS when fetch throws (offline)', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error('network down');
    });
    const list = await loadFeaturedApps({ fetchImpl });
    expect(list).toBe(FEATURED_APPS);
  });

  it('falls back when JSON is malformed', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: true,
      json: async () => {
        throw new Error('invalid json');
      },
    }));
    const list = await loadFeaturedApps({ fetchImpl });
    expect(list).toBe(FEATURED_APPS);
  });

  it('falls back when remote payload has no apps array', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: true,
      json: async () => ({ version: 1, apps: 'not-an-array' }),
    }));
    const list = await loadFeaturedApps({ fetchImpl });
    expect(list).toBe(FEATURED_APPS);
  });

  it('falls back when parsed catalog is empty', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: true,
      json: async () => ({ version: 1, apps: [] }),
    }));
    const list = await loadFeaturedApps({ fetchImpl });
    expect(list).toBe(FEATURED_APPS);
  });

  it('skips entries with non-https manifestUrl', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        version: 1,
        apps: [
          { ...VALID_REMOTE.apps[0], manifestUrl: 'http://insecure.example.com/x.json' },
          VALID_REMOTE.apps[1],
        ],
      }),
    }));
    const list = await loadFeaturedApps({ fetchImpl });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('second-app');
  });

  it('skips entries missing required fields', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        version: 1,
        apps: [
          { id: 'no-name' },
          { name: 'No Id', icon: 'X' },
          VALID_REMOTE.apps[0],
        ],
      }),
    }));
    const list = await loadFeaturedApps({ fetchImpl });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('cool-app');
  });

  it('uses FEATURED_CATALOG_URL by default', async () => {
    const fetchImpl = mockFetch(async (url) => {
      expect(url).toBe(FEATURED_CATALOG_URL);
      return { ok: true, json: async () => VALID_REMOTE };
    });
    await loadFeaturedApps({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(FEATURED_CATALOG_URL);
  });

  it('honors a custom url override', async () => {
    const customUrl = 'https://example.com/catalog.json';
    const fetchImpl = mockFetch(async (url) => {
      expect(url).toBe(customUrl);
      return { ok: true, json: async () => VALID_REMOTE };
    });
    await loadFeaturedApps({ url: customUrl, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(customUrl);
  });
});

describe('FEATURED_APPS hardcoded baseline', () => {
  it('has every required field on every entry', () => {
    for (const app of FEATURED_APPS) {
      expect(app.id).toBeTruthy();
      expect(app.name).toBeTruthy();
      expect(app.description).toBeTruthy();
      expect(app.icon).toBeTruthy();
      expect(app.category).toBeTruthy();
      expect(app.manifestUrl.startsWith('https://')).toBe(true);
    }
  });

  it('includes restored Text Editor and Markdown Editor while omitting Code Editor', () => {
    const ids = FEATURED_APPS.map((a) => a.id).sort();
    expect(ids).toEqual([
      'api-tester',
      'forge',
      'juli3ta',
      'markdown-preview',
      'openhouse',
      'photo-editor',
      'text-editor',
    ]);
    expect(FEATURED_APPS.find((a) => a.id === 'markdown-preview')?.name).toBe('Markdown Editor');
    expect(FEATURED_APPS.find((a) => a.id === 'openhouse')?.manifestUrl).toBe('https://cdn.jsdelivr.net/gh/traylinx/tytus-app-openhouse@v1.1.2/tytus-app.json');
    expect(ids).not.toContain('code-editor');
  });
});
