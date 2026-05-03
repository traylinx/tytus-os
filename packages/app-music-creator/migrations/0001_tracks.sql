-- Music Creator — saved tracks (was V3 + V5–V8 in the in-tree
-- monolith schema). Extracted into this app's own physical
-- prefix per D21. M3 ships the table here; the one-time
-- migration script (PR-M3.5+) copies rows from the legacy
-- music_creator_tracks → app_music_creator_tracks.

CREATE TABLE IF NOT EXISTS app_music_creator_tracks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  style_tags      TEXT NOT NULL DEFAULT '',
  lyrics_preview  TEXT NOT NULL DEFAULT '',
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  bitrate         INTEGER NOT NULL DEFAULT 0,
  sample_rate     INTEGER NOT NULL DEFAULT 0,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  audio_data_url  TEXT NOT NULL DEFAULT '',
  -- V5: structured TrackSpecs (round-trip Restyle).
  specs_json      TEXT NOT NULL DEFAULT '',
  -- V6: per-track cover art slot.
  cover_data_url  TEXT NOT NULL DEFAULT '',
  -- V7: free-text Theme the user supplied at generation time.
  theme           TEXT NOT NULL DEFAULT '',
  -- V8: Nuclear/yt-dlp sourced metadata.
  source          TEXT NOT NULL DEFAULT 'juli3ta',
  audio_kind      TEXT NOT NULL DEFAULT 'data_url',
  external_id     TEXT NOT NULL DEFAULT '',
  external_url    TEXT NOT NULL DEFAULT '',
  thumbnail_url   TEXT NOT NULL DEFAULT '',
  artist          TEXT NOT NULL DEFAULT '',
  album           TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_app_music_creator_tracks_created
  ON app_music_creator_tracks(created_at DESC);
