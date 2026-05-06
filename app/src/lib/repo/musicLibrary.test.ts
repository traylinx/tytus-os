import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setDbForTesting } from '@/lib/db';
import type { Db, SqlValue } from '@/lib/db/types';
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  listFavoriteEntities,
  listLibraryTracks,
  listPlaylists,
  toggleFavorite,
  upsertLibraryTrack,
  type MusicLibraryTrack,
} from '@/lib/repo/musicLibrary';

interface TrackRow {
  id: string; provider: string; external_id: string; title: string; artist: string; album: string;
  duration_ms: number; thumbnail_url: string; external_url: string; added_at: number; last_played_at: number;
}
interface PlaylistRow { id: string; name: string; created_at: number; updated_at: number; }
interface PlaylistItemRow { playlist_id: string; track_id: string; pos: number; added_at: number; }
interface FavRow { kind: string; entity_id: string; provider: string; title: string; created_at: number; }

const makeFake = (): Db => {
  let tracks: TrackRow[] = [];
  let playlists: PlaylistRow[] = [];
  let items: PlaylistItemRow[] = [];
  let favs: FavRow[] = [];

  const run = async (sql: string, bindings: SqlValue[] = []) => {
    const lower = sql.trim().toLowerCase();
    if (lower.startsWith('insert into music_library_tracks')) {
      const [id, provider, external_id, title, artist, album, duration_ms, thumbnail_url, external_url, added_at, last_played_at] = bindings as [string, string, string, string, string, string, number, string, string, number, number];
      tracks = tracks.filter((t) => t.id !== id);
      tracks.push({ id, provider, external_id, title, artist, album, duration_ms, thumbnail_url, external_url, added_at, last_played_at });
      return;
    }
    if (lower.startsWith('insert or ignore into music_library_tracks')) {
      const [id, provider, external_id, title, artist, album, duration_ms, thumbnail_url, external_url, added_at, last_played_at] = bindings as [string, string, string, string, string, string, number, string, string, number, number];
      if (!tracks.some((t) => t.id === id)) {
        tracks.push({ id, provider, external_id, title, artist, album, duration_ms, thumbnail_url, external_url, added_at, last_played_at });
      }
      return;
    }
    if (lower.startsWith('update music_library_tracks')) {
      const [title, artist, album, duration_ms, thumbnail_url, external_url, id] = bindings as [string, string, string, number, string, string, string];
      tracks = tracks.map((t) => t.id === id ? { ...t, title, artist, album, duration_ms, thumbnail_url, external_url } : t);
      return;
    }
    if (lower.startsWith('insert into music_playlists')) {
      const [id, name, created_at, updated_at] = bindings as [string, string, number, number];
      playlists.push({ id, name, created_at, updated_at });
      return;
    }
    if (lower.startsWith('insert or ignore into music_playlist_items')) {
      const [playlist_id, track_id, pos, added_at] = bindings as [string, string, number, number];
      if (!items.some((i) => i.playlist_id === playlist_id && i.track_id === track_id)) {
        items.push({ playlist_id, track_id, pos, added_at });
      }
      return;
    }
    if (lower.startsWith('update music_playlists set updated_at')) return;
    if (lower.startsWith('insert into music_favorites')) {
      const [kind, entity_id, provider, title, created_at] = bindings as [string, string, string, string, number];
      favs.push({ kind, entity_id, provider, title, created_at });
      return;
    }
    if (lower.startsWith('delete from music_favorites')) {
      const [kind, entity_id] = bindings as [string, string];
      favs = favs.filter((f) => !(f.kind === kind && f.entity_id === entity_id));
      return;
    }
    if (lower.startsWith('delete from music_playlist_items where playlist_id')) {
      const [playlist_id] = bindings as [string];
      items = items.filter((i) => i.playlist_id !== playlist_id);
      return;
    }
    if (lower.startsWith('delete from music_playlists')) {
      const [id] = bindings as [string];
      playlists = playlists.filter((pl) => pl.id !== id);
      return;
    }
    throw new Error(`fake.run unhandled: ${sql}`);
  };

  const query = async <T = Record<string, SqlValue>>(sql: string, bindings: SqlValue[] = []): Promise<T[]> => {
    const lower = sql.trim().toLowerCase();
    if (lower.startsWith('select id, provider')) return [...tracks].sort((a, b) => b.added_at - a.added_at) as unknown as T[];
    if (lower.startsWith('select count(*) as n from music_favorites')) {
      const [kind, entity_id] = bindings as [string, string];
      return [{ n: favs.filter((f) => f.kind === kind && f.entity_id === entity_id).length }] as T[];
    }
    if (lower.startsWith('select kind, entity_id')) return favs as unknown as T[];
    if (lower.startsWith('select id, name')) return [...playlists].sort((a, b) => b.updated_at - a.updated_at) as unknown as T[];
    if (lower.startsWith('select pi.playlist_id')) {
      const rows = items.flatMap((i) => {
        const t = tracks.find((x) => x.id === i.track_id);
        return t ? [{ ...t, playlist_id: i.playlist_id, pos: i.pos }] : [];
      }).sort((a, b) => a.playlist_id === b.playlist_id ? a.pos - b.pos : a.playlist_id.localeCompare(b.playlist_id));
      return rows as unknown as T[];
    }
    if (lower.startsWith('select coalesce(max(pos)')) {
      const [playlist_id] = bindings as [string];
      const max = Math.max(-1, ...items.filter((i) => i.playlist_id === playlist_id).map((i) => i.pos));
      return [{ n: max + 1 }] as T[];
    }
    return [] as T[];
  };

  return {
    exec: async () => undefined,
    run,
    query,
    tx: async <T,>(fn: () => Promise<T>) => fn(),
  };
};

