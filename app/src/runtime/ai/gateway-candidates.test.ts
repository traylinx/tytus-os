import { describe, expect, it, vi } from 'vitest';
import type { DaemonApi } from '@tytus/host-api';
import { buildGatewayCandidates } from './gateway-candidates';
import { LlmGateway } from './llm-gateway';

const daemon = (included: DaemonApi['state']['included']): DaemonApi => ({
  state: { agents: [], included },
  onStateChange: () => () => {},
  callPodEndpoint: vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
    headers: { 'content-type': 'application/json' },
  })),
  music: {} as DaemonApi['music'],
  juli3taLibrary: {} as DaemonApi['juli3taLibrary'],
});

describe('buildGatewayCandidates', () => {
  it('orders remote included AIL before tunnel and local', () => {
    const candidates = buildGatewayCandidates(daemon([
      {
        id: 'p04',
        status: 'running',
        kind: 'ail',
        publicUrl: 'https://p04.example.com',
        meta: {
          gatewayUrl: 'https://p04.example.com/v1',
          privateUrl: 'http://10.42.42.1:18080/v1',
          gatewayKey: 'sk-live',
        },
      },
    ]));
    expect(candidates.map((c) => c.source)).toEqual(['included', 'tunnel', 'local']);
    expect(candidates[0].callViaHost).toBe(true);
  });

  it('keeps local fallback when no included AIL exists', () => {
    const candidates = buildGatewayCandidates(daemon([]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe('local');
  });
});

describe('LlmGateway', () => {
  it('uses remote host proxy before local fetch during status probe', async () => {
    const d = daemon([
      { id: 'p04', status: 'running', kind: 'ail', publicUrl: 'https://p04.example.com' },
    ]);
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
    const status = await new LlmGateway(d).status();
    expect(status.available).toBe(true);
    expect(status.source).toBe('included');
    expect(d.callPodEndpoint).toHaveBeenCalledWith('p04', '/v1/models', expect.any(Object));
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('fails over from retryable remote errors to local chat', async () => {
    const d = daemon([
      { id: 'p04', status: 'running', kind: 'ail', publicUrl: 'https://p04.example.com' },
    ]);
    const callPodEndpoint = d.callPodEndpoint as ReturnType<typeof vi.fn>;
    callPodEndpoint.mockResolvedValueOnce(new Response('busy', { status: 429 }));
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'local ok' } }],
    }), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const chunks = [];
    for await (const chunk of new LlmGateway(d).chat({
      messages: [{ role: 'user', content: 'ping' }],
      model: 'auto',
    })) {
      chunks.push(chunk);
    }

    expect(callPodEndpoint).toHaveBeenCalledWith('p04', '/v1/chat/completions', expect.any(Object));
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:18080/v1/chat/completions', expect.any(Object));
    expect(chunks.map((c) => c.token).join('')).toBe('local ok');
    expect(chunks[0].candidate.source).toBe('local');
    vi.unstubAllGlobals();
  });
});
