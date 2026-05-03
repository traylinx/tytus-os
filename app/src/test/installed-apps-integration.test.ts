/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PermissionDeniedError } from '@tytus/host-api';
import type { Manifest } from '@tytus/host-api';
import {
  listInstalledApps,
  resolveSharedTableNames,
  seedInstalledApps,
} from '@/runtime/installed-apps-repo';
import { createAppDb } from '@/runtime/storage-impl';
import type { Db, SqlValue } from '@/lib/db/types';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

function loadManifest(appId: string): Manifest {
  const file = path.resolve(REPO_ROOT, `packages/app-${appId}/tytus-app.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Manifest;
}

class IntegrationDb implements Db {
  private installedAppRows: Array<Record<string, SqlValue>> = [];
  private musicCreatorTracks: Array<Record<string, SqlValue>> = [];
  private voiceRecorderRecordings: Array<Record<string, SqlValue>> = [];

  async exec(): Promise<void> {}

  async query<T>(sql: string, bindings: SqlValue[] = []): Promise<T[]> {
    if (/FROM\s+installed_apps/i.test(sql)) {
      if (/WHERE\s+id\s*=\s*\?/i.test(sql)) {
        return this.installedAppRows.filter(
          (r) => r.id === bindings[0],
        ) as unknown as T[];
      }
      return this.installedAppRows as unknown as T[];
    }
    if (/FROM\s+app_voice_recorder_recordings/i.test(sql)) {
      return this.voiceRecorderRecordings as unknown as T[];
    }
    if (/FROM\s+app_music_creator_tracks/i.test(sql)) {
      return this.musicCreatorTracks as unknown as T[];
    }
    if (/FROM\s+sqlite_master/i.test(sql)) {
      return [] as unknown as T[];
    }
    return [] as T[];
  }

  async run(sql: string, bindings: SqlValue[] = []): Promise<void> {
    if (/INSERT\s+INTO\s+installed_apps/i.test(sql)) {
      const [
        id,
        kind,
        manifest_json,
        entry_url,
        assets_url,
        installed_at,
        enabled,
        builtin_protected,
      ] = bindings;
      const existing = this.installedAppRows.findIndex((r) => r.id === id);
      if (existing >= 0) {
        this.installedAppRows[existing].manifest_json = manifest_json;
        this.installedAppRows[existing].entry_url = entry_url;
        this.installedAppRows[existing].assets_url = assets_url;
      } else {
        this.installedAppRows.push({
          id,
          kind,
          manifest_json,
          entry_url,
          assets_url,
          installed_at,
          enabled,
          builtin_protected,
        });
      }
    }
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  /** Test helpers — seed app tables with a row each. */
  __seedFixtures() {
    this.musicCreatorTracks.push({
      id: 't1',
      title: 'Hello World',
      created_at: 1700000000000,
    });
    this.voiceRecorderRecordings.push({
      id: 'v1',
      name: 'Memo 1',
      duration_ms: 12000,
      created_at: 1700000000001,
    });
  }
}

describe('Installed-apps end-to-end with real on-disk manifests', () => {
  it('seeds, lists, and resolves shared tables for the music suite', async () => {
    const db = new IntegrationDb();
    const manifests = (
      ['music-creator', 'music-player', 'voice-recorder'] as const
    ).map((id) => ({
      manifest: loadManifest(id),
      entryUrl: `/_apps/${id}/index.js`,
      assetsUrl: `/_apps/${id}/assets/`,
    }));

    await seedInstalledApps(db, manifests);

    const installed = await listInstalledApps(db);
    expect(installed.map((r) => r.id).sort()).toEqual([
      'music-creator',
      'music-player',
      'voice-recorder',
    ]);
    // All three are kind='bundled' and builtin_protected=true (system apps).
    for (const row of installed) {
      expect(row.kind).toBe('bundled');
      expect(row.builtinProtected).toBe(true);
    }

    // music-creator's storage.shared.voice_recordings permission resolves
    // to voice-recorder's app_voice_recorder_recordings table.
    const sharedFor = await resolveSharedTableNames(db, 'music-creator');
    expect(sharedFor).toEqual(['app_voice_recorder_recordings']);

    // music-player declares no storage.shared.* permission → no shared tables.
    const sharedForPlayer = await resolveSharedTableNames(db, 'music-player');
    expect(sharedForPlayer).toEqual([]);

    // voice-recorder declares the share but doesn't consume any → no shared
    // tables in its OWN AppDb (an app does not consume itself).
    const sharedForRecorder = await resolveSharedTableNames(
      db,
      'voice-recorder',
    );
    expect(sharedForRecorder).toEqual([]);
  });

  it('music-creator AppDb can read voice-recorder recordings via the resolved share', async () => {
    const db = new IntegrationDb();
    db.__seedFixtures();
    await seedInstalledApps(db, [
      { manifest: loadManifest('music-creator'), entryUrl: null, assetsUrl: null },
      { manifest: loadManifest('voice-recorder'), entryUrl: null, assetsUrl: null },
    ]);

    const sharedTableNames = await resolveSharedTableNames(db, 'music-creator');
    const creatorDb = createAppDb({
      db,
      appId: 'music-creator',
      sharedTableNames,
    });

    // Permitted: own table + the declared shared table. (The stub Db
    // returns full rows; we only assert the id is present, not column
    // projection — projection is a real-DB concern.)
    const tracks = await creatorDb.query<{ id: string }>(
      'SELECT id FROM app_music_creator_tracks',
    );
    expect(tracks.map((r) => r.id)).toEqual(['t1']);

    const recordings = await creatorDb.query<{ id: string }>(
      'SELECT id FROM app_voice_recorder_recordings',
    );
    expect(recordings.map((r) => r.id)).toEqual(['v1']);
  });

  it('music-creator AppDb still rejects voice-recorder tables NOT shared', async () => {
    const db = new IntegrationDb();
    await seedInstalledApps(db, [
      { manifest: loadManifest('music-creator'), entryUrl: null, assetsUrl: null },
      { manifest: loadManifest('voice-recorder'), entryUrl: null, assetsUrl: null },
    ]);
    const sharedTableNames = await resolveSharedTableNames(db, 'music-creator');
    const creatorDb = createAppDb({
      db,
      appId: 'music-creator',
      sharedTableNames,
    });
    // voice-recorder doesn't expose a `app_voice_recorder_settings` share —
    // the prefix guard rejects.
    await expect(
      creatorDb.query('SELECT * FROM app_voice_recorder_settings'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('seedInstalledApps is idempotent on the real manifests (re-seeds without dupes)', async () => {
    const db = new IntegrationDb();
    const manifests = (
      ['music-creator', 'music-player', 'voice-recorder'] as const
    ).map((id) => ({
      manifest: loadManifest(id),
      entryUrl: null,
      assetsUrl: null,
    }));
    await seedInstalledApps(db, manifests);
    await seedInstalledApps(db, manifests);
    await seedInstalledApps(db, manifests);
    const installed = await listInstalledApps(db);
    expect(installed).toHaveLength(3);
  });
});
