-- Forge MVP — goal-first artifact workspace.
-- New tables only. No destructive migration from Memo/Studio/Sheet/etc.

CREATE TABLE IF NOT EXISTS app_forge_workspaces (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  goal            TEXT NOT NULL,
  mode            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_forge_cards (
  id                   TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  title                TEXT NOT NULL DEFAULT '',
  content              TEXT NOT NULL DEFAULT '',
  metadata_json         TEXT NOT NULL DEFAULT '{}',
  source_card_ids_json  TEXT NOT NULL DEFAULT '[]',
  position             REAL NOT NULL,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES app_forge_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_forge_outputs (
  id                   TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  card_id              TEXT,
  kind                 TEXT NOT NULL,
  title                TEXT NOT NULL,
  content              TEXT NOT NULL,
  metadata_json         TEXT NOT NULL DEFAULT '{}',
  source_card_ids_json  TEXT NOT NULL DEFAULT '[]',
  created_at           INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES app_forge_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES app_forge_cards(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_app_forge_workspaces_updated
  ON app_forge_workspaces(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_forge_cards_workspace_position
  ON app_forge_cards(workspace_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_app_forge_outputs_workspace_created
  ON app_forge_outputs(workspace_id, created_at DESC);
