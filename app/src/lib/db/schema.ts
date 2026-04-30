// ============================================================
// TytusOS SQLite schema — single source of truth
// ============================================================
//
// Mirrors the makakoo-core pattern: one SQL string per schema
// version, idempotent CREATE TABLE / CREATE INDEX, schema version
// tracked via PRAGMA user_version. Migrations are additive — when
// you need to evolve, append SCHEMA_V2 with ALTER TABLE statements
// and bump SCHEMA_VERSION.
//
// Phase 2 ships the API Tester migration: history + collections.

export const SCHEMA_VERSION = 1;

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
