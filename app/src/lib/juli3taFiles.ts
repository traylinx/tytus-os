// JULI3TA generated-song file library client.
// Source of truth is the Tytus tray, which writes real files under
// ~/Music/JULI3TA. Browser SQLite remains a warm cache only.

export interface Juli3taFileTrack {
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
  source?: 'juli3ta' | 'youtube';
  audioKind?: 'data_url' | 'remote_stream' | 'lyrics_only';
  externalId?: string;
  externalUrl?: string;
  thumbnailUrl?: string;
  artist?: string;
  album?: string;
  folderPath?: string;
  audioPath?: string;
  lyricsPath?: string;
  metadataPath?: string;
}

export interface Juli3taFileLibraryResponse {
  rootPath: string;
  tracks: Juli3taFileTrack[];
}

const jsonFetch = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === 'object' && body && 'error' in body
      ? String((body as { error: unknown }).error)
      : text || res.statusText;
    throw new Error(msg);
  }
  return body as T;
};

export const listGeneratedTracksFromFiles = async (): Promise<Juli3taFileLibraryResponse> =>
  jsonFetch<Juli3taFileLibraryResponse>('/api/juli3ta/library/tracks');

export const saveGeneratedTrackToFiles = async (track: Juli3taFileTrack): Promise<Juli3taFileTrack> => {
  const res = await jsonFetch<{ ok: boolean; rootPath: string; track: Juli3taFileTrack }>(
    '/api/juli3ta/library/tracks',
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `juli3ta-save-${track.id}-${track.createdAt}` },
      body: JSON.stringify({
        ...track,
        source: track.source ?? 'juli3ta',
        audioKind: track.audioKind ?? (track.audioDataUrl ? 'data_url' : 'lyrics_only'),
      }),
    },
  );
  return res.track;
};

export const deleteGeneratedTrackFile = async (id: string): Promise<void> => {
  await jsonFetch<{ ok: boolean }>('/api/juli3ta/library/delete', {
    method: 'POST',
    headers: { 'Idempotency-Key': `juli3ta-delete-${id}` },
    body: JSON.stringify({ id }),
  });
};

export const openGeneratedTracksFolder = async (): Promise<string> => {
  const res = await jsonFetch<{ ok: boolean; path: string }>('/api/juli3ta/library/open-folder', {
    method: 'POST',
    headers: { 'Idempotency-Key': `juli3ta-open-folder-${Date.now()}` },
    body: '{}',
  });
  return res.path;
};
