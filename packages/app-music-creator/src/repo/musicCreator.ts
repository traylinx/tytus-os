// Music Creator (Juli3ta) repo — workspace-package edition.
//
// Lifted from app/src/lib/repo/musicCreator.ts as part of W4 of the
// apps-platform sprint. Two structural changes vs the legacy in-tree
// version:
//
//   1. Physical table names are the per-app prefixed
//      `app_music_creator_tracks` / `app_music_creator_settings`
//      (was the un-prefixed monolith schema). The host-api prefix
//      guard rejects any query that touches a table outside the bound
//      app's prefix, so the previous global names would have failed
//      on first call.
//
//   2. The `AppDb` handle is passed in instead of pulled from a global
//      `getDb()`. Apps in the workspace world don't reach into the
//      shell's singleton — they get an `AppDb` from
//      `host.storage.current()` at boot and pass it through.
//
// The schema-drift fallback ladder from the legacy file is dropped:
// the per-app DB is created fresh from `migrations/0001_tracks.sql`
// + `migrations/0002_settings.sql`, so all V5/V6/V7/V8 columns are
// present from row zero. The legacy ladder existed because in-tree
// HMR could race ALTER TABLE; the per-app DB has no such race
// (`AppDb.migrate()` runs to completion before any repo call).
//
// Cross-app concerns (the YouTube → music-library import) live in
// the shell's `app/src/runtime/legacy-migrations.ts`. They run once,
// shell-side, before the per-app DB binds — workspace-package code
// can't see un-prefixed legacy tables anyway.

import type { AppDb } from '@tytus/host-api';

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
  // cover has been generated.
  coverDataUrl: string;
  // Free-text theme (creative-brief prompt) the user typed when the
  // track was generated. Round-trips so reopening a track in Restyle
  // restores the original Theme box.
  theme: string;
  // External/streamed source metadata. Legacy generated rows default
  // to source=juli3ta/audioKind=data_url.
  source?: 'juli3ta' | 'youtube';
  audioKind?: 'data_url' | 'remote_stream' | 'lyrics_only';
  externalId?: string;
  externalUrl?: string;
  thumbnailUrl?: string;
  artist?: string;
  album?: string;
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
  theme: string;
  source: string;
  audio_kind: string;
  external_id: string;
  external_url: string;
  thumbnail_url: string;
  artist: string;
  album: string;
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
  theme: r.theme ?? '',
  source: (r.source || 'juli3ta') as SavedTrackRow['source'],
  audioKind: (r.audio_kind || (r.audio_data_url ? 'data_url' : 'lyrics_only')) as SavedTrackRow['audioKind'],
  externalId: r.external_id ?? '',
  externalUrl: r.external_url ?? '',
  thumbnailUrl: r.thumbnail_url ?? '',
  artist: r.artist ?? '',
  album: r.album ?? '',
});

const SELECT_FULL = `id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url, theme,
              source, audio_kind, external_id, external_url, thumbnail_url, artist, album`;

export const listTracks = async (db: AppDb): Promise<SavedTrackRow[]> => {
  const rows = await db.query<DBRow>(
    `SELECT ${SELECT_FULL} FROM app_music_creator_tracks ORDER BY created_at DESC`,
  );
  return rows.map(fromDb);
};

// Single-row lookup. Used by drop targets that hold a slim drag payload
// (id only) and need to resolve full track data without paying the cost
// of loading the whole gallery.
export const getTrackById = async (
  db: AppDb,
  id: string,
): Promise<SavedTrackRow | null> => {
  const rows = await db.query<DBRow>(
    `SELECT ${SELECT_FULL} FROM app_music_creator_tracks WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length === 0 ? null : fromDb(rows[0]);
};

export const insertTrack = async (
  db: AppDb,
  track: SavedTrackRow,
): Promise<void> => {
  await db.run(
    `INSERT OR REPLACE INTO app_music_creator_tracks
       (id, title, style_tags, lyrics_preview, duration_ms, bitrate,
        sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url, theme,
        source, audio_kind, external_id, external_url, thumbnail_url, artist, album)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      track.specsJson,
      track.coverDataUrl,
      track.theme,
      track.source ?? 'juli3ta',
      track.audioKind ?? (track.audioDataUrl ? 'data_url' : 'lyrics_only'),
      track.externalId ?? '',
      track.externalUrl ?? '',
      track.thumbnailUrl ?? '',
      track.artist ?? '',
      track.album ?? '',
    ],
  );
};

