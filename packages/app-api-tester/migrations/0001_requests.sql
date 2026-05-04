-- API Tester — request history + editable collections.
--
-- Table layout mirrors the pre-extraction schema (api_history /
-- api_collections / api_collection_items, see app/src/lib/db/schema.ts
-- SCHEMA_V1) re-prefixed under this app's `app_api_tester_*` namespace
-- so the per-app prefix guard accepts the SQL.
--
-- FK CASCADE on the items table means deleting a collection wipes its
-- items in the same transaction.

CREATE TABLE IF NOT EXISTS app_api_tester_history (
  id          TEXT PRIMARY KEY,
  method      TEXT NOT NULL,
  url         TEXT NOT NULL,
  status      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ts          INTEGER NOT NULL                 -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_app_api_tester_history_ts
  ON app_api_tester_history(ts DESC);

CREATE TABLE IF NOT EXISTS app_api_tester_collections (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pos  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_app_api_tester_collections_pos
  ON app_api_tester_collections(pos);

CREATE TABLE IF NOT EXISTS app_api_tester_collection_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES app_api_tester_collections(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  method        TEXT NOT NULL,
  url           TEXT NOT NULL,
  headers_json  TEXT NOT NULL DEFAULT '[]',    -- serialized Header[]
  body          TEXT NOT NULL DEFAULT '',
  pos           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_app_api_tester_items_collection
  ON app_api_tester_collection_items(collection_id, pos);
