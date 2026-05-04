/**
 * Tests for `localizedAppName` — the helper that prevents raw i18n
 * keys (`app.juli3ta.name`) from leaking into launcher labels, dock
 * tooltips, and window title bars when the locale lacks an entry.
 */

import { describe, expect, it } from 'vitest';

import { localizedAppName } from './app-name';

describe('localizedAppName', () => {
  it('returns the localized string when the i18n key resolves', () => {
    const t = (k: string) => (k === 'app.juli3ta.name' ? 'JULI3TA' : k);
    expect(localizedAppName(t, 'juli3ta', 'fallback')).toBe('JULI3TA');
  });

  it('falls back to the AppDefinition.name when the key is missing', () => {
    const t = (k: string) => k; // identity = key not in any locale
    expect(localizedAppName(t, 'markdown-preview', 'Markdown Preview')).toBe(
      'Markdown Preview',
    );
  });

  it('handles ids with hyphens, underscores, dots in the fallback path', () => {
    const t = (k: string) => k;
    expect(localizedAppName(t, 'todo.list', 'Todo')).toBe('Todo');
    expect(localizedAppName(t, 'foo_bar', 'Foo Bar')).toBe('Foo Bar');
  });

  it('uses the i18n value even when it equals the fallback string', () => {
    const t = (k: string) => (k === 'app.notes.name' ? 'Notes' : k);
    expect(localizedAppName(t, 'notes', 'Notes')).toBe('Notes');
  });
});
