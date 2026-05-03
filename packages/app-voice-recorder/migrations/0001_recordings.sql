-- Voice Recorder — saved recordings (was V4 voice_recordings in the
-- in-tree monolith schema). Renamed to this app's prefix per D21.

CREATE TABLE IF NOT EXISTS app_voice_recorder_recordings (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  mime_type       TEXT NOT NULL DEFAULT 'audio/webm',
  audio_data_url  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_app_voice_recorder_recordings_created
  ON app_voice_recorder_recordings(created_at DESC);
