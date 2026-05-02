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
  // Free-text theme (creative-brief prompt) the user typed when the
  // track was generated. Round-trips so reopening a track in Restyle
  // restores the original Theme box. Empty for tracks generated
  // before V7 (the schema column defaults to '').
  theme: string;
  // V8: external/streamed source metadata. Legacy generated rows default
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

// True iff the thrown SQLite error indicates a column that we ALTER
// in for V5/V6/V7 is missing. Lets repos fall back to the older
// column lists rather than blanking the gallery when an HMR-driven
// worker restart races the migration.
const isMissingColumn = (e: unknown, col: string): boolean =>
  new RegExp(`no such column:\\s*${col}`, 'i').test(String(e));

const isMissingAddedColumn = (e: unknown): boolean =>
  isMissingColumn(e, 'specs_json')
  || isMissingColumn(e, 'cover_data_url')
  || isMissingColumn(e, 'theme')
  || isMissingColumn(e, 'source')
  || isMissingColumn(e, 'audio_kind')
  || isMissingColumn(e, 'external_id')
  || isMissingColumn(e, 'external_url')
  || isMissingColumn(e, 'thumbnail_url')
  || isMissingColumn(e, 'artist')
  || isMissingColumn(e, 'album');

// Pre-V7 SELECT — drops `theme`. specs + cover still present.
const SELECT_BASE_NO_THEME = `id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url`;
// Pre-V6 SELECT — drops cover_data_url + theme.
const SELECT_BASE_NO_COVER = `id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json`;
// Pre-V5 SELECT — drops specs_json + cover_data_url + theme.
const SELECT_BASE_NO_SPECS = `id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url`;
const withV8Defaults = (r: Omit<DBRow, 'source' | 'audio_kind' | 'external_id' | 'external_url' | 'thumbnail_url' | 'artist' | 'album'>): DBRow => ({
  ...r,
  source: 'juli3ta',
  audio_kind: r.audio_data_url ? 'data_url' : 'lyrics_only',
  external_id: '',
  external_url: '',
  thumbnail_url: '',
  artist: '',
  album: '',
});

const fallbackSelect = async (
  db: NonNullable<ReturnType<typeof getDb>>,
  whereClause: string,
  params: SqlValue[],
  e: unknown,
): Promise<DBRow[]> => {
  // V8 source metadata missing → read the V7 shape, then synthesize
  // source defaults. If V7 is also missing columns, fall through into
  // the older fallback ladder below.
  if (
    isMissingColumn(e, 'source')
    || isMissingColumn(e, 'audio_kind')
    || isMissingColumn(e, 'external_id')
    || isMissingColumn(e, 'external_url')
    || isMissingColumn(e, 'thumbnail_url')
    || isMissingColumn(e, 'artist')
    || isMissingColumn(e, 'album')
  ) {
    try {
      const rows = await db.query<Omit<DBRow, 'source' | 'audio_kind' | 'external_id' | 'external_url' | 'thumbnail_url' | 'artist' | 'album'>>(
        `SELECT ${SELECT_BASE_NO_THEME}, theme FROM music_creator_tracks ${whereClause}`,
        params,
      );
      return rows.map(withV8Defaults);
    } catch (e2) {
      e = e2;
    }
  }
  // Theme column missing → drop it; cover + specs may still be present.
  if (isMissingColumn(e, 'theme')) {
    try {
      const rows = await db.query<Omit<DBRow, 'theme'>>(
        `SELECT ${SELECT_BASE_NO_THEME} FROM music_creator_tracks ${whereClause}`,
        params,
      );
      return rows.map((r) => withV8Defaults({ ...r, theme: '' }));
    } catch (e2) {
      if (!isMissingColumn(e2, 'cover_data_url')) throw e2;
      // Cover ALSO missing — fall further.
      try {
        const rows = await db.query<Omit<DBRow, 'cover_data_url' | 'theme'>>(
          `SELECT ${SELECT_BASE_NO_COVER} FROM music_creator_tracks ${whereClause}`,
          params,
        );
        return rows.map((r) => withV8Defaults({ ...r, cover_data_url: '', theme: '' }));
      } catch (e3) {
        if (!isMissingColumn(e3, 'specs_json')) throw e3;
        const rows = await db.query<Omit<DBRow, 'specs_json' | 'cover_data_url' | 'theme'>>(
          `SELECT ${SELECT_BASE_NO_SPECS} FROM music_creator_tracks ${whereClause}`,
          params,
        );
        return rows.map((r) => withV8Defaults({ ...r, specs_json: '', cover_data_url: '', theme: '' }));
      }
    }
  }
  // Cover column missing → drop it; specs may still be present.
  if (isMissingColumn(e, 'cover_data_url')) {
    try {
      const rows = await db.query<Omit<DBRow, 'cover_data_url' | 'theme'>>(
        `SELECT ${SELECT_BASE_NO_COVER} FROM music_creator_tracks ${whereClause}`,
        params,
      );
      return rows.map((r) => withV8Defaults({ ...r, cover_data_url: '', theme: '' }));
    } catch (e2) {
      if (!isMissingColumn(e2, 'specs_json')) throw e2;
      const rows = await db.query<Omit<DBRow, 'specs_json' | 'cover_data_url' | 'theme'>>(
        `SELECT ${SELECT_BASE_NO_SPECS} FROM music_creator_tracks ${whereClause}`,
        params,
      );
      return rows.map((r) => withV8Defaults({ ...r, specs_json: '', cover_data_url: '', theme: '' }));
    }
  }
  // Specs column missing → drop everything added after.
  if (isMissingColumn(e, 'specs_json')) {
    const rows = await db.query<Omit<DBRow, 'specs_json' | 'cover_data_url' | 'theme'>>(
      `SELECT ${SELECT_BASE_NO_SPECS} FROM music_creator_tracks ${whereClause}`,
      params,
    );
    return rows.map((r) => withV8Defaults({ ...r, specs_json: '', cover_data_url: '', theme: '' }));
  }
  throw e;
};

