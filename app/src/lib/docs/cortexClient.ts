import { err, ok, type DaemonResult } from '@/types/daemon';
import type { DaemonClient } from '@/lib/daemon';

export interface CortexDocCitation {
  title: string;
  snippet: string;
  doc_id: string;
  anchor?: string | null;
  url?: string | null;
  source?: string | null;
  score?: number | null;
}

export interface CortexDocsSearchResponse {
  status?: 'ok' | 'degraded';
  query?: string;
  results: CortexDocCitation[];
  total?: number;
  corpus_hash?: string | null;
  api_version?: string | null;
}

export interface CortexDocsAnswerResponse {
  status?: 'ok' | 'degraded';
  answer: string;
  citations?: CortexDocCitation[];
  results?: CortexDocCitation[];
  corpus_hash?: string | null;
  api_version?: string | null;
  model?: string | null;
}

export interface CortexDocsSourcesResponse {
  status?: 'ok' | 'degraded';
  sources?: string[];
  corpus_hash?: string | null;
  last_refreshed?: string | null;
  api_version?: string | null;
}

export interface CortexDocsQuery {
  query: string;
  k?: number;
  min_score?: number;
  app?: string;
  source?: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const citation = (v: unknown): CortexDocCitation | null => {
  if (!isObject(v)) return null;
  const title = typeof v.title === 'string' ? v.title : 'Tytus documentation';
  const snippet = typeof v.snippet === 'string' ? v.snippet : '';
  const docId = typeof v.doc_id === 'string' ? v.doc_id : '';
  if (!docId) return null;
  return {
    title,
    snippet,
    doc_id: docId,
    anchor: typeof v.anchor === 'string' ? v.anchor : null,
    url: typeof v.url === 'string' ? v.url : null,
    source: typeof v.source === 'string' ? v.source : null,
    score: typeof v.score === 'number' ? v.score : null,
  };
};

const citations = (v: unknown): CortexDocCitation[] =>
  Array.isArray(v) ? v.map(citation).filter((x): x is CortexDocCitation => x !== null) : [];

const parseSearch = (body: unknown): DaemonResult<CortexDocsSearchResponse> => {
  if (!isObject(body)) {
    return err({ code: 'daemon_unhealthy', message: 'malformed /api/help/search' });
  }
  if (body.status === 'degraded') {
    return err({
      code: 'daemon_offline',
      message: typeof body.reason === 'string' ? body.reason : 'live docs degraded',
    });
  }
  return ok({
    status: body.status === 'ok' ? 'ok' : undefined,
    query: typeof body.query === 'string' ? body.query : undefined,
    results: citations(body.results),
    total: typeof body.total === 'number' ? body.total : undefined,
    corpus_hash: typeof body.corpus_hash === 'string' ? body.corpus_hash : null,
    api_version: typeof body.api_version === 'string' ? body.api_version : null,
  });
};

const parseAnswer = (body: unknown): DaemonResult<CortexDocsAnswerResponse> => {
  if (!isObject(body)) {
    return err({ code: 'daemon_unhealthy', message: 'malformed /api/help/answer' });
  }
  if (body.status === 'degraded') {
    return err({
      code: 'daemon_offline',
      message: typeof body.reason === 'string' ? body.reason : 'live docs degraded',
    });
  }
  return ok({
    status: body.status === 'ok' ? 'ok' : undefined,
    answer: typeof body.answer === 'string' ? body.answer : '',
    citations: citations(body.citations),
    results: citations(body.results),
    corpus_hash: typeof body.corpus_hash === 'string' ? body.corpus_hash : null,
    api_version: typeof body.api_version === 'string' ? body.api_version : null,
    model: typeof body.model === 'string' ? body.model : null,
  });
};

const parseSources = (body: unknown): DaemonResult<CortexDocsSourcesResponse> => {
  if (!isObject(body)) {
    return err({ code: 'daemon_unhealthy', message: 'malformed /api/help/sources' });
  }
  if (body.status === 'degraded') {
    return err({
      code: 'daemon_offline',
      message: typeof body.reason === 'string' ? body.reason : 'live docs degraded',
    });
  }
  return ok({
    status: body.status === 'ok' ? 'ok' : undefined,
    sources: Array.isArray(body.sources)
      ? body.sources.filter((s): s is string => typeof s === 'string')
      : undefined,
    corpus_hash: typeof body.corpus_hash === 'string' ? body.corpus_hash : null,
    last_refreshed: typeof body.last_refreshed === 'string' ? body.last_refreshed : null,
    api_version: typeof body.api_version === 'string' ? body.api_version : null,
  });
};

const json = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const request = async <T>(
  client: Pick<DaemonClient, 'baseUrl'>,
  path: string,
  init: RequestInit,
  parse: (body: unknown) => DaemonResult<T>,
): Promise<DaemonResult<T>> => {
  try {
    const res = await fetch(`${client.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      credentials: 'same-origin',
    });
    const body = await json(res);
    if (!res.ok) {
      const message =
        isObject(body) && typeof body.reason === 'string'
          ? body.reason
          : isObject(body) && typeof body.error === 'string'
            ? body.error
            : `daemon ${res.status}`;
      return err({
        code: res.status === 503 ? 'daemon_offline' : 'internal_error',
        message,
        status: res.status,
      });
    }
    return parse(body);
  } catch (cause) {
    return err({
      code: 'daemon_offline',
      message: cause instanceof Error ? cause.message : 'network error',
      cause,
    });
  }
};

export const getCortexDocsSources = (
  client: Pick<DaemonClient, 'baseUrl'>,
  signal?: AbortSignal,
) => request(client, '/api/help/sources', { signal }, parseSources);

export const searchCortexDocs = (
  client: Pick<DaemonClient, 'baseUrl'>,
  query: CortexDocsQuery,
  signal?: AbortSignal,
) =>
  request(
    client,
    '/api/help/search',
    { method: 'POST', body: JSON.stringify(query), signal },
    parseSearch,
  );

export const answerCortexDocs = (
  client: Pick<DaemonClient, 'baseUrl'>,
  query: CortexDocsQuery,
  signal?: AbortSignal,
) =>
  request(
    client,
    '/api/help/answer',
    { method: 'POST', body: JSON.stringify(query), signal },
    parseAnswer,
  );
