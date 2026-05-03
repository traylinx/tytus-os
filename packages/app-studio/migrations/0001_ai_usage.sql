-- Studio — engine cost telemetry (per-app UsageRecord shadow until M8
-- wires the daemon endpoint). Mirrors the Sheet ai_usage shape so the
-- ai-engine's CostReporter can write through the bound HostClient
-- regardless of which app spawned the session.

CREATE TABLE IF NOT EXISTS app_studio_ai_usage (
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

CREATE INDEX IF NOT EXISTS idx_app_studio_ai_usage_created
  ON app_studio_ai_usage(created_at DESC);
