export type MusicProviderId = 'youtube' | 'spotify' | 'lastfm' | 'discogs' | string;

export interface ProviderRef {
  id: MusicProviderId;
  name: string;
  kind?: 'streaming' | 'metadata' | 'catalog' | string;
}

export interface ArtworkImage {
  url: string;
  width?: number | null;
  height?: number | null;
}

export interface ArtworkSet {
  thumbnail?: string | null;
  small?: string | null;
  medium?: string | null;
  large?: string | null;
  original?: string | null;
  images?: ArtworkImage[];
}

export interface ArtistRef {
  id: string;
  name: string;
  provider: ProviderRef;
  artwork?: ArtworkSet;
  bio?: string | null;
}

export interface AlbumRef {
  id: string;
  title: string;
  provider: ProviderRef;
  artists: ArtistRef[];
  artwork?: ArtworkSet;
  year?: number | null;
  trackCount?: number | null;
}

export interface MusicTrack {
  id: string;
  provider: ProviderRef;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef | null;
  durationMs?: number | null;
  artwork?: ArtworkSet;
  externalUrl?: string | null;
  streamable?: boolean;
  rawTitle?: string;
}

export interface PlaylistRef {
  id: string;
  provider: ProviderRef;
  title: string;
  owner?: string | null;
  artwork?: ArtworkSet;
  trackCount?: number | null;
}

export interface SearchResults {
  tracks: MusicTrack[];
  artists: ArtistRef[];
  albums: AlbumRef[];
  playlists: PlaylistRef[];
}

export interface StreamCandidate {
  provider: ProviderRef;
  id: string;
  url: string;
  expiresAt?: number | null;
  mimeType?: string | null;
}
