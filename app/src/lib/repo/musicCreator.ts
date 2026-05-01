// Music Creator (Juli3ta) repo — SQLite-backed gallery + settings.
//
// Replaces the IndexedDB store we used before. Same SavedTrack shape, but
// each row is independently insertable/deletable so we never re-serialize
// the whole gallery. The base64 audio data URL is held in a TEXT column
// (SQLite handles MB-scale TEXT fine; OPFS-backed quota is multi-GB).
//
// Settings live in a key→json kv table so we can grow the surface without
// migrations. Currently used for per-endpoint model overrides.

import { getDb } from '@/lib/db';

export interface SavedTrackRow {
  id: string;
  title: string;
  styleTags: string;
  lyricsPreview: string;
  durationMs: number;
  bitrate: number;
  sampleRate: number;
  sizeBytes: number;
  createdAt: number;
  audioDataUrl: string;
}

interface DBRow {
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
}

const fromDb = (r: DBRow): SavedTrackRow => ({
  id: r.id,
  title: r.title,
  styleTags: r.style_tags,
  lyricsPreview: r.lyrics_preview,
  durationMs: r.duration_ms,
  bitrate: r.bitrate,
  sampleRate: r.sample_rate,
  sizeBytes: r.size_bytes,
  createdAt: r.created_at,
  audioDataUrl: r.audio_data_url,
});

export const listTracks = async (): Promise<SavedTrackRow[]> => {
  const db = getDb();
  if (!db) return [];
  const rows = await db.query<DBRow>(
    `SELECT id, title, style_tags, lyrics_preview, duration_ms, bitrate,
            sample_rate, size_bytes, created_at, audio_data_url
       FROM music_creator_tracks
      ORDER BY created_at DESC`,
  );
  return rows.map(fromDb);
};

// Single-row lookup. Used by drop targets that hold a slim drag payload
// (id only) and need to resolve full track data without paying the cost
// of loading the whole gallery.
export const getTrackById = async (id: string): Promise<SavedTrackRow | null> => {
  const db = getDb();
  if (!db) return null;
  const rows = await db.query<DBRow>(
    `SELECT id, title, style_tags, lyrics_preview, duration_ms, bitrate,
            sample_rate, size_bytes, created_at, audio_data_url
       FROM music_creator_tracks
      WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length === 0 ? null : fromDb(rows[0]);
};

export const insertTrack = async (track: SavedTrackRow): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  await db.run(
    `INSERT OR REPLACE INTO music_creator_tracks
       (id, title, style_tags, lyrics_preview, duration_ms, bitrate,
        sample_rate, size_bytes, created_at, audio_data_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      track.id,
      track.title,
      track.styleTags,
      track.lyricsPreview,
      track.durationMs,
      track.bitrate,
      track.sampleRate,
      track.sizeBytes,
      track.createdAt,
      track.audioDataUrl,
    ],
  );
};

export const deleteTrack = async (id: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('DELETE FROM music_creator_tracks WHERE id = ?', [id]);
};

// ── Settings kv store ────────────────────────────────────────

export const getSetting = async <T>(key: string, fallback: T): Promise<T> => {
  const db = getDb();
  if (!db) return fallback;
  const rows = await db.query<{ value: string }>(
    'SELECT value FROM music_creator_settings WHERE key = ? LIMIT 1',
    [key],
  );
  if (rows.length === 0) return fallback;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return fallback;
  }
};

export const putSetting = async (key: string, value: unknown): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run(
    `INSERT INTO music_creator_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
};

// ── Settings shape ───────────────────────────────────────────

export interface ModelOverrides {
  music?: string;          // override what we'd auto-pick from /v1/models
  cover?: string;
  lyrics?: string;
  lyricsBackup?: string;   // chat-completions model used when lyrics errors
}

export interface MusicCreatorSettings {
  preferredPodId: string | null;
  // Per-endpoint URL → user's manual overrides. Falls back to the
  // auto-discovered ids on /v1/models when not set here.
  overridesByEndpoint: Record<string, ModelOverrides>;
}

export const DEFAULT_SETTINGS: MusicCreatorSettings = {
  preferredPodId: null,
  overridesByEndpoint: {},
};

export const SETTINGS_KEY = 'music_creator_settings';

export const loadSettings = (): Promise<MusicCreatorSettings> =>
  getSetting<MusicCreatorSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);

export const saveSettings = (s: MusicCreatorSettings): Promise<void> =>
  putSetting(SETTINGS_KEY, s);
