// brainBridge tests — exercise appendMemo + searchBacklinks against an
// injected fetchImpl. Same shape as host-api/src/daemon/clients.test.ts:
// the bridge wraps createDaemonClient, so we don't re-test the daemon
// client's HTTP plumbing (4xx mapping, network-error wrapping, etc.) —
// we only assert what the bridge ITSELF contributes:
//
//   - the URL/method shape that downstream Brain endpoints expect
//   - the Logseq-outliner-formatted body (the bridge's only piece of
//     business logic)
//   - signal propagation
//   - error propagation (DaemonClientError surfaces unchanged)

import { describe, it, expect, vi } from 'vitest';
import { createBrainBridge } from './brainBridge';
import { DaemonClientError, type BrainSearchResult } from '@tytus/host-api';

const baseUrl = 'http://daemon.local';

type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function makeFetch(handler: FetchImpl) {
  return vi.fn(handler);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function firstCall(fetchImpl: ReturnType<typeof makeFetch>): {
  url: string;
  init: RequestInit;
} {
  const calls = fetchImpl.mock.calls;
  if (calls.length === 0) {
    throw new Error('fetchImpl was not called');
  }
  const call = calls[0] as [RequestInfo | URL, RequestInit | undefined];
  return { url: String(call[0]), init: call[1] ?? {} };
}

describe('createBrainBridge — appendMemo', () => {
  it('POSTs an outliner-formatted entry to /api/brain/append', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(200, { id: 'note-7' }),
    );
    const bridge = createBrainBridge({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await bridge.appendMemo(
      'shopping-list',
      'Shopping list',
      'eggs\nmilk',
    );
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe('http://daemon.local/api/brain/append');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(init.body as string) as {
      kind: string;
      body: string;
      sourceApp?: string;
      tags?: string[];
    };
    expect(parsed.kind).toBe('journal');
    expect(parsed.body).toBe(
      '- [[shopping-list]] Shopping list\n  - eggs\n  - milk',
    );
    expect(parsed.sourceApp).toBe('memo');
    expect(parsed.tags).toEqual(['memo', 'slug:shopping-list']);
  });

  it('handles empty bodies — emits the parent bullet plus one empty child', async () => {
    // The split('\n') of an empty string yields [''], so we still get
    // one child bullet (`  - `). This keeps the shape consistent with
    // non-empty bodies and makes the entry valid Logseq outliner.
    const fetchImpl = makeFetch(async () =>
      jsonResponse(200, { id: 'note-8' }),
    );
    const bridge = createBrainBridge({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await bridge.appendMemo('blank', 'Blank', '');
    const { init } = firstCall(fetchImpl);
    const parsed = JSON.parse(init.body as string) as { body: string };
    expect(parsed.body).toBe('- [[blank]] Blank\n  - ');
  });

  it('propagates AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const fetchImpl = makeFetch(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse(200, { id: 'note-9' });
    });
    const bridge = createBrainBridge({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await bridge.appendMemo('x', 'X', 'body', controller.signal);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('propagates DaemonClientError on 4xx', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(403, { error: 'no permission' }),
    );
    const bridge = createBrainBridge({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      bridge.appendMemo('x', 'X', 'b'),
    ).rejects.toBeInstanceOf(DaemonClientError);
  });

  it('propagates DaemonClientError on 5xx', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(503, { error: 'overloaded' }),
    );
    const bridge = createBrainBridge({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      bridge.appendMemo('x', 'X', 'b'),
    ).rejects.toMatchObject({
      name: 'DaemonClientError',
      statusCode: 503,
    });
  });
});

describe('createBrainBridge — searchBacklinks', () => {
  it('GETs /api/brain/search?q=[[slug]]&limit=20 and returns the array', async () => {
    const results: BrainSearchResult[] = [
      {
        id: 'r1',
        snippet: 'a journal line citing [[shopping-list]]',
        score: 0.91,
        source: { kind: 'journal', path: 'journals/2026_05_03.md' },
      },
      {
        id: 'r2',
        snippet: '... refer to [[shopping-list]] for the full list',
        score: 0.55,
        source: { kind: 'page', path: 'pages/Errands.md' },
      },
    ];
    const fetchImpl = makeFetch(async () => jsonResponse(200, results));
    const bridge = createBrainBridge({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await bridge.searchBacklinks('shopping-list');
    expect(got).toEqual(results);
    const { url, init } = firstCall(fetchImpl);
    // URLSearchParams encodes [ and ] — the daemon decodes them back.
    expect(url).toBe(
      'http://daemon.local/api/brain/search?q=%5B%5Bshopping-list%5D%5D&limit=20',
    );
    expect(init.method).toBe('GET');
  });

  it('propagates AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const fetchImpl = makeFetch(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse(200, []);
    });
    const bridge = createBrainBridge({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await bridge.searchBacklinks('x', controller.signal);
    expect(got).toEqual([]);
  });

  it('propagates DaemonClientError on 4xx', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(404, { error: 'no index' }),
    );
    const bridge = createBrainBridge({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      bridge.searchBacklinks('x'),
    ).rejects.toBeInstanceOf(DaemonClientError);
  });
});
