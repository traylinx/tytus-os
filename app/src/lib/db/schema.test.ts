import { describe, expect, it } from 'vitest';
import { SCHEMA_V12, SCHEMA_V13, SCHEMA_VERSION } from './schema';

describe('SQLite schema — V12 (installed_apps)', () => {
  it('SCHEMA_VERSION is bumped to 13', () => {
    expect(SCHEMA_VERSION).toBe(13);
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

describe('SQLite schema — V13 (installed_apps.manifest_url)', () => {
  it('adds a nullable manifest_url column to installed_apps', () => {
    // Nullable: no NOT NULL on the column. The worker gates the ALTER on
    // PRAGMA table_info so a partially-applied schema self-heals.
    expect(SCHEMA_V13).toMatch(
      /ALTER\s+TABLE\s+installed_apps\s+ADD\s+COLUMN\s+manifest_url\s+TEXT/i,
    );
    expect(SCHEMA_V13).not.toMatch(/manifest_url\s+TEXT\s+NOT\s+NULL/i);
  });
});
