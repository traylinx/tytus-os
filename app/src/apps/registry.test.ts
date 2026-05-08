import { describe, expect, it } from 'vitest';
import {
  APP_REGISTRY,
  getAppById,
  getAppsByKind,
  normalizeApp,
  resolveAlias,
} from './registry';
import type { AppDefinition } from '@/types';

describe('registry — kind normalization', () => {
  it('treats undefined kind as "legacy"', () => {
    const app: AppDefinition = APP_REGISTRY[0];
    expect(normalizeApp(app).kind).toBe('legacy');
  });

  it('respects explicit kind when provided', () => {
    const app: AppDefinition = {
      ...APP_REGISTRY[0],
      kind: 'bundled',
    };
    expect(normalizeApp(app).kind).toBe('bundled');
  });

  it('every existing entry normalizes to legacy by default', () => {
    for (const app of APP_REGISTRY) {
      const normalized = normalizeApp(app);
      // Default branch — none of the existing 54 declare kind today.
      if (app.kind === undefined) {
        expect(normalized.kind).toBe('legacy');
      }
    }
  });
});

describe('registry — getAppsByKind', () => {
  it('returns every app whose normalized kind matches', () => {
    const legacyApps = getAppsByKind('legacy');
    // Every existing entry should be reachable via getAppsByKind('legacy').
    expect(legacyApps.length).toBeGreaterThan(0);
    expect(legacyApps.length).toBeLessThanOrEqual(APP_REGISTRY.length);
  });

  it('returns empty for kinds with no entries today', () => {
    expect(getAppsByKind('alias')).toEqual([]);
  });

  it('keeps bundled installed apps reachable by kind', () => {
    const installedApps = getAppsByKind('installed');
    expect(installedApps.map((app) => app.id)).toContain('atomek');
  });
});

describe('registry — alias resolution (structured rewriteArgs)', () => {
  // Aliases are not in the static APP_REGISTRY today — they're added at
  // install time when a retired app id needs to redirect. We exercise
  // resolveAlias's logic by mutating a fixture entry locally for the test.
  const baseAliasFixture: AppDefinition = {
    id: '__test_alias__',
    name: 'Test Alias',
    icon: 'Box',
    category: 'System',
    description: 'Test fixture for alias resolution',
    defaultSize: { width: 100, height: 100 },
    minSize: { width: 100, height: 100 },
    kind: 'alias',
    aliasOf: 'settings',
    rewriteArgs: { type: 'identity' },
    removeInVersion: '0.18.0',
    hidden: true,
  };

  function withFixture<T>(fixture: AppDefinition, body: () => T): T {
    APP_REGISTRY.push(fixture);
    try {
      return body();
    } finally {
      const idx = APP_REGISTRY.indexOf(fixture);
      if (idx >= 0) APP_REGISTRY.splice(idx, 1);
    }
  }

  it('returns null for non-alias ids', () => {
    expect(resolveAlias('settings', {})).toBeNull();
  });

  it('identity descriptor passes args through unchanged', () => {
    withFixture(baseAliasFixture, () => {
      const r = resolveAlias('__test_alias__', { foo: 'bar' });
      expect(r?.resolvedAppId).toBe('settings');
      expect(r?.rewrittenArgs).toEqual({ foo: 'bar' });
    });
  });

  it('studio descriptor sets mode + carries fileRef from legacy args', () => {
    const fx: AppDefinition = {
      ...baseAliasFixture,
      id: '__alias_studio__',
      aliasOf: 'studio',
      rewriteArgs: { type: 'studio', mode: 'markdown', readOnly: false },
    };
    withFixture(fx, () => {
      const r = resolveAlias('__alias_studio__', {
        fileRef: { fileNodeId: 'abc' },
      });
      expect(r?.resolvedAppId).toBe('studio');
      expect(r?.rewrittenArgs).toEqual({
        mode: 'markdown',
        readOnly: false,
        fileRef: { fileNodeId: 'abc' },
      });
    });
  });

  it('static descriptor uses args verbatim, ignoring legacy input', () => {
    const fx: AppDefinition = {
      ...baseAliasFixture,
      id: '__alias_static__',
      aliasOf: 'settings',
      rewriteArgs: { type: 'static', args: { section: 'general' } },
    };
    withFixture(fx, () => {
      const r = resolveAlias('__alias_static__', { ignored: true });
      expect(r?.rewrittenArgs).toEqual({ section: 'general' });
    });
  });

  it('memo descriptor carries focusLine + fileRef when present', () => {
    const fx: AppDefinition = {
      ...baseAliasFixture,
      id: '__alias_memo__',
      aliasOf: 'memo',
      rewriteArgs: { type: 'memo', readOnly: true },
    };
    withFixture(fx, () => {
      const r = resolveAlias('__alias_memo__', {
        fileRef: { fileNodeId: 'm1' },
        focusLine: 7,
      });
      expect(r?.rewrittenArgs).toEqual({
        readOnly: true,
        fileRef: { fileNodeId: 'm1' },
        focusLine: 7,
      });
    });
  });

  it('absent rewriteArgs treats as identity', () => {
    const fx: AppDefinition = {
      ...baseAliasFixture,
      id: '__alias_no_descriptor__',
      rewriteArgs: undefined,
    };
    withFixture(fx, () => {
      const r = resolveAlias('__alias_no_descriptor__', { x: 1 });
      expect(r?.rewrittenArgs).toEqual({ x: 1 });
    });
  });

  it('getAppById follows alias indirection once', () => {
    const fx: AppDefinition = {
      ...baseAliasFixture,
      id: '__test_alias_byid__',
    };
    withFixture(fx, () => {
      expect(getAppById('__test_alias_byid__')?.id).toBe('settings');
    });
  });
});

