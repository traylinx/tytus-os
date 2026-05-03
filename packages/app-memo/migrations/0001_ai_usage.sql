-- Memo — engine cost telemetry (per-app UsageRecord shadow until M8
-- wires the daemon endpoint). Mirrors Sheet/Studio so the ai-engine's
-- CostReporter writes through the bound HostClient regardless of which
-- app spawned the session.

CREATE TABLE IF NOT EXISTS app_memo_ai_usage (
  tx_id              TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  mode               TEXT NOT NULL,
  model              TEXT NOT NULL,
  prompt_version     TEXT NOT NULL DEFAULT '',
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  accepted           INTEGER,
  final_state        TEXT,
  ghost_accepted     INTEGER NOT NULL DEFAULT 0,
  ghost_rejected     INTEGER NOT NULL DEFAULT 0,
  relevance_feedback TEXT,
  hunks_applied      INTEGER,
  hunks_total        INTEGER,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_memo_ai_usage_created
  ON app_memo_ai_usage(created_at DESC);
