import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMusicStatus, searchMusic, getMusicStream, MusicDaemonError } from '@/lib/musicDaemon';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('music daemon client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches status from the daemon music endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ready: true,
      installing: false,
      source: 'system',
      version: '2026.01.01',
      error: null,
    }));
    const status = await getMusicStatus();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/status', expect.objectContaining({ method: 'GET' }));
    expect(status.ready).toBe(true);
    expect(status.source).toBe('system');
  });

  it('builds encoded search and stream URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'abc_DEF-123', source: 'youtube', title: 'A&B' }] }))
      .mockResolvedValueOnce(jsonResponse({ videoId: 'abc_DEF-123', proxyUrl: '/api/music/proxy/x' }));

    const results = await searchMusic('A&B', 5);
    const stream = await getMusicStream('abc_DEF-123');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/music/search?q=A%26B&limit=5');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/music/stream?videoId=abc_DEF-123');
    expect(results[0].title).toBe('A&B');
    expect(stream.proxyUrl).toBe('/api/music/proxy/x');
  });

  it('classifies 503 as music_unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'music_unavailable' }, 503));
    await expect(searchMusic('test')).rejects.toMatchObject({
      name: 'MusicDaemonError',
      status: 503,
      code: 'music_unavailable',
    } satisfies Partial<MusicDaemonError>);
  });
});
