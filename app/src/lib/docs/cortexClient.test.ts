import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerCortexDocs, getCortexDocsSources } from './cortexClient';

const client = { baseUrl: 'http://localhost:4242' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cortex docs client', () => {
  it('routes through local Tytus help bridge, never Cortex directly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          answer: 'Use the installer.',
          citations: [{ title: 'Install', snippet: 'curl', doc_id: 'getting-started' }],
          corpus_hash: 'h1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await answerCortexDocs(client, { query: 'install tytus' });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4242/api/help/answer',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain('ma-cortex');
  });

  it('turns degraded bridge replies into daemon errors so Help can fall back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'degraded',
            reason: 'docs_token_missing',
            fallback: 'bundled',
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const res = await getCortexDocsSources(client);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('daemon_offline');
      expect(res.error.message).toBe('docs_token_missing');
    }
  });
});
