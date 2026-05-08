import type { DaemonApi } from '@tytus/host-api';
import { buildGatewayCandidates, type GatewayCandidate } from './gateway-candidates';
import { extractChatText, parseOpenAiSse, type OpenAiChatMessage } from './openai-stream';

export interface ChatResultChunk {
  token: string;
  candidate: GatewayCandidate;
}

export interface ChatCompleteInput {
  messages: OpenAiChatMessage[];
  model?: string;
  signal?: AbortSignal;
}

const withTimeout = (signal: AbortSignal | undefined, ms: number): AbortSignal => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  });
  return controller.signal;
};

const retryable = (status: number): boolean => status === 408 || status === 429 || status >= 500;

export class LlmGateway {
  private lastGoodId: string | null = null;
  private readonly daemon: DaemonApi;

  constructor(daemon: DaemonApi) {
    this.daemon = daemon;
  }

  candidates(): GatewayCandidate[] {
    const all = buildGatewayCandidates(this.daemon);
    if (!this.lastGoodId) return all;
    const idx = all.findIndex((c) => c.id === this.lastGoodId);
    if (idx <= 0) return all;
    return [all[idx], ...all.slice(0, idx), ...all.slice(idx + 1)];
  }

  async status(signal?: AbortSignal) {
    const candidates = this.candidates();
    for (const candidate of candidates) {
      try {
        const res = await this.fetchCandidate(candidate, '/models', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: withTimeout(signal, 2500),
        });
        if (res.ok) {
          this.lastGoodId = candidate.id;
          return { available: true, source: candidate.source, label: candidate.label } as const;
        }
      } catch {
        // try next candidate
      }
    }
    return { available: false, source: 'none', label: 'No AIL gateway reachable', reason: 'All AIL gateway probes failed' } as const;
  }

  async *chat(input: ChatCompleteInput): AsyncIterable<ChatResultChunk> {
    const candidates = this.candidates();
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const res = await this.fetchCandidate(candidate, '/chat/completions', {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream, application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: input.model ?? 'auto',
            stream: true,
            messages: input.messages,
          }),
          signal: input.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = new Error(`AIL ${candidate.label} failed HTTP ${res.status}: ${text.slice(0, 400)}`);
          if (retryable(res.status)) {
            lastError = err;
            continue;
          }
          throw err;
        }
        this.lastGoodId = candidate.id;
        const contentType = res.headers.get('content-type') ?? '';
        if (res.body && contentType.includes('text/event-stream')) {
          for await (const token of parseOpenAiSse(res.body)) {
            yield { token, candidate };
          }
          return;
        }
        const json = await res.json();
        const text = extractChatText(json);
        if (text) yield { token: text, candidate };
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'No AIL gateway reachable'));
  }

  private fetchCandidate(candidate: GatewayCandidate, path: string, init: RequestInit): Promise<Response> {
    if (candidate.callViaHost && candidate.podId) {
      const hostPath = path.startsWith('/v1/') ? path : `/v1${path}`;
      return this.daemon.callPodEndpoint(candidate.podId, hostPath, init);
    }
    const headers = new Headers(init.headers ?? {});
    if (candidate.apiKey) headers.set('Authorization', `Bearer ${candidate.apiKey}`);
    return fetch(`${candidate.baseUrl}${path}`, { ...init, headers });
  }
}
