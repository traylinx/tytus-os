/**
 * Tests for resolveCanonicalAppId — the helper that maps legacy
 * launcher ids (`markdownpreview`, `texteditor`, …) onto their
 * canonical workspace-package ids (`markdown-preview`,
 * `text-editor`, …).
 */

import { describe, expect, it } from 'vitest';

import {
  LEGACY_APP_ID_ALIASES,
  resolveCanonicalAppId,
  unifyAppDefinition,
} from './legacy-app-aliases';
import {
  __clearInstalledAppsCacheForTests,
  addToInstalledAppsCache,
} from '@/runtime/installed-apps-cache';
import type { AppDefinition } from '@/types';
import type { Manifest } from '@tytus/host-api';
import { afterEach, beforeEach } from 'vitest';

describe('resolveCanonicalAppId', () => {
  it('returns the canonical id for every alias', () => {
    expect(resolveCanonicalAppId('notes')).toBe('memo');
    expect(resolveCanonicalAppId('spreadsheet')).toBe('sheet');
    expect(resolveCanonicalAppId('musicplayer')).toBe('music-player');
    expect(resolveCanonicalAppId('voicerecorder')).toBe('voice-recorder');
    expect(resolveCanonicalAppId('markdownpreview')).toBe('markdown-preview');
    expect(resolveCanonicalAppId('photoeditor')).toBe('photo-editor');
    expect(resolveCanonicalAppId('texteditor')).toBe('text-editor');
    expect(resolveCanonicalAppId('codeeditor')).toBe('code-editor');
    expect(resolveCanonicalAppId('apitester')).toBe('api-tester');
  });

  it('returns the input verbatim when no alias exists', () => {
    expect(resolveCanonicalAppId('memo')).toBe('memo');
    expect(resolveCanonicalAppId('sheet')).toBe('sheet');
    expect(resolveCanonicalAppId('musiccreator')).toBe('musiccreator');
    expect(resolveCanonicalAppId('totally-unknown')).toBe('totally-unknown');
  });

  it('LEGACY_APP_ID_ALIASES never aliases an id back to itself', () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_APP_ID_ALIASES)) {
      expect(legacy).not.toBe(canonical);
    }
  });
});

const baseManifest = (id: string, name: string, icon: string): Manifest => ({
  id,
  name,
  version: '1.0.0',
  icon,
  category: 'Productivity',
  description: `${name} description`,
  window: {
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 400, height: 320 },
  },
  permissions: [],
  entry: { url: 'https://cdn.example.com/x.js' },
});

const legacyDef: AppDefinition = {
  id: 'markdownpreview',
  name: 'Markdown Preview',
  icon: 'FileCode',
  category: 'Productivity',
  description: 'Live markdown with GitHub styling.',
  defaultSize: { width: 800, height: 600 },
  minSize: { width: 480, height: 360 },
};

describe('unifyAppDefinition', () => {
  beforeEach(() => __clearInstalledAppsCacheForTests());
  afterEach(() => __clearInstalledAppsCacheForTests());

  it('returns the input verbatim when the id has no alias', () => {
    const native: AppDefinition = { ...legacyDef, id: 'memo', name: 'Memo' };
    expect(unifyAppDefinition(native)).toBe(native);
  });

  it('returns the input verbatim when the canonical row is not installed', () => {
    expect(unifyAppDefinition(legacyDef)).toBe(legacyDef);
  });

  it('replaces legacy entry with canonical AppDefinition when installed', () => {
    addToInstalledAppsCache({
      id: 'markdown-preview',
      kind: 'installed',
      manifest: baseManifest('markdown-preview', 'Markdown Preview', 'Eye'),
      entryUrl: 'https://cdn.example.com/markdown.js',
      assetsUrl: null,
      manifestUrl: 'https://cdn.example.com/tytus-app.json',
      installedAt: 0,
      enabled: true,
      builtinProtected: false,
    });
    const unified = unifyAppDefinition(legacyDef);
    expect(unified.id).toBe('markdown-preview');
    expect(unified.icon).toBe('Eye');
    expect(unified.name).toBe('Markdown Preview');
  });
});
