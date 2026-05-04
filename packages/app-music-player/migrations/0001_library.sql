-- Music Player — provider-backed library + playlists + favorites.
-- Was V10 music_library_* in the in-tree monolith schema. Renamed
-- to this app's prefix per D21.

CREATE TABLE IF NOT EXISTS app_music_player_library_tracks (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  title           TEXT NOT NULL,
  artist          TEXT NOT NULL DEFAULT '',
  album           TEXT NOT NULL DEFAULT '',
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  thumbnail_url   TEXT NOT NULL DEFAULT '',
  external_url    TEXT NOT NULL DEFAULT '',
  added_at        INTEGER NOT NULL,
  last_played_at  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_app_music_player_library_provider_external
  ON app_music_player_library_tracks(provider, external_id);
CREATE INDEX IF NOT EXISTS idx_app_music_player_library_added
  ON app_music_player_library_tracks(added_at DESC);

CREATE TABLE IF NOT EXISTS app_music_player_playlists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_music_player_playlist_items (
  playlist_id TEXT NOT NULL REFERENCES app_music_player_playlists(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL REFERENCES app_music_player_library_tracks(id) ON DELETE CASCADE,
  pos         INTEGER NOT NULL DEFAULT 0,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_app_music_player_playlist_items_playlist
  ON app_music_player_playlist_items(playlist_id, pos);

CREATE TABLE IF NOT EXISTS app_music_player_favorites (
  kind       TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  provider   TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_app_music_player_favorites_created
  ON app_music_player_favorites(created_at DESC);
