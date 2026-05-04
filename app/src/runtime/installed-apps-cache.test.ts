/**
 * Tests for installed-apps-cache — the synchronous module-level
 * snapshot that registry.getAppById falls back to when an id isn't in
 * the build-time APP_REGISTRY. The cache is the missing piece that
 * lets useOSStore.createWindow open third-party apps installed at
 * runtime; without it the click throws "Unknown app: <id>" and the
 * window never mounts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __clearInstalledAppsCacheForTests,
  addToInstalledAppsCache,
  getInstalledAppRow,
  listCachedInstalledApps,
  removeFromInstalledAppsCache,
  setInstalledAppsCache,
} from './installed-apps-cache';
import type { InstalledAppRow } from './installed-apps-repo';
import type { Manifest } from '@tytus/host-api';

function row(id: string, kind: InstalledAppRow['kind'] = 'installed'): InstalledAppRow {
  const manifest: Manifest = {
    id,
    name: id,
    version: '1.0.0',
    icon: 'Box',
    category: 'Productivity',
    description: '',
    window: {
      defaultSize: { width: 800, height: 600 },
      minSize: { width: 400, height: 300 },
    },
    permissions: [],
    entry: { url: `https://cdn.example.com/${id}/dist/index.js` },
  };
  return {
    id,
    kind,
    manifest,
    entryUrl: manifest.entry?.url ?? null,
    assetsUrl: null,
    manifestUrl: `https://cdn.example.com/${id}/tytus-app.json`,
    installedAt: 0,
    enabled: true,
    builtinProtected: kind === 'bundled',
  };
}

beforeEach(() => __clearInstalledAppsCacheForTests());
afterEach(() => __clearInstalledAppsCacheForTests());

describe('installed-apps-cache', () => {
  it('starts empty', () => {
    expect(listCachedInstalledApps()).toEqual([]);
    expect(getInstalledAppRow('text-editor')).toBeUndefined();
  });

  it('addToInstalledAppsCache makes the row reachable via getInstalledAppRow', () => {
    const r = row('text-editor');
    addToInstalledAppsCache(r);
    expect(getInstalledAppRow('text-editor')).toEqual(r);
    expect(listCachedInstalledApps()).toEqual([r]);
  });

  it('addToInstalledAppsCache overwrites an existing entry (reinstall semantics)', () => {
    const v1 = row('text-editor');
    const v2 = { ...v1, manifest: { ...v1.manifest, version: '2.0.0' } };
    addToInstalledAppsCache(v1);
    addToInstalledAppsCache(v2);
    expect(getInstalledAppRow('text-editor')?.manifest.version).toBe('2.0.0');
    expect(listCachedInstalledApps()).toHaveLength(1);
  });

  it('removeFromInstalledAppsCache evicts the row', () => {
    const r = row('text-editor');
    addToInstalledAppsCache(r);
    expect(getInstalledAppRow('text-editor')).toBeDefined();
    removeFromInstalledAppsCache('text-editor');
    expect(getInstalledAppRow('text-editor')).toBeUndefined();
  });

  it('removeFromInstalledAppsCache is a no-op for unknown ids', () => {
    expect(() => removeFromInstalledAppsCache('never-existed')).not.toThrow();
  });

  it('setInstalledAppsCache replaces the snapshot wholesale', () => {
    addToInstalledAppsCache(row('old-app'));
    setInstalledAppsCache([row('memo', 'bundled'), row('text-editor')]);
    expect(getInstalledAppRow('old-app')).toBeUndefined();
    expect(getInstalledAppRow('memo')?.kind).toBe('bundled');
    expect(getInstalledAppRow('text-editor')?.kind).toBe('installed');
    expect(listCachedInstalledApps()).toHaveLength(2);
  });
});
