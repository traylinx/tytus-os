// JULI3TA Player music library — provider-backed tracks, favorites,
// playlists. Separate from `music_creator_tracks`: My Work is generated
// JULI3TA output; this repo is streamed/imported music metadata.

import { getDb } from '@/lib/db';
import type { SqlValue } from '@/lib/db/types';

export interface MusicLibraryTrack {
  id: string;
  title: string;
  styleTags: string;
  lyricsPreview: string;
  durationMs: number;
  bitrate: number;
  sampleRate: number;
  sizeBytes: number;
  createdAt: number;
  audioDataUrl: string;
  specsJson: string;
  coverDataUrl: string;
  theme: string;
  source?: 'youtube' | 'juli3ta';
  audioKind?: 'remote_stream' | 'data_url' | 'lyrics_only';
  externalId?: string;
  externalUrl?: string;
  thumbnailUrl?: string;
  artist?: string;
  album?: string;
}

export interface FavoriteEntity {
  kind: 'track' | 'artist' | 'album' | 'playlist';
  entityId: string;
  provider: string;
  title?: string;
  createdAt?: number;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: MusicLibraryTrack[];
}

interface TrackDbRow {
  id: string;
  provider: string;
  external_id: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  thumbnail_url: string;
  external_url: string;
  added_at: number;
  last_played_at: number;
}

interface PlaylistDbRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

interface PlaylistItemDbRow extends TrackDbRow {
  playlist_id: string;
  pos: number;
}

const now = () => Date.now();

const toTrack = (r: TrackDbRow): MusicLibraryTrack => ({
  id: r.id,
  title: r.title,
  styleTags: r.provider === 'youtube' ? 'YouTube' : r.provider,
  lyricsPreview: '',
  durationMs: r.duration_ms ?? 0,
  bitrate: 0,
  sampleRate: 0,
  sizeBytes: 0,
  createdAt: r.added_at ?? now(),
  audioDataUrl: '',
  specsJson: '',
  coverDataUrl: '',
  theme: '',
  source: r.provider === 'juli3ta' ? 'juli3ta' : 'youtube',
  audioKind: 'remote_stream',
  externalId: r.external_id ?? '',
  externalUrl: r.external_url ?? '',
  thumbnailUrl: r.thumbnail_url ?? '',
  artist: r.artist ?? '',
  album: r.album ?? '',
});

const fromTrack = (track: MusicLibraryTrack): TrackDbRow => ({
  id: track.id,
  provider: track.source || 'youtube',
  external_id: track.externalId || track.id.replace(/^.+?:/, ''),
  title: track.title || 'Untitled',
  artist: track.artist || '',
  album: track.album || '',
  duration_ms: track.durationMs || 0,
  thumbnail_url: track.thumbnailUrl || '',
  external_url: track.externalUrl || '',
  added_at: track.createdAt || now(),
  last_played_at: 0,
});

const TRACK_COLUMNS = [
  'id', 'provider', 'external_id', 'title', 'artist', 'album', 'duration_ms',
  'thumbnail_url', 'external_url', 'added_at', 'last_played_at',
];
const TRACK_SELECT = TRACK_COLUMNS.join(', ');
const TRACK_SELECT_T = TRACK_COLUMNS.map((c) => `t.${c}`).join(', ');

export const listLibraryTracks = async (): Promise<MusicLibraryTrack[]> => {
  const db = getDb();
  if (!db) return [];
  const rows = await db.query<TrackDbRow>(
    `SELECT ${TRACK_SELECT} FROM music_library_tracks ORDER BY added_at DESC`,
  );
  return rows.map(toTrack);
};

export const upsertLibraryTrack = async (track: MusicLibraryTrack): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  const r = fromTrack(track);
  await db.run(
    `INSERT INTO music_library_tracks
       (id, provider, external_id, title, artist, album, duration_ms, thumbnail_url, external_url, added_at, last_played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       artist = excluded.artist,
       album = excluded.album,
       duration_ms = excluded.duration_ms,
       thumbnail_url = excluded.thumbnail_url,
       external_url = excluded.external_url`,
    [r.id, r.provider, r.external_id, r.title, r.artist, r.album, r.duration_ms, r.thumbnail_url, r.external_url, r.added_at, r.last_played_at],
  );
};

export const deleteLibraryTrack = async (id: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.tx(async () => {
    await db.run('DELETE FROM music_playlist_items WHERE track_id = ?', [id]);
    await db.run('DELETE FROM music_favorites WHERE kind = ? AND entity_id = ?', ['track', id]);
    await db.run('DELETE FROM music_library_tracks WHERE id = ?', [id]);
  });
};

