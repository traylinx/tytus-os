// Music Creator repo tests — exercise the SQL CRUD + settings kv
// against an in-memory AppDb fake. Mirrors the Voice Recorder repo
// test pattern (no real SQLite, just a deterministic row store).
//
// Two things this guards:
//   1. Behaviour parity with the in-tree repo (insert/list/update/delete
//      + settings round-trip).
//   2. Every SQL string actually targets the per-app prefixed
//      `app_music_creator_tracks` / `app_music_creator_settings`
//      tables — if a future edit drops the prefix the host-api
//      prefix guard would reject the query at runtime, but here we
//      catch it at test time.

import { describe, it, expect } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  listTracks,
  getTrackById,
  insertTrack,
  updateTrackName,
  updateTrackCover,
  updateTrackStyle,
  updateTrackLyrics,
  updateTrackSpecs,
  updateTrackTheme,
  deleteTrack,
  loadCreatorSettings,
  saveCreatorSettings,
  DEFAULT_CREATOR_SETTINGS,
  type SavedTrackRow,
  type MusicCreatorSettings,
} from './musicCreator';

interface SqlCall {
  sql: string;
  args: readonly unknown[];
}

interface StoredTrackRow {
  id: string;
  title: string;
  style_tags: string;
  lyrics_preview: string;
  duration_ms: number;
  bitrate: number;
  sample_rate: number;
  size_bytes: number;
  created_at: number;
  audio_data_url: string;
  specs_json: string;
  cover_data_url: string;
  theme: string;
  source: string;
  audio_kind: string;
  external_id: string;
  external_url: string;
  thumbnail_url: string;
  artist: string;
  album: string;
}

interface StoredSettingRow {
  key: string;
  value: string;
}

class MemoryAppDb implements AppDb {
  trackRows: StoredTrackRow[] = [];
  settingRows: StoredSettingRow[] = [];
  runCalls: SqlCall[] = [];
  queryCalls: SqlCall[] = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    this.runCalls.push({ sql, args });
    if (/INSERT\s+OR\s+REPLACE\s+INTO\s+app_music_creator_tracks/i.test(sql)) {
      const a = args as unknown[];
      const row: StoredTrackRow = {
        id: a[0] as string,
        title: a[1] as string,
        style_tags: a[2] as string,
        lyrics_preview: a[3] as string,
        duration_ms: a[4] as number,
        bitrate: a[5] as number,
        sample_rate: a[6] as number,
        size_bytes: a[7] as number,
        created_at: a[8] as number,
        audio_data_url: a[9] as string,
        specs_json: a[10] as string,
        cover_data_url: a[11] as string,
        theme: a[12] as string,
        source: a[13] as string,
        audio_kind: a[14] as string,
        external_id: a[15] as string,
        external_url: a[16] as string,
        thumbnail_url: a[17] as string,
        artist: a[18] as string,
        album: a[19] as string,
      };
      const idx = this.trackRows.findIndex((r) => r.id === row.id);
      if (idx >= 0) this.trackRows[idx] = row;
      else this.trackRows.push(row);
      return { lastInsertRowid: 0, changes: 1 };
    }
    const updateMatch = /UPDATE\s+app_music_creator_tracks\s+SET\s+(\w+)\s*=\s*\?\s+WHERE\s+id\s*=\s*\?/i.exec(sql);
    if (updateMatch) {
      const col = updateMatch[1] as keyof StoredTrackRow;
      const [val, id] = args as [string | number, string];
      const r = this.trackRows.find((row) => row.id === id);
      if (r) (r as unknown as Record<string, unknown>)[col] = val;
      return { lastInsertRowid: 0, changes: r ? 1 : 0 };
    }
    if (/DELETE\s+FROM\s+app_music_creator_tracks/i.test(sql)) {
      const [id] = args as [string];
      const before = this.trackRows.length;
      this.trackRows = this.trackRows.filter((row) => row.id !== id);
      return { lastInsertRowid: 0, changes: before - this.trackRows.length };
    }
    if (/INSERT\s+INTO\s+app_music_creator_settings/i.test(sql)) {
      const [key, value] = args as [string, string];
      const idx = this.settingRows.findIndex((r) => r.key === key);
      if (idx >= 0) this.settingRows[idx] = { key, value };
      else this.settingRows.push({ key, value });
      return { lastInsertRowid: 0, changes: 1 };
    }
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    this.queryCalls.push({ sql, args });
    if (/SELECT[\s\S]+FROM\s+app_music_creator_tracks\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const [id] = args as [string];
      return this.trackRows.filter((r) => r.id === id) as unknown as T[];
    }
    if (/SELECT[\s\S]+FROM\s+app_music_creator_tracks/i.test(sql)) {
      return [...this.trackRows].sort((a, b) => b.created_at - a.created_at) as unknown as T[];
    }
    if (/SELECT\s+value\s+FROM\s+app_music_creator_settings\s+WHERE\s+key\s*=\s*\?/i.test(sql)) {
      const [key] = args as [string];
      return this.settingRows
        .filter((r) => r.key === key)
        .map((r) => ({ value: r.value })) as unknown as T[];
    }
    return [];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_music_creator_tracks', 'app_music_creator_settings'];
  }
}

