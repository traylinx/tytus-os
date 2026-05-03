-- Music Creator — per-app settings kv store. Was V3
-- music_creator_settings; renamed to app's prefix per D21.

CREATE TABLE IF NOT EXISTS app_music_creator_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