export const migrateCreatorYoutubeRowsToLibrary = async (): Promise<number> => {
  const db = getDb();
  if (!db) return 0;
  const rows = await db.query<{
    id: string; title: string; duration_ms: number; created_at: number;
    external_id: string; external_url: string; thumbnail_url: string; artist: string; album: string;
  }>(
    `SELECT id, title, duration_ms, created_at, external_id, external_url, thumbnail_url, artist, album
       FROM music_creator_tracks
      WHERE source = 'youtube' AND external_id <> ''`,
  );
  for (const row of rows) {
    await db.run(
      `INSERT OR IGNORE INTO music_library_tracks
         (id, provider, external_id, title, artist, album, duration_ms, thumbnail_url, external_url, added_at, last_played_at)
       VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [row.id, row.external_id, row.title, row.artist, row.album, row.duration_ms, row.thumbnail_url, row.external_url, row.created_at],
    );
  }
  return rows.length;
};

export const listFavoriteEntities = async (kind?: FavoriteEntity['kind']): Promise<FavoriteEntity[]> => {
  const db = getDb();
  if (!db) return [];
  const where = kind ? 'WHERE kind = ?' : '';
  const rows = await db.query<{ kind: string; entity_id: string; provider: string; title: string; created_at: number }>(
    `SELECT kind, entity_id, provider, title, created_at FROM music_favorites ${where} ORDER BY created_at DESC`,
    kind ? [kind] : [],
  );
  return rows.map((r) => ({
    kind: r.kind as FavoriteEntity['kind'],
    entityId: r.entity_id,
    provider: r.provider,
    title: r.title,
    createdAt: r.created_at,
  }));
};

export const toggleFavorite = async (entity: FavoriteEntity): Promise<boolean> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  const rows = await db.query<{ n: number }>(
    'SELECT COUNT(*) as n FROM music_favorites WHERE kind = ? AND entity_id = ?',
    [entity.kind, entity.entityId],
  );
  const exists = Number(rows[0]?.n ?? 0) > 0;
  if (exists) {
    await db.run('DELETE FROM music_favorites WHERE kind = ? AND entity_id = ?', [entity.kind, entity.entityId]);
    return false;
  }
  await db.run(
    `INSERT INTO music_favorites (kind, entity_id, provider, title, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [entity.kind, entity.entityId, entity.provider, entity.title ?? '', now()],
  );
  return true;
};

export const listPlaylists = async (): Promise<MusicPlaylist[]> => {
  const db = getDb();
  if (!db) return [];
  const playlists = await db.query<PlaylistDbRow>(
    'SELECT id, name, created_at, updated_at FROM music_playlists ORDER BY updated_at DESC',
  );
  const items = await db.query<PlaylistItemDbRow>(
    `SELECT pi.playlist_id, pi.pos, ${TRACK_SELECT_T}
       FROM music_playlist_items pi
       JOIN music_library_tracks t ON t.id = pi.track_id
      ORDER BY pi.playlist_id, pi.pos ASC`,
  );
  const grouped = new Map<string, MusicLibraryTrack[]>();
  items.forEach((row) => {
    grouped.set(row.playlist_id, [...(grouped.get(row.playlist_id) ?? []), toTrack(row)]);
  });
  return playlists.map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    items: grouped.get(p.id) ?? [],
  }));
};

export const createPlaylist = async (name: string): Promise<MusicPlaylist> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  const clean = name.trim().slice(0, 80) || 'New Playlist';
  const ts = now();
  const playlist = { id: `playlist:${ts}:${Math.random().toString(36).slice(2, 8)}`, name: clean, createdAt: ts, updatedAt: ts, items: [] };
  await db.run(
    'INSERT INTO music_playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [playlist.id, playlist.name, playlist.createdAt, playlist.updatedAt],
  );
  return playlist;
};


export const deletePlaylist = async (playlistId: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.tx(async () => {
    await db.run('DELETE FROM music_playlist_items WHERE playlist_id = ?', [playlistId]);
    await db.run('DELETE FROM music_favorites WHERE kind = ? AND entity_id = ?', ['playlist', playlistId]);
    await db.run('DELETE FROM music_playlists WHERE id = ?', [playlistId]);
  });
};

export const addTrackToPlaylist = async (playlistId: string, track: MusicLibraryTrack): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  await db.tx(async () => {
    await upsertLibraryTrack(track);
    const rows = await db.query<{ n: number }>(
      'SELECT COALESCE(MAX(pos), -1) + 1 as n FROM music_playlist_items WHERE playlist_id = ?',
      [playlistId],
    );
    const pos = Number(rows[0]?.n ?? 0);
    await db.run(
      `INSERT OR IGNORE INTO music_playlist_items (playlist_id, track_id, pos, added_at)
       VALUES (?, ?, ?, ?)`,
      [playlistId, track.id, pos, now()],
    );
    await db.run('UPDATE music_playlists SET updated_at = ? WHERE id = ?', [now(), playlistId]);
  });
};

export const removeTrackFromPlaylist = async (playlistId: string, trackId: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('DELETE FROM music_playlist_items WHERE playlist_id = ? AND track_id = ?', [playlistId, trackId]);
  await db.run('UPDATE music_playlists SET updated_at = ? WHERE id = ?', [now(), playlistId]);
};
