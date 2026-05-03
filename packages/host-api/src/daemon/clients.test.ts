/**
 * Tests for createDaemonClient — every method, every error mapping.
 * Uses an injected fetchImpl so we never touch global.fetch.
 */

import { describe, expect, it, vi } from 'vitest';
import { createDaemonClient } from './clients';
import { DaemonClientError, type UsageRecord } from './types';

const baseUrl = 'http://daemon.local';

type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function makeFetch(handler: FetchImpl) {
  return vi.fn(handler);
}

function jsonResponse(
  status: number,
  body: unknown,
  init?: ResponseInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

function makeUsageRecord(): UsageRecord {
  return {
    txId: 'tx-1',
    sessionId: 'sess-1',
    mode: 'default',
    model: 'gpt-4o',
    promptVersion: '2026-05-03.1',
    promptTokens: 100,
    completionTokens: 50,
    durationMs: 1234,
    accepted: null,
    finalState: null,
    ghostAccepted: 0,
    ghostRejected: 0,
    relevanceFeedback: null,
    hunksApplied: null,
    hunksTotal: null,
    createdAt: 1700000000000,
  };
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

describe('createDaemonClient — postAiUsage', () => {
  it('POSTs JSON to /api/ai/usage and resolves on 2xx', async () => {
    const fetchImpl = makeFetch(async () => new Response(null, { status: 204 }));
    const client = createDaemonClient({
      baseUrl,
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.postAiUsage(makeUsageRecord())).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe('http://daemon.local/api/ai/usage');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer k');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(makeUsageRecord()));
  });

  it('omits Authorization header when apiKey is absent', async () => {
    const fetchImpl = makeFetch(async () => new Response(null, { status: 204 }));
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.postAiUsage(makeUsageRecord());
    const { init } = firstCall(fetchImpl);
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('throws DaemonClientError with statusCode + body on 4xx', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(400, { error: 'bad payload' }),
    );
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.postAiUsage(makeUsageRecord())).rejects.toMatchObject({
      name: 'DaemonClientError',
      statusCode: 400,
      body: { error: 'bad payload' },
    });
  });

  it('throws DaemonClientError on 5xx', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(503, { error: 'overloaded' }),
    );
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.postAiUsage(makeUsageRecord())).rejects.toMatchObject({
      statusCode: 503,
      body: { error: 'overloaded' },
    });
  });

  it('falls back to raw text body when error payload is not JSON', async () => {
    const fetchImpl = makeFetch(async () =>
      textResponse(500, '<html>oops</html>'),
    );
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.postAiUsage(makeUsageRecord())).rejects.toMatchObject({
      statusCode: 500,
      body: '<html>oops</html>',
    });
  });

  it('wraps a network error in DaemonClientError', async () => {
    const cause = new Error('ECONNREFUSED');
    const fetchImpl = makeFetch(async () => {
      throw cause;
    });
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    let caught: unknown;
    try {
      await client.postAiUsage(makeUsageRecord());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DaemonClientError);
    expect((caught as DaemonClientError).statusCode).toBeNull();
    expect((caught as DaemonClientError).cause).toBe(cause);
  });

  it('propagates AbortSignal to fetch and surfaces aborts', async () => {
    const controller = new AbortController();
    const cause = new DOMException('aborted', 'AbortError');
    const fetchImpl = makeFetch(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      throw cause;
    });
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    controller.abort();
    await expect(
      client.postAiUsage(makeUsageRecord(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(DaemonClientError);
  });
});

describe('createDaemonClient — getBrainSearch', () => {
  it('GETs /api/brain/search with q + limit and returns the array', async () => {
    const results = [
      {
        id: 'r1',
        snippet: 'snip',
        score: 0.9,
        source: { kind: 'page', path: 'pages/foo.md' },
      },
    ];
    const fetchImpl = makeFetch(async () => jsonResponse(200, results));
    const client = createDaemonClient({
      baseUrl,
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await client.getBrainSearch('hello', { limit: 5 });
    expect(got).toEqual(results);
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe('http://daemon.local/api/brain/search?q=hello&limit=5');
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer k');
  });

  it('throws DaemonClientError on 4xx with parsed body', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(404, { error: 'no index' }),
    );
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getBrainSearch('x')).rejects.toMatchObject({
      statusCode: 404,
      body: { error: 'no index' },
    });
  });

  it('throws when 200 body is not an array', async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(200, { wrong: true }));
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getBrainSearch('x')).rejects.toBeInstanceOf(
      DaemonClientError,
    );
  });

  it('forwards AbortSignal', async () => {
    const controller = new AbortController();
    const fetchImpl = makeFetch(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse(200, []);
    });
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.getBrainSearch('x', { signal: controller.signal });
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe('createDaemonClient — postBrainAppend', () => {
  it('POSTs entry and returns the id', async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(200, { id: 'note-42' }));
    const client = createDaemonClient({
      baseUrl,
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await client.postBrainAppend({
      kind: 'memo',
      body: 'hello',
      tags: ['x'],
    });
    expect(got).toEqual({ id: 'note-42' });
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe('http://daemon.local/api/brain/append');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ kind: 'memo', body: 'hello', tags: ['x'] }),
    );
  });

  it('throws DaemonClientError on 5xx', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(500, { error: 'disk full' }),
    );
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      client.postBrainAppend({ kind: 'journal', body: 'b' }),
    ).rejects.toMatchObject({
      statusCode: 500,
      body: { error: 'disk full' },
    });
  });

  it('throws when 2xx body is missing id', async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(200, { wrong: true }));
    const client = createDaemonClient({
      baseUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      client.postBrainAppend({ kind: 'memo', body: 'x' }),
    ).rejects.toBeInstanceOf(DaemonClientError);
  });
});

describe('createDaemonClient — baseUrl handling', () => {
  it('strips trailing slash from baseUrl', async () => {
    const fetchImpl = makeFetch(async () => new Response(null, { status: 204 }));
    const client = createDaemonClient({
      baseUrl: 'http://daemon.local/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.postAiUsage(makeUsageRecord());
    const { url } = firstCall(fetchImpl);
    expect(url).toBe('http://daemon.local/api/ai/usage');
  });
});