export const deleteTrack = async (db: AppDb, id: string): Promise<void> => {
  await db.run('DELETE FROM app_music_creator_tracks WHERE id = ?', [id]);
};

// Rename a track. Trims + clamps to 200 chars to keep DB rows sane and
// match the inline-edit input limit. Returns the persisted title so the
// caller can mirror it into in-memory state without re-reading the row.
export const updateTrackName = async (
  db: AppDb,
  id: string,
  title: string,
): Promise<string> => {
  const next = title.trim().slice(0, 200) || 'Untitled';
  await db.run(
    'UPDATE app_music_creator_tracks SET title = ? WHERE id = ?',
    [next, id],
  );
  return next;
};

// Update a track's album-cover-art image. Empty string clears it
// (UI falls back to the gradient placeholder).
export const updateTrackCover = async (
  db: AppDb,
  id: string,
  coverDataUrl: string,
): Promise<void> => {
  await db.run(
    'UPDATE app_music_creator_tracks SET cover_data_url = ? WHERE id = ?',
    [coverDataUrl, id],
  );
};

// Update style_tags for a saved track. Used by the form's auto-save
// effect when the user edits Style on a track they've loaded.
export const updateTrackStyle = async (
  db: AppDb,
  id: string,
  styleTags: string,
): Promise<void> => {
  await db.run(
    'UPDATE app_music_creator_tracks SET style_tags = ? WHERE id = ?',
    [styleTags, id],
  );
};

// Update lyrics_preview for a saved track.
export const updateTrackLyrics = async (
  db: AppDb,
  id: string,
  lyricsPreview: string,
): Promise<void> => {
  await db.run(
    'UPDATE app_music_creator_tracks SET lyrics_preview = ? WHERE id = ?',
    [lyricsPreview, id],
  );
};

// Update specs_json for a saved track. Empty string clears it.
export const updateTrackSpecs = async (
  db: AppDb,
  id: string,
  specsJson: string,
): Promise<void> => {
  await db.run(
    'UPDATE app_music_creator_tracks SET specs_json = ? WHERE id = ?',
    [specsJson, id],
  );
};

// Update theme (creative-brief prompt) for a saved track.
export const updateTrackTheme = async (
  db: AppDb,
  id: string,
  theme: string,
): Promise<void> => {
  await db.run(
    'UPDATE app_music_creator_tracks SET theme = ? WHERE id = ?',
    [theme, id],
  );
};

// ── Settings kv store ────────────────────────────────────────

const getSetting = async <T>(
  db: AppDb,
  key: string,
  fallback: T,
): Promise<T> => {
  const rows = await db.query<{ value: string }>(
    'SELECT value FROM app_music_creator_settings WHERE key = ? LIMIT 1',
    [key],
  );
  if (rows.length === 0) return fallback;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return fallback;
  }
};

const putSetting = async (
  db: AppDb,
  key: string,
  value: unknown,
): Promise<void> => {
  await db.run(
    `INSERT INTO app_music_creator_settings (key, value) VALUES (?, ?)
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

export const DEFAULT_CREATOR_SETTINGS: MusicCreatorSettings = {
  preferredPodId: null,
  overridesByEndpoint: {},
};

const SETTINGS_KEY = 'music_creator_settings';

export const loadCreatorSettings = (db: AppDb): Promise<MusicCreatorSettings> =>
  getSetting<MusicCreatorSettings>(db, SETTINGS_KEY, DEFAULT_CREATOR_SETTINGS);

export const saveCreatorSettings = (
  db: AppDb,
  s: MusicCreatorSettings,
): Promise<void> => putSetting(db, SETTINGS_KEY, s);
