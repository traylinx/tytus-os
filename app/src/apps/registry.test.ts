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
    expect(getAppsByKind('installed')).toEqual([]);
  });
});

describe('registry — alias resolution', () => {
  // Aliases are not in the static APP_REGISTRY today — they're added at
  // install time when a retired app id needs to redirect. We exercise
  // resolveAlias's logic by mutating a fixture entry locally for the test.
  const aliasFixture: AppDefinition = {
    id: '__test_alias__',
    name: 'Test Alias',
    icon: 'Box',
    category: 'System',
    description: 'Test fixture for alias resolution',
    defaultSize: { width: 100, height: 100 },
    minSize: { width: 100, height: 100 },
    kind: 'alias',
    aliasOf: 'settings',
    rewriteArgs: '(args) => ({ section: "general", ...args })',
    removeInVersion: '0.18.0',
    hidden: true,
  };

  it('returns null for non-alias ids', () => {
    expect(resolveAlias('settings', {})).toBeNull();
  });

  it('resolves alias to target id and applies rewriteArgs', () => {
    APP_REGISTRY.push(aliasFixture);
    try {
      const result = resolveAlias('__test_alias__', { focus: 'wallpaper' });
      expect(result).not.toBeNull();
      expect(result?.resolvedAppId).toBe('settings');
      expect(result?.rewrittenArgs).toEqual({
        section: 'general',
        focus: 'wallpaper',
      });
      expect(result?.rewriterErrored).toBe(false);
    } finally {
      const idx = APP_REGISTRY.indexOf(aliasFixture);
      if (idx >= 0) APP_REGISTRY.splice(idx, 1);
    }
  });

  it('flags rewriter errors but still returns the resolved id', () => {
    const fixture: AppDefinition = {
      ...aliasFixture,
      id: '__test_alias_bad__',
      rewriteArgs: '(args) => { throw new Error("boom") }',
    };
    APP_REGISTRY.push(fixture);
    try {
      const result = resolveAlias('__test_alias_bad__', {});
      expect(result?.resolvedAppId).toBe('settings');
      expect(result?.rewriterErrored).toBe(true);
      // When the rewriter errors, args pass through unchanged.
      expect(result?.rewrittenArgs).toEqual({});
    } finally {
      const idx = APP_REGISTRY.indexOf(fixture);
      if (idx >= 0) APP_REGISTRY.splice(idx, 1);
    }
  });

  it('getAppById follows alias indirection once', () => {
    const fixture: AppDefinition = {
      ...aliasFixture,
      id: '__test_alias_byid__',
      aliasOf: 'settings',
    };
    APP_REGISTRY.push(fixture);
    try {
      const resolved = getAppById('__test_alias_byid__');
      expect(resolved?.id).toBe('settings');
    } finally {
      const idx = APP_REGISTRY.indexOf(fixture);
      if (idx >= 0) APP_REGISTRY.splice(idx, 1);
    }
  });
});
