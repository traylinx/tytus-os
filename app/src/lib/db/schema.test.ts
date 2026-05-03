import { describe, expect, it } from 'vitest';
import { SCHEMA_V12, SCHEMA_VERSION } from './schema';

describe('SQLite schema — V12 (installed_apps)', () => {
  it('SCHEMA_VERSION is bumped to 12', () => {
    expect(SCHEMA_VERSION).toBe(12);
  });

  it('SCHEMA_V12 creates installed_apps with the right columns', () => {
    expect(SCHEMA_V12).toMatch(
      /CREATE TABLE IF NOT EXISTS installed_apps/,
    );
    // Every column required by the spec.
    for (const col of [
      'id',
      'kind',
      'manifest_json',
      'entry_url',
      'assets_url',
      'installed_at',
      'enabled',
      'builtin_protected',
    ]) {
      expect(
        SCHEMA_V12,
        `installed_apps must declare ${col}`,
      ).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('constrains kind to the enum from the host-api spec', () => {
    expect(SCHEMA_V12).toContain(
      "CHECK (kind IN ('bundled', 'installed', 'legacy', 'alias'))",
    );
  });

  it('creates an index on kind for App Store filtering', () => {
    expect(SCHEMA_V12).toContain(
      'CREATE INDEX IF NOT EXISTS idx_installed_apps_kind',
    );
  });

  it('uses CREATE TABLE IF NOT EXISTS so it is idempotent on every boot', () => {
    expect(SCHEMA_V12).toContain('CREATE TABLE IF NOT EXISTS');
  });
});
