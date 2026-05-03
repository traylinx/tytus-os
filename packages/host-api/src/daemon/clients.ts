/**
 * Typed HTTP client for the Tytus daemon — apps call `postAiUsage`,
 * `getBrainSearch`, and `postBrainAppend` instead of hand-rolling fetch.
 * The daemon process itself lives in a separate repo; this is the
 * host-side scaffold that the shell wires once per session.
 */

import {
  DaemonClientError,
  type BrainEntry,
  type BrainSearchResult,
  type UsageRecord,
} from './types';

export interface CreateDaemonClientOpts {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface DaemonClient {
  postAiUsage(
    record: UsageRecord,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
  getBrainSearch(
    q: string,
    opts?: { limit?: number; signal?: AbortSignal },
  ): Promise<BrainSearchResult[]>;
  postBrainAppend(
    entry: BrainEntry,
    opts?: { signal?: AbortSignal },
  ): Promise<{ id: string }>;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}

function buildHeaders(apiKey: string | undefined, json: boolean): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) {
    headers['Content-Type'] = 'application/json';
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

async function readBody(response: Response): Promise<unknown> {
  // Best-effort body read for both success and error paths. JSON is
  // preferred, but a non-JSON body still surfaces as a string so the
  // caller can log it instead of getting a useless empty object.
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function performRequest(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : 'daemon request failed';
    throw new DaemonClientError(message, {
      statusCode: null,
      body: null,
      cause,
    });
  }
}

async function ensureOk(
  response: Response,
  context: string,
): Promise<unknown> {
  const body = await readBody(response);
  if (!response.ok) {
    throw new DaemonClientError(
      `${context} failed: ${response.status} ${response.statusText}`,
      { statusCode: response.status, body },
    );
  }
  return body;
}

export function createDaemonClient(
  opts: CreateDaemonClientOpts,
): DaemonClient {
  const { baseUrl, apiKey } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async postAiUsage(record, callOpts) {
      const response = await performRequest(
        fetchImpl,
        joinUrl(baseUrl, '/api/ai/usage'),
        {
          method: 'POST',
          headers: buildHeaders(apiKey, true),
          body: JSON.stringify(record),
          signal: callOpts?.signal,
        },
      );
      await ensureOk(response, 'postAiUsage');
    },

    async getBrainSearch(q, callOpts) {
      const params = new URLSearchParams({ q });
      if (callOpts?.limit !== undefined) {
        params.set('limit', String(callOpts.limit));
      }
      const response = await performRequest(
        fetchImpl,
        joinUrl(baseUrl, `/api/brain/search?${params.toString()}`),
        {
          method: 'GET',
          headers: buildHeaders(apiKey, false),
          signal: callOpts?.signal,
        },
      );
      const body = await ensureOk(response, 'getBrainSearch');
      if (!Array.isArray(body)) {
        throw new DaemonClientError(
          'getBrainSearch: expected array body',
          { statusCode: response.status, body },
        );
      }
      return body as BrainSearchResult[];
    },

    async postBrainAppend(entry, callOpts) {
      const response = await performRequest(
        fetchImpl,
        joinUrl(baseUrl, '/api/brain/append'),
        {
          method: 'POST',
          headers: buildHeaders(apiKey, true),
          body: JSON.stringify(entry),
          signal: callOpts?.signal,
        },
      );
      const body = await ensureOk(response, 'postBrainAppend');
      if (
        !body ||
        typeof body !== 'object' ||
        typeof (body as { id?: unknown }).id !== 'string'
      ) {
        throw new DaemonClientError(
          'postBrainAppend: expected {id: string} body',
          { statusCode: response.status, body },
        );
      }
      return { id: (body as { id: string }).id };
    },
  };
}
