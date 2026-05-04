-- Sheet — engine cost telemetry (per-app UsageRecord shadow until M8
-- wires the daemon endpoint). The ai-engine's CostReporter writes
-- through the bound HostClient.storage.current() handle when the
-- engine is asked for it; this table is the local persistence behind
-- that surface.

CREATE TABLE IF NOT EXISTS app_sheet_ai_usage (
  tx_id              TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  mode               TEXT NOT NULL,
  model              TEXT NOT NULL,
  prompt_version     TEXT NOT NULL DEFAULT '',
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  accepted           INTEGER,                  -- nullable: null until recordOutcome
  final_state        TEXT,                     -- 'committed' | 'discarded' | 'abandoned' | NULL
  ghost_accepted     INTEGER NOT NULL DEFAULT 0,
  ghost_rejected     INTEGER NOT NULL DEFAULT 0,
  relevance_feedback TEXT,                     -- 'thumbs_up' | 'thumbs_down' | NULL
  hunks_applied      INTEGER,
  hunks_total        INTEGER,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_sheet_ai_usage_created
  ON app_sheet_ai_usage(created_at DESC);
