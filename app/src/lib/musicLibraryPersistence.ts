import type {
  FavoriteEntity,
  MusicLibrarySnapshot,
  MusicLibraryTrack,
  MusicPlaylist,
} from '@/lib/repo/musicLibrary';

const HOST_STATE_ENDPOINT = '/api/juli3ta/music-state';
const BROWSER_STATE_KEY = 'juli3ta:musicLibrarySnapshot:v1';

interface HostMusicStateResponse {
  ok?: boolean;
  rootPath?: string;
  statePath?: string;
  state?: Partial<MusicLibrarySnapshot>;
}

const now = () => Date.now();

export const emptyMusicLibrarySnapshot = (): MusicLibrarySnapshot => ({
  version: 1,
  updatedAt: 0,
  tracks: [],
  favorites: [],
  playlists: [],
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeTrack = (value: unknown): MusicLibraryTrack | null => {
  if (!isObject(value)) return null;
  const id = String(value.id ?? '').trim();
  if (!id) return null;
  const source = value.source === 'juli3ta' ? 'juli3ta' : 'youtube';
  const audioKind =
    value.audioKind === 'data_url' || value.audioKind === 'lyrics_only'
      ? value.audioKind
      : 'remote_stream';
  return {
    id,
    title: String(value.title ?? 'Untitled'),
    styleTags: String(value.styleTags ?? (source === 'youtube' ? 'YouTube' : source)),
    lyricsPreview: String(value.lyricsPreview ?? ''),
    durationMs: Number(value.durationMs ?? 0) || 0,
    bitrate: Number(value.bitrate ?? 0) || 0,
    sampleRate: Number(value.sampleRate ?? 0) || 0,
    sizeBytes: Number(value.sizeBytes ?? 0) || 0,
    createdAt: Number(value.createdAt ?? now()) || now(),
    audioDataUrl: String(value.audioDataUrl ?? ''),
    specsJson: String(value.specsJson ?? ''),
    coverDataUrl: String(value.coverDataUrl ?? ''),
    theme: String(value.theme ?? ''),
    source,
    audioKind,
    externalId: String(value.externalId ?? ''),
    externalUrl: String(value.externalUrl ?? ''),
    thumbnailUrl: String(value.thumbnailUrl ?? ''),
    artist: String(value.artist ?? ''),
    album: String(value.album ?? ''),
  };
};

const normalizeFavorite = (value: unknown): FavoriteEntity | null => {
  if (!isObject(value)) return null;
  const kind = value.kind;
  if (kind !== 'track' && kind !== 'artist' && kind !== 'album' && kind !== 'playlist') return null;
  const entityId = String(value.entityId ?? '').trim();
  if (!entityId) return null;
  return {
    kind,
    entityId,
    provider: String(value.provider ?? ''),
    title: String(value.title ?? ''),
    createdAt: Number(value.createdAt ?? now()) || now(),
  };
};

const normalizePlaylist = (value: unknown): MusicPlaylist | null => {
  if (!isObject(value)) return null;
  const id = String(value.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(value.name ?? 'Playlist'),
    createdAt: Number(value.createdAt ?? now()) || now(),
    updatedAt: Number(value.updatedAt ?? value.createdAt ?? now()) || now(),
    items: Array.isArray(value.items)
      ? value.items.map(normalizeTrack).filter((track): track is MusicLibraryTrack => Boolean(track))
      : [],
  };
};

export const normalizeMusicLibrarySnapshot = (
  raw: Partial<MusicLibrarySnapshot> | null | undefined,
): MusicLibrarySnapshot => {
  if (!raw) return emptyMusicLibrarySnapshot();
  return {
    version: 1,
    updatedAt: Number(raw.updatedAt ?? 0) || 0,
    tracks: Array.isArray(raw.tracks)
      ? raw.tracks.map(normalizeTrack).filter((track): track is MusicLibraryTrack => Boolean(track))
      : [],
    favorites: Array.isArray(raw.favorites)
      ? raw.favorites.map(normalizeFavorite).filter((fav): fav is FavoriteEntity => Boolean(fav))
      : [],
    playlists: Array.isArray(raw.playlists)
      ? raw.playlists.map(normalizePlaylist).filter((playlist): playlist is MusicPlaylist => Boolean(playlist))
      : [],
  };
};

const mergeById = <T extends { id: string; createdAt?: number; updatedAt?: number }>(
  left: T[],
  right: T[],
): T[] => {
  const map = new Map<string, T>();
  for (const item of [...left, ...right]) {
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      continue;
    }
    const itemTime = item.updatedAt ?? item.createdAt ?? 0;
    const prevTime = prev.updatedAt ?? prev.createdAt ?? 0;
    if (itemTime >= prevTime) map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
};

const mergeFavorites = (left: FavoriteEntity[], right: FavoriteEntity[]): FavoriteEntity[] => {
  const map = new Map<string, FavoriteEntity>();
  for (const fav of [...left, ...right]) {
    const key = `${fav.kind}:${fav.entityId}`;
    const prev = map.get(key);
    if (!prev || (fav.createdAt ?? 0) >= (prev.createdAt ?? 0)) map.set(key, fav);
  }
  return [...map.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
};

export const mergeMusicLibrarySnapshots = (
  local: MusicLibrarySnapshot,
  durable: MusicLibrarySnapshot | null | undefined,
): MusicLibrarySnapshot => {
  const safeLocal = normalizeMusicLibrarySnapshot(local);
  const safeDurable = normalizeMusicLibrarySnapshot(durable);
  return {
    version: 1,
    updatedAt: Math.max(safeLocal.updatedAt, safeDurable.updatedAt, now()),
    tracks: mergeById(safeDurable.tracks, safeLocal.tracks),
    favorites: mergeFavorites(safeDurable.favorites, safeLocal.favorites),
    playlists: mergeById(safeDurable.playlists, safeLocal.playlists),
  };
};

export const buildMusicLibrarySnapshot = (
  tracks: MusicLibraryTrack[],
  favoriteIds: Set<string>,
  playlists: MusicPlaylist[],
): MusicLibrarySnapshot => {
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  return {
    version: 1,
    updatedAt: now(),
    tracks: tracks.map((track) => normalizeTrack(track)).filter((track): track is MusicLibraryTrack => Boolean(track)),
    favorites: [...favoriteIds].map((id) => {
      const track = trackById.get(id);
      return {
        kind: 'track' as const,
        entityId: id,
        provider: track?.source ?? 'youtube',
        title: track?.title ?? '',
        createdAt: now(),
      };
    }),
    playlists: playlists.map((playlist) => normalizePlaylist(playlist)).filter((playlist): playlist is MusicPlaylist => Boolean(playlist)),
  };
};

export const loadBrowserMusicLibrarySnapshot = (): MusicLibrarySnapshot | null => {
  try {
    const raw = localStorage.getItem(BROWSER_STATE_KEY);
    if (!raw) return null;
    return normalizeMusicLibrarySnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const saveBrowserMusicLibrarySnapshot = (snapshot: MusicLibrarySnapshot): void => {
  try {
    localStorage.setItem(BROWSER_STATE_KEY, JSON.stringify(normalizeMusicLibrarySnapshot(snapshot)));
  } catch {
    // Browser quota/localStorage failures must not interrupt music actions.
  }
};

export const loadHostMusicLibrarySnapshot = async (): Promise<MusicLibrarySnapshot | null> => {
  try {
    const res = await fetch(HOST_STATE_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as HostMusicStateResponse;
    return normalizeMusicLibrarySnapshot(body.state);
  } catch {
    return null;
  }
};

export const saveHostMusicLibrarySnapshot = async (snapshot: MusicLibrarySnapshot): Promise<void> => {
  const normalized = normalizeMusicLibrarySnapshot(snapshot);
  saveBrowserMusicLibrarySnapshot(normalized);
  try {
    await fetch(HOST_STATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `juli3ta-music-state-${normalized.updatedAt}-${normalized.tracks.length}-${normalized.favorites.length}`,
      },
      body: JSON.stringify({ state: normalized }),
    });
  } catch {
    // The tray endpoint is an upgrade path. Local browser backup still exists.
  }
};
