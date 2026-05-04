-- Memo — atomic-note model. One row = one memo. The body is a single
-- TEXT column (markdown-ish); outliner mode is a render concern, not a
-- storage concern. Tags are a JSON array of strings stored in
-- `tags_json` and parsed/serialised at the repo boundary.
--
-- `mirror_to_brain` is a per-memo opt-in for the Brain bridge. The
-- engine wiring (brain.append patch on save) lands in M8 PR-M8.x; this
-- column reserves the bit so the schema doesn't churn when that wave
-- ships.

CREATE TABLE IF NOT EXISTS app_memo_memos (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  tags_json       TEXT NOT NULL DEFAULT '[]',
  mirror_to_brain INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_memo_memos_updated
  ON app_memo_memos(updated_at DESC);
