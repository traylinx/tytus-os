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

export const SCHEMA_VERSION = 3;

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
