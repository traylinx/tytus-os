// ============================================================
// Tytus OS SQLite schema — single source of truth
// ============================================================
//
// Mirrors the makakoo-core pattern: one SQL string per schema
// version, idempotent CREATE TABLE / CREATE INDEX, schema version
// tracked via PRAGMA user_version. Migrations are additive — when
// you need to evolve, append SCHEMA_V2 with ALTER TABLE statements
// and bump SCHEMA_VERSION.
//
// Phase 2 ships the API Tester migration: history + collections.

export const SCHEMA_VERSION = 9;

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS api_history (
  id          TEXT PRIMARY KEY,
  method      TEXT NOT NULL,
  url         TEXT NOT NULL,
  status      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ts          INTEGER NOT NULL                 -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_api_history_ts ON api_history(ts DESC);

CREATE TABLE IF NOT EXISTS api_collections (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pos  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_collections_pos ON api_collections(pos);

CREATE TABLE IF NOT EXISTS api_collection_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES api_collections(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  method        TEXT NOT NULL,
  url           TEXT NOT NULL,
  headers_json  TEXT NOT NULL DEFAULT '[]',    -- serialized Header[]
  body          TEXT NOT NULL DEFAULT '',
  pos           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_items_collection
  ON api_collection_items(collection_id, pos);

-- Migration markers — let one-shot importers run exactly once
-- across reloads. Key is opaque; presence = "imported, don't run again".
CREATE TABLE IF NOT EXISTS migration_flags (
  key TEXT PRIMARY KEY,
  ts  INTEGER NOT NULL
);
`;

// Schema V2: App usage tracking for "Frequently Used" scoring.
export const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS app_launches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id      TEXT NOT NULL,
  launched_at INTEGER NOT NULL                 -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_launches_app_time
  ON app_launches(app_id, launched_at DESC);
`;

// Schema V3: Music Creator (Juli3ta) — saved tracks + per-app settings.
//
// `music_creator_tracks` replaces the old IndexedDB-backed gallery.
// audio_data_url holds the full base64 MP3 (multi-MB) — SQLite handles
// it fine (page-spilled BLOB-in-TEXT) and quotas are way bigger than
// localStorage so songs survive reload reliably.
//
// `music_creator_settings` is a tiny key→json kv store for things the
// user can tweak: per-endpoint model overrides, default style preset,
// instrumental-by-default toggle, etc. Kept as a kv table rather than
// rigid columns so we can add settings without bumping the schema.
export const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS music_creator_tracks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  style_tags      TEXT NOT NULL DEFAULT '',
  lyrics_preview  TEXT NOT NULL DEFAULT '',
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  bitrate         INTEGER NOT NULL DEFAULT 0,
  sample_rate     INTEGER NOT NULL DEFAULT 0,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,                 -- unix ms
  audio_data_url  TEXT NOT NULL DEFAULT ''          -- base64 MP3 data URL
);
CREATE INDEX IF NOT EXISTS idx_music_tracks_created
  ON music_creator_tracks(created_at DESC);

CREATE TABLE IF NOT EXISTS music_creator_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                                -- JSON-serialized
);
`;

// Schema V4: Voice Recorder — saved recordings.
//
// Replaces the localStorage-backed VoiceRecording[] which was hitting
// the 5-10 MB browser quota with a few clips (each clip is a base64
// data URL, ~10 MB per minute of WAV/webm). Same flat row shape as the
// music_creator_tracks table; audio bytes go into a TEXT column too —
// SQLite handles MB-scale TEXT fine on OPFS-backed storage.
export const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS voice_recordings (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,                 -- unix ms
  mime_type       TEXT NOT NULL DEFAULT 'audio/webm',
  audio_data_url  TEXT NOT NULL DEFAULT ''           -- base64 data URL
);
CREATE INDEX IF NOT EXISTS idx_voice_recordings_created
  ON voice_recordings(created_at DESC);
`;

// Schema V5: Music Creator — structured Track Specs.
//
// Adds a single nullable JSON column to music_creator_tracks so the
// new structured controls (TrackSpecs) round-trip with each saved
// track. ALTER TABLE is idempotent only via PRAGMA — the worker
// guards re-application with user_version, so this runs exactly once.
export const SCHEMA_V5 = `
ALTER TABLE music_creator_tracks ADD COLUMN specs_json TEXT NOT NULL DEFAULT '';
`;

// Schema V6: Music Creator — cover art slot.
//
// Optional base64 data URL for per-track cover art. Empty when no
// cover is set. Lope-negotiated 2026-05-01: ship the schema field
// pre-extraction so Music Player inherits the spec shape cleanly
// after the Tytus Apps Platform sprint extracts the three apps.
// The actual cover-generation pipeline is deferred to a Host API
// verb (`host.media.generateCover()`) defined during that sprint.
export const SCHEMA_V6 = `
ALTER TABLE music_creator_tracks ADD COLUMN cover_data_url TEXT NOT NULL DEFAULT '';
`;

// Schema V7: Music Creator — theme (creative-brief prompt).
//
// Stores the free-text Theme the user typed when generating the
// track ("describe the song: vibe, mood, story, era…"). Was lost on
// reload before V7 — reopening a track in Restyle showed empty
// Theme even though the user originally wrote one. Persisting it
// closes the round-trip so the form fully restores from any saved
// row. Default empty string for backfill compatibility.
export const SCHEMA_V7 = `
ALTER TABLE music_creator_tracks ADD COLUMN theme TEXT NOT NULL DEFAULT '';
`;

// Schema V8: Music Creator — external/streamed source metadata.
//
// Lets JULI3TA save Nuclear/yt-dlp sourced tracks in the existing My Work
// rail without pretending expiring CDN URLs are durable audio_data_url bytes.
// Legacy rows default to the generated JULI3TA/data-url path.
export const SCHEMA_V8 = `
ALTER TABLE music_creator_tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'juli3ta';
ALTER TABLE music_creator_tracks ADD COLUMN audio_kind TEXT NOT NULL DEFAULT 'data_url';
ALTER TABLE music_creator_tracks ADD COLUMN external_id TEXT NOT NULL DEFAULT '';
ALTER TABLE music_creator_tracks ADD COLUMN external_url TEXT NOT NULL DEFAULT '';
ALTER TABLE music_creator_tracks ADD COLUMN thumbnail_url TEXT NOT NULL DEFAULT '';
ALTER TABLE music_creator_tracks ADD COLUMN artist TEXT NOT NULL DEFAULT '';
ALTER TABLE music_creator_tracks ADD COLUMN album TEXT NOT NULL DEFAULT '';
`;

// Schema V9: Custom desktop wallpaper — user-uploaded image bytes.
//
// One-row table keyed on `id = 'current'` so the custom-wallpaper slot is a
// straight upsert (no slot management UI in v1; user picks one image at a
// time). Bytes live as a base64 data URL in TEXT — same pattern as
// music_creator_tracks.audio_data_url. SQLite/OPFS handles MB-scale files
// without touching the localStorage 5 MB ceiling.
//
// State.theme.wallpaper holds either a preset path (`/wallpapers/...`),
// a CSS color string (`#hex` / `rgb(...)`), or the sentinel `'custom'`.
// When the sentinel is set, the renderer reads this row to find the
// actual data URL.
export const SCHEMA_V9 = `
CREATE TABLE IF NOT EXISTS wallpaper_custom (
  id            TEXT PRIMARY KEY,                   -- always 'current' in v1
  data_url      TEXT NOT NULL,                      -- base64 image data URL
  mime          TEXT NOT NULL DEFAULT 'image/jpeg',
  filename      TEXT NOT NULL DEFAULT '',
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  uploaded_at   INTEGER NOT NULL                    -- unix ms
);
`;