const SELECT_FULL = `id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url, theme,
              source, audio_kind, external_id, external_url, thumbnail_url, artist, album`;

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
          sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url, theme,
          source, audio_kind, external_id, external_url, thumbnail_url, artist, album)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ...baseParams,
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
  } catch (e) {
    if (!isMissingAddedColumn(e)) throw e;
    // V8 source metadata missing → write the V7 shape. The next worker
    // init heals the schema and future saves will persist source fields.
    if (
      isMissingColumn(e, 'source')
      || isMissingColumn(e, 'audio_kind')
      || isMissingColumn(e, 'external_id')
      || isMissingColumn(e, 'external_url')
      || isMissingColumn(e, 'thumbnail_url')
      || isMissingColumn(e, 'artist')
      || isMissingColumn(e, 'album')
    ) {
      try {
        await db.run(
          `INSERT OR REPLACE INTO music_creator_tracks
             (id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url, theme)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...baseParams, track.specsJson, track.coverDataUrl, track.theme],
        );
        return;
      } catch (e2) {
        e = e2;
      }
    }
    // Theme column missing → write everything except theme.
    if (isMissingColumn(e, 'theme')) {
      try {
        await db.run(
          `INSERT OR REPLACE INTO music_creator_tracks
             (id, title, style_tags, lyrics_preview, duration_ms, bitrate,
              sample_rate, size_bytes, created_at, audio_data_url, specs_json, cover_data_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...baseParams, track.specsJson, track.coverDataUrl],
        );
        return;
      } catch (e2) {
        if (!isMissingColumn(e2, 'cover_data_url')) throw e2;
        // Theme + cover both missing — fall through to specs-only path.
      }
    }
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
        // All added columns missing — fall through to the pre-V5 insert.
      }
    }
    // Pre-V5 fallback: drop everything added after V4. The caller's
    // panel state simply won't round-trip until the next reload heals
    // the schema.
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

// Update style_tags for a saved track. Used by the form's auto-save
// effect when the user edits Style on a track they've loaded.
export const updateTrackStyle = async (id: string, styleTags: string): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  await db.run('UPDATE music_creator_tracks SET style_tags = ? WHERE id = ?', [styleTags, id]);
};

// Update lyrics_preview for a saved track. Same pattern as above.
export const updateTrackLyrics = async (id: string, lyricsPreview: string): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  await db.run('UPDATE music_creator_tracks SET lyrics_preview = ? WHERE id = ?', [lyricsPreview, id]);
};

// Update specs_json for a saved track. Empty string clears it.
// Pre-V5 schemas without the column silently no-op so an HMR-driven
// schema-drift race doesn't corrupt the user's edit flow.
export const updateTrackSpecs = async (id: string, specsJson: string): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  try {
    await db.run('UPDATE music_creator_tracks SET specs_json = ? WHERE id = ?', [specsJson, id]);
  } catch (e) {
    if (!new RegExp('no such column:\\s*specs_json', 'i').test(String(e))) throw e;
    console.warn('[musicCreator] updateTrackSpecs skipped — pre-V5 schema');
  }
};

// Update theme (creative-brief prompt) for a saved track. Same
// auto-save pattern as the other field-level updaters. Pre-V7
// schemas silently no-op so the form's debounce doesn't surface
// scary errors during the migration window.
export const updateTrackTheme = async (id: string, theme: string): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  try {
    await db.run('UPDATE music_creator_tracks SET theme = ? WHERE id = ?', [theme, id]);
  } catch (e) {
    if (!new RegExp('no such column:\\s*theme', 'i').test(String(e))) throw e;
    console.warn('[musicCreator] updateTrackTheme skipped — pre-V7 schema');
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
