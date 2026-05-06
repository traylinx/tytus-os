import { describe, expect, it } from 'vitest';
import type { Manifest } from '@tytus/host-api';

import sheetManifest from '../../../packages/app-sheet/tytus-app.json';
import studioManifest from '../../../packages/app-studio/tytus-app.json';
import apiTesterManifest from '../../../packages/app-api-tester/tytus-app.json';
import { resolveManifestMigrations } from './app-migrations';

describe('resolveManifestMigrations', () => {
  it('bundles duplicate schema references once per app', () => {
    const migrations = resolveManifestMigrations(sheetManifest as Manifest);
    expect(migrations.map((m) => m.name)).toEqual([
      '0001_ai_usage.sql',
      '0002_cells.sql',
    ]);
    expect(migrations[1].sql).toContain('CREATE TABLE IF NOT EXISTS app_sheet_sheets');
  });

  it('resolves Studio document migrations from manifest storage declarations', () => {
    const migrations = resolveManifestMigrations(studioManifest as Manifest);
    expect(migrations.map((m) => m.name)).toEqual([
      '0001_ai_usage.sql',
      '0002_documents.sql',
    ]);
    expect(migrations[1].sql).toContain('CREATE TABLE IF NOT EXISTS app_studio_documents');
  });


  it('resolves installed-app package migrations such as API Tester', () => {
    const migrations = resolveManifestMigrations(apiTesterManifest as Manifest);
    expect(migrations.map((m) => m.name)).toEqual([
      '0001_requests.sql',
      '0002_environments.sql',
    ]);
    expect(migrations[0].sql).toContain('CREATE TABLE IF NOT EXISTS app_api_tester_history');
  });
});
