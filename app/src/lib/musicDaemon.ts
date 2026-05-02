export interface MusicStatus {
  ready: boolean;
  installing: boolean;
  source: string;
  version?: string | null;
  error?: string | null;
}

export interface MusicSearchResult {
  id: string;
  source: 'youtube';
  title: string;
  durationMs?: number | null;
  thumbnailUrl?: string | null;
  channel?: string | null;
}

export interface MusicStreamInfo {
  videoId: string;
  proxyUrl: string;
  durationMs?: number | null;
  title?: string | null;
  container?: string | null;
  codec?: string | null;
}

export interface MusicPlaylistInfo {
  id: string;
  title: string;
  entries: MusicSearchResult[];
}

export interface MusicProviderStatus {
  id: string;
  name: string;
  kind: string;
  state: string;
  configured: boolean;
  needs: string[];
  capabilities: {
    searchTracks: boolean;
    searchAlbums: boolean;
    searchArtists: boolean;
    searchPlaylists: boolean;
    streamResolve: boolean;
    libraryMetadata: boolean;
    accountConnect: boolean;
  };
  loadMs?: number | null;
  message: string;
}


export interface MusicConnectorCredentialSpec {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface MusicConnectorStatus {
  provider: string;
  name: string;
  connected: boolean;
  configurable: boolean;
  oauthRequired: boolean;
  account?: string | null;
  credentialSpecs: MusicConnectorCredentialSpec[];
  verifiedAt?: string | null;
  lastError?: string | null;
  message: string;
}

export interface UnifiedMusicSearchResponse {
  provider: string;
  results: {
    tracks: MusicSearchResult[];
    albums: MusicSearchResult[];
    artists: MusicSearchResult[];
    playlists: MusicSearchResult[];
  };
  warnings: string[];
}

export class MusicDaemonError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MusicDaemonError';
    this.status = status;
    this.code = code;
  }
}

const getJson = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
  const res = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const maybe = body as { error?: unknown } | null;
    const code = typeof maybe?.error === 'string' ? maybe.error : `http_${res.status}`;
    throw new MusicDaemonError(res.status, code, code === 'music_unavailable' ? 'Music search is still starting up.' : code);
  }
  return body as T;
};


const postJson = async <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  if (!res.ok) {
    const maybe = parsed as { error?: unknown } | null;
    const code = typeof maybe?.error === 'string' ? maybe.error : `http_${res.status}`;
    throw new MusicDaemonError(res.status, code, code);
  }
  return parsed as T;
};

export const getMusicStatus = (signal?: AbortSignal): Promise<MusicStatus> =>
  getJson<MusicStatus>('/api/music/status', signal);

export const getMusicProviders = async (signal?: AbortSignal): Promise<MusicProviderStatus[]> => {
  const body = await getJson<{ providers: MusicProviderStatus[] }>('/api/music/providers', signal);
  return body.providers ?? [];
};

export const getMusicConnectors = async (signal?: AbortSignal): Promise<MusicConnectorStatus[]> => {
  const body = await getJson<{ connectors: MusicConnectorStatus[] }>('/api/music/connectors', signal);
  return body.connectors ?? [];
};

export const configureMusicConnector = (
  provider: string,
  credentials: Record<string, string>,
  signal?: AbortSignal,
): Promise<MusicConnectorStatus> =>
  postJson<MusicConnectorStatus>('/api/music/connectors/configure', { provider, credentials }, signal);

export const verifyMusicConnector = (provider: string, signal?: AbortSignal): Promise<MusicConnectorStatus> =>
  postJson<MusicConnectorStatus>('/api/music/connectors/verify', { provider }, signal);

export const disconnectMusicConnector = (provider: string, signal?: AbortSignal): Promise<MusicConnectorStatus> =>
  postJson<MusicConnectorStatus>('/api/music/connectors/disconnect', { provider }, signal);

export const searchMusic = async (
  query: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<MusicSearchResult[]> => {
  const q = new URLSearchParams({ q: query, limit: String(limit) });
  const body = await getJson<{ results: MusicSearchResult[] }>(`/api/music/search?${q.toString()}`, signal);
  return body.results ?? [];
};

export const searchMusicUnified = (
  query: string,
  types = 'tracks,albums,artists,playlists',
  limit = 20,
  signal?: AbortSignal,
): Promise<UnifiedMusicSearchResponse> => {
  const q = new URLSearchParams({ q: query, types, provider: 'auto', limit: String(limit) });
  return getJson<UnifiedMusicSearchResponse>(`/api/music/search2?${q.toString()}`, signal);
};

export const getArtistDetail = async (_provider: string, _id: string, _signal?: AbortSignal): Promise<null> =>
  null;

export const getAlbumDetail = async (_provider: string, _id: string, _signal?: AbortSignal): Promise<null> =>
  null;

export const getMusicStream = (videoId: string, signal?: AbortSignal): Promise<MusicStreamInfo> => {
  const q = new URLSearchParams({ videoId });
  return getJson<MusicStreamInfo>(`/api/music/stream?${q.toString()}`, signal);
};

export const getMusicPlaylist = (url: string, limit = 50, signal?: AbortSignal): Promise<MusicPlaylistInfo> => {
  const q = new URLSearchParams({ url, limit: String(limit) });
  return getJson<MusicPlaylistInfo>(`/api/music/playlist?${q.toString()}`, signal);
};