const sampleTrack = (overrides: Partial<SavedTrackRow> = {}): SavedTrackRow => ({
  id: 't_1',
  title: 'Track 1',
  styleTags: 'pop, upbeat',
  lyricsPreview: 'la la la',
  durationMs: 180_000,
  bitrate: 192,
  sampleRate: 44_100,
  sizeBytes: 4_200_000,
  createdAt: 1_700_000_000_000,
  audioDataUrl: 'data:audio/mp3;base64,xxx',
  specsJson: '{"genre":"pop"}',
  coverDataUrl: '',
  theme: 'a sunny morning',
  source: 'juli3ta',
  audioKind: 'data_url',
  externalId: '',
  externalUrl: '',
  thumbnailUrl: '',
  artist: '',
  album: '',
  ...overrides,
});

describe('musicCreator repo — tracks CRUD', () => {
  it('insertTrack → listTracks round-trips the row', async () => {
    const db = new MemoryAppDb();
    const track = sampleTrack();
    await insertTrack(db, track);
    const rows = await listTracks(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(track);
  });

  it('listTracks orders by created_at DESC', async () => {
    const db = new MemoryAppDb();
    await insertTrack(db, sampleTrack({ id: 'a', createdAt: 100 }));
    await insertTrack(db, sampleTrack({ id: 'b', createdAt: 300 }));
    await insertTrack(db, sampleTrack({ id: 'c', createdAt: 200 }));
    const rows = await listTracks(db);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('getTrackById returns the row when present and null otherwise', async () => {
    const db = new MemoryAppDb();
    await insertTrack(db, sampleTrack({ id: 'present' }));
    const hit = await getTrackById(db, 'present');
    expect(hit).not.toBeNull();
    expect(hit?.id).toBe('present');
    const miss = await getTrackById(db, 'missing');
    expect(miss).toBeNull();
  });

  it('deleteTrack removes the row', async () => {
    const db = new MemoryAppDb();
    await insertTrack(db, sampleTrack({ id: 't_1' }));
    await insertTrack(db, sampleTrack({ id: 't_2' }));
    await deleteTrack(db, 't_1');
    const rows = await listTracks(db);
    expect(rows.map((r) => r.id)).toEqual(['t_2']);
  });

  it('updateTrackName trims, clamps to 200 chars, falls back to "Untitled"', async () => {
    const db = new MemoryAppDb();
    await insertTrack(db, sampleTrack({ id: 't_1', title: 'old' }));
    const renamed = await updateTrackName(db, 't_1', '   shiny new name   ');
    expect(renamed).toBe('shiny new name');
    const empty = await updateTrackName(db, 't_1', '   ');
    expect(empty).toBe('Untitled');
    const long = 'x'.repeat(500);
    const clamped = await updateTrackName(db, 't_1', long);
    expect(clamped).toHaveLength(200);
  });

  it('field-level updaters (cover/style/lyrics/specs/theme) round-trip', async () => {
    const db = new MemoryAppDb();
    await insertTrack(db, sampleTrack({ id: 't_1' }));
    await updateTrackCover(db, 't_1', 'data:image/png;base64,COVER');
    await updateTrackStyle(db, 't_1', 'jazz');
    await updateTrackLyrics(db, 't_1', 'new lyrics here');
    await updateTrackSpecs(db, 't_1', '{"tempo":120}');
    await updateTrackTheme(db, 't_1', 'midnight blue');
    const [row] = await listTracks(db);
    expect(row.coverDataUrl).toBe('data:image/png;base64,COVER');
    expect(row.styleTags).toBe('jazz');
    expect(row.lyricsPreview).toBe('new lyrics here');
    expect(row.specsJson).toBe('{"tempo":120}');
    expect(row.theme).toBe('midnight blue');
  });
});

describe('musicCreator repo — settings kv', () => {
  it('loadCreatorSettings returns DEFAULT_CREATOR_SETTINGS when no row exists', async () => {
    const db = new MemoryAppDb();
    const s = await loadCreatorSettings(db);
    expect(s).toEqual(DEFAULT_CREATOR_SETTINGS);
  });

  it('saveCreatorSettings → loadCreatorSettings round-trips', async () => {
    const db = new MemoryAppDb();
    const next: MusicCreatorSettings = {
      preferredPodId: 'pod-42',
      overridesByEndpoint: {
        'https://pod.example.com/v1': { music: 'minimax:music-2.6', lyrics: 'gpt-4' },
      },
    };
    await saveCreatorSettings(db, next);
    const loaded = await loadCreatorSettings(db);
    expect(loaded).toEqual(next);
  });

  it('DEFAULT_CREATOR_SETTINGS has the documented shape', () => {
    expect(DEFAULT_CREATOR_SETTINGS).toEqual({
      preferredPodId: null,
      overridesByEndpoint: {},
    });
  });
});

describe('musicCreator repo — table prefix discipline', () => {
  it('every CRUD verb targets the prefixed app_music_creator_tracks table', async () => {
    const db = new MemoryAppDb();
    const track = sampleTrack();
    await insertTrack(db, track);
    await updateTrackName(db, track.id, 'renamed');
    await updateTrackCover(db, track.id, '');
    await updateTrackStyle(db, track.id, 's');
    await updateTrackLyrics(db, track.id, 'l');
    await updateTrackSpecs(db, track.id, '');
    await updateTrackTheme(db, track.id, 't');
    await deleteTrack(db, track.id);
    await listTracks(db);
    await getTrackById(db, track.id);

    const allSql = [
      ...db.runCalls.map((c) => c.sql),
      ...db.queryCalls.map((c) => c.sql),
    ];
    for (const sql of allSql) {
      // Track-CRUD SQL must always carry the prefix.
      if (/music_creator_tracks/i.test(sql)) {
        expect(sql).toContain('app_music_creator_tracks');
        // No legacy un-prefixed identifier as a whole word.
        expect(sql).not.toMatch(/\bmusic_creator_tracks\b/);
      }
    }
  });

  it('settings CRUD targets the prefixed app_music_creator_settings table', async () => {
    const db = new MemoryAppDb();
    await saveCreatorSettings(db, DEFAULT_CREATOR_SETTINGS);
    await loadCreatorSettings(db);
    const allSql = [
      ...db.runCalls.map((c) => c.sql),
      ...db.queryCalls.map((c) => c.sql),
    ];
    for (const sql of allSql) {
      if (/music_creator_settings/i.test(sql)) {
        expect(sql).toContain('app_music_creator_settings');
        expect(sql).not.toMatch(/\bmusic_creator_settings\b/);
      }
    }
  });
});
