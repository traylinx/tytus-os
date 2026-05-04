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
} from './legacy-app-aliases';

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