describe('registry — installed-apps cache fallback', () => {
  // Lazy-import the cache helpers so the rest of the file's existing
  // import pattern stays clean.
  const cache = () =>
    import('@/runtime/installed-apps-cache') as Promise<
      typeof import('@/runtime/installed-apps-cache')
    >;

  it('returns an AppDefinition built from the installed_apps cache when an id is missing from APP_REGISTRY', async () => {
    const { addToInstalledAppsCache, __clearInstalledAppsCacheForTests } = await cache();
    __clearInstalledAppsCacheForTests();
    addToInstalledAppsCache({
      id: 'todoist',
      kind: 'installed',
      manifest: {
        id: 'todoist',
        name: 'Todoist',
        version: '1.0.0',
        icon: 'CheckSquare',
        category: 'Productivity',
        description: 'Task manager',
        window: {
          defaultSize: { width: 800, height: 600 },
          minSize: { width: 400, height: 300 },
        },
        permissions: [],
        entry: { url: 'https://cdn.example.com/todoist/dist/index.js' },
      },
      entryUrl: 'https://cdn.example.com/todoist/dist/index.js',
      assetsUrl: null,
      manifestUrl: 'https://cdn.example.com/todoist/tytus-app.json',
      installedAt: 0,
      enabled: true,
      builtinProtected: false,
    });

    const def = getAppById('todoist');
    expect(def).toBeDefined();
    expect(def?.id).toBe('todoist');
    expect(def?.name).toBe('Todoist');
    expect(def?.icon).toBe('CheckSquare');
    expect(def?.category).toBe('Productivity');
    expect(def?.defaultSize).toEqual({ width: 800, height: 600 });
    expect(def?.minSize).toEqual({ width: 400, height: 300 });
    expect(def?.kind).toBe('installed');

    __clearInstalledAppsCacheForTests();
  });

  it('static APP_REGISTRY entries take precedence over the cache', async () => {
    const { addToInstalledAppsCache, __clearInstalledAppsCacheForTests } = await cache();
    __clearInstalledAppsCacheForTests();
    // Try to shadow `settings` (a real APP_REGISTRY entry) with a cache row.
    addToInstalledAppsCache({
      id: 'settings',
      kind: 'installed',
      manifest: {
        id: 'settings',
        name: 'Hijack Settings',
        version: '99.0.0',
        icon: 'Skull',
        category: 'System',
        description: 'should never reach the launcher',
        window: {
          defaultSize: { width: 100, height: 100 },
          minSize: { width: 100, height: 100 },
        },
        permissions: [],
        entry: { url: 'https://example.com/x.js' },
      },
      entryUrl: 'https://example.com/x.js',
      assetsUrl: null,
      manifestUrl: null,
      installedAt: 0,
      enabled: true,
      builtinProtected: false,
    });

    const def = getAppById('settings');
    expect(def?.name).not.toBe('Hijack Settings');

    __clearInstalledAppsCacheForTests();
  });

  it('returns undefined when an id is in neither the registry nor the cache', async () => {
    const { __clearInstalledAppsCacheForTests } = await cache();
    __clearInstalledAppsCacheForTests();
    expect(getAppById('definitely-does-not-exist')).toBeUndefined();
  });
});
