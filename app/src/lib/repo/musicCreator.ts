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
import type { SqlValue } from '@/lib/db/types';

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
  // Stored as serialized JSON in the column; round-tripped opaquely.
  // Empty string in DB means "no specs were set when this track was
  // saved" — the caller treats that as undefined.
  specsJson: string;
  // Optional per-track cover art (base64 data URL). Empty when no
  // cover has been generated. The auto-generation pipeline lives
  // post-extraction (Host API verb); this field exists today so the
  // schema is locked before extraction.
  coverDataUrl: string;
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
  specs_json: string;
  cover_data_url: string;
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
  specsJson: r.specs_json ?? '',
  coverDataUrl: r.cover_data_url ?? '',
});

// True iff the thrown SQLite error indicates a column that we ALTER
// in for the V5/V6 migrations is missing. Lets repos fall back to the
// pre-V5 / pre-V6 column list rather than blanking the gallery when
// an HMR-driven worker restart races the migration.
const isMissingColumn = (e: unknown, col: 'specs_json' | 'cover_data_url'): boolean =>
  new RegExp(`no such column:\\s*${col}`, 'i').test(String(e));

const isMissingAddedColumn = (e: unknown): boolean =>
  isMissingColumn(e, 'specs_json') || isMissingColumn(e, 'cover_data_url');

// Pre-V6 SELECT — drops cover_data_url so it works on stuck schemas.
const SELECT_BASE_NO_COVER = `id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json`;
// Pre-V5 SELECT — drops specs_json + cover_data_url.
const SELECT_BASE_NO_SPECS = `id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url`;

const fallbackSelect = async (
  db: NonNullable<ReturnType<typeof getDb>>,
  whereClause: string,
  params: SqlValue[],
  e: unknown,
): Promise<DBRow[]> => {
  // Cover column missing → drop it; specs may still be present.
  if (isMissingColumn(e, 'cover_data_url')) {
    try {
      const rows = await db.query<Omit<DBRow, 'cover_data_url'>>(
        `SELECT ${SELECT_BASE_NO_COVER} FROM music_creator_tracks ${whereClause}`,
        params,
      );
      return rows.map((r) => ({ ...r, cover_data_url: '' }));
    } catch (e2) {
      if (!isMissingColumn(e2, 'specs_json')) throw e2;
      const rows = await db.query<Omit<DBRow, 'specs_json' | 'cover_data_url'>>(
        `SELECT ${SELECT_BASE_NO_SPECS} FROM music_creator_tracks ${whereClause}`,
        params,
      );
      return rows.map((r) => ({ ...r, specs_json: '', cover_data_url: '' }));
    }
  }
  // Specs column missing → drop both (cover column was added after specs).
  if (isMissingColumn(e, 'specs_json')) {
    const rows = await db.query<Omit<DBRow, 'specs_json' | 'cover_data_url'>>(
      `SELECT ${SELECT_BASE_NO_SPECS} FROM music_creator_tracks ${whereClause}`,
      params,
    );
    return rows.map((r) => ({ ...r, specs_json: '', cover_data_url: '' }));
  }
  throw e;
};

const SELECT_FULL = `id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url`;

export const listTracks = async (): Promise<SavedTrackRow[]> => {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await db.query<DBRow>(
      `SELECT ${SELECT_FULL} FROM music_creator_tracks ORDER BY created_at DESC`,
    );
    return rows.map(fromDb);
  } catch (e) {
    if (!isMissingAddedColumn(e)) throw e;
    const rows = await fallbackSelect(db, 'ORDER BY created_at DESC', [], e);
    return rows.map(fromDb);
  }
};

// Single-row lookup. Used by drop targets that hold a slim drag payload
// (id only) and need to resolve full track data without paying the cost
// of loading the whole gallery.
export const getTrackById = async (id: string): Promise<SavedTrackRow | null> => {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db.query<DBRow>(
      `SELECT ${SELECT_FULL} FROM music_creator_tracks WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows.length === 0 ? null : fromDb(rows[0]);
  } catch (e) {
    if (!isMissingAddedColumn(e)) throw e;
    const rows = await fallbackSelect(db, 'WHERE id = ? LIMIT 1', [id], e);
    return rows.length === 0 ? null : fromDb(rows[0]);
  }
};

export const insertTrack = async (track: SavedTrackRow): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  const baseParams = [
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
  ];
  try {
    await db.run(
      `INSERT OR REPLACE INTO music_creator_tracks
         (id, title, style_tags, lyrics_preview, duration_ms, bitrate,
          sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...baseParams, track.specsJson, track.coverDataUrl],
    );
  } catch (e) {
    if (!isMissingAddedColumn(e)) throw e;
    // Cover column missing → write specs_json only.
    if (isMissingColumn(e, 'cover_data_url')) {
      try {
        await db.run(
          `INSERT OR REPLACE INTO music_creator_tracks
             (id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...baseParams, track.specsJson],
        );
        return;
      } catch (e2) {
        if (!isMissingColumn(e2, 'specs_json')) throw e2;
        // Both columns missing — fall through to the pre-V5 insert.
      }
    }
    // Pre-V5 fallback: drop both specs_json and cover_data_url. The
    // caller's panel state simply won't round-trip until the next
    // reload heals the schema.
    await db.run(
      `INSERT OR REPLACE INTO music_creator_tracks
         (id, title, style_tags, lyrics_preview, duration_ms, bitrate,
          sample_rate, size_bytes, created_at, audio_data_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      baseParams,
    );
  }
};

export const deleteTrack = async (id: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('DELETE FROM music_creator_tracks WHERE id = ?', [id]);
};

// Rename a track. Trims + clamps to 200 chars to keep DB rows sane and
// match the inline-edit input limit. Returns the persisted title so the
// caller can mirror it into in-memory state without re-reading the row.
export const renameTrack = async (id: string, title: string): Promise<string> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  const next = title.trim().slice(0, 200) || 'Untitled';
  await db.run('UPDATE music_creator_tracks SET title = ? WHERE id = ?', [next, id]);
  return next;
};

// Update a track's album-cover-art image. Empty string clears it
// (UI falls back to the gradient placeholder). Defensive against the
// pre-V6 schema: if cover_data_url doesn't exist yet we silently no-op
// rather than throw, matching the rest of the repo's fallback discipline.
export const updateTrackCover = async (id: string, coverDataUrl: string): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  try {
    await db.run('UPDATE music_creator_tracks SET cover_data_url = ? WHERE id = ?', [coverDataUrl, id]);
  } catch (e) {
    if (!new RegExp('no such column:\\s*cover_data_url', 'i').test(String(e))) throw e;
    // Pre-V6 schema — V6 ALTER hasn't run yet. Skip silently; the next
    // reload will heal the schema and the user can retry. Logging only
    // because this is an expected transient race in dev.
    console.warn('[musicCreator] updateTrackCover skipped — pre-V6 schema');
  }
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
  cover?: string;          // music-cover / restyle (audio style transfer)
  lyrics?: string;
  lyricsBackup?: string;   // chat-completions model used when lyrics errors
  image?: string;          // album-cover-art image generation model
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
