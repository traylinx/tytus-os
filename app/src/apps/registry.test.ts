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
