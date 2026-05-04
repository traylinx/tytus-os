-- API Tester — environment variable bags. Declared in the manifest's
-- storage.tables so it survives uninstall accounting; v1 of the lifted
-- app does not yet wire UI for environments (Postman-style {{var}}
-- substitution lands in a follow-up). The table is created so a future
-- minor release can begin populating it without another migration.

CREATE TABLE IF NOT EXISTS app_api_tester_environments (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  vars_json TEXT NOT NULL DEFAULT '{}',        -- serialized {key: value}
  pos       INTEGER NOT NULL DEFAULT 0,
  ts        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_app_api_tester_environments_pos
  ON app_api_tester_environments(pos);