const track = (id: string): MusicLibraryTrack => ({
  id,
  title: `Track ${id}`,
  styleTags: 'YouTube',
  lyricsPreview: '',
  durationMs: 123000,
  bitrate: 0,
  sampleRate: 0,
  sizeBytes: 0,
  createdAt: 1000,
  audioDataUrl: '',
  specsJson: '',
  coverDataUrl: '',
  theme: '',
  source: 'youtube',
  audioKind: 'remote_stream',
  externalId: id.replace('youtube:', ''),
  externalUrl: `https://youtube.com/watch?v=${id}`,
  thumbnailUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
  artist: 'Artist',
  album: 'Channel',
});

describe('musicLibrary repo', () => {
  beforeEach(() => setDbForTesting(makeFake()));
  afterEach(() => setDbForTesting(null));

  it('upserts and lists library tracks', async () => {
    await upsertLibraryTrack(track('youtube:a'));
    const rows = await listLibraryTracks();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Track youtube:a');
    expect(rows[0].source).toBe('youtube');
  });

  it('toggles favorite entities', async () => {
    await toggleFavorite({ kind: 'track', entityId: 'youtube:a', provider: 'youtube', title: 'A' });
    expect(await listFavoriteEntities('track')).toHaveLength(1);
    await toggleFavorite({ kind: 'track', entityId: 'youtube:a', provider: 'youtube', title: 'A' });
    expect(await listFavoriteEntities('track')).toHaveLength(0);
  });

  it('creates playlist and adds tracks', async () => {
    const playlist = await createPlaylist('Bowie');
    await addTrackToPlaylist(playlist.id, track('youtube:a'));
    const rows = await listPlaylists();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Bowie');
    expect(rows[0].items.map((i) => i.id)).toEqual(['youtube:a']);
  });

  it('deletes playlist and items', async () => {
    const playlist = await createPlaylist('Bowie');
    await addTrackToPlaylist(playlist.id, track('youtube:a'));
    await deletePlaylist(playlist.id);
    expect(await listPlaylists()).toHaveLength(0);
  });
});
