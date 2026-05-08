import type { AiGatewayPreference, AiModelInfo, DaemonApi } from '@tytus/host-api';
import { buildGatewayCandidates, type GatewayCandidate } from './gateway-candidates';
import { extractChatText, parseOpenAiSse, type OpenAiChatMessage } from './openai-stream';

export interface ChatResultChunk {
  token: string;
  candidate: GatewayCandidate;
}

export interface ChatCompleteInput {
  messages: OpenAiChatMessage[];
  model?: string;
  gatewayPreference?: AiGatewayPreference;
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

  candidates(preference: AiGatewayPreference = 'auto'): GatewayCandidate[] {
    const all = buildGatewayCandidates(this.daemon);
    const filtered = preference === 'local'
      ? all.filter((c) => c.source === 'local')
      : preference === 'remote'
        ? all.filter((c) => c.source !== 'local')
        : all;
    if (!this.lastGoodId) return filtered;
    const idx = filtered.findIndex((c) => c.id === this.lastGoodId);
    if (idx <= 0) return filtered;
    return [filtered[idx], ...filtered.slice(0, idx), ...filtered.slice(idx + 1)];
  }

  async status(signal?: AbortSignal, preference: AiGatewayPreference = 'auto') {
    const candidates = this.candidates(preference);
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
    const reason = preference === 'auto'
      ? 'All AIL gateway probes failed'
      : `No ${preference === 'remote' ? 'remote Tytus' : 'local'} AIL gateway reachable`;
    return { available: false, source: 'none', label: 'No AIL gateway reachable', reason } as const;
  }

  async listModels(input?: { gatewayPreference?: AiGatewayPreference; signal?: AbortSignal }): Promise<AiModelInfo[]> {
    const candidates = this.candidates(input?.gatewayPreference ?? 'auto');
    const out: AiModelInfo[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      try {
        const res = await this.fetchCandidate(candidate, '/models', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: withTimeout(input?.signal, 3500),
        });
        if (!res.ok) continue;
        const json = await res.json();
        const ids = extractModelIds(json);
        if (ids.length > 0) this.lastGoodId = candidate.id;
        for (const id of ids) {
          const key = `${candidate.id}:${id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ id, source: candidate.source, gatewayLabel: candidate.label });
        }
      } catch {
        // try next candidate
      }
    }
    return out;
  }

  async *chat(input: ChatCompleteInput): AsyncIterable<ChatResultChunk> {
    const preference = input.gatewayPreference ?? 'auto';
    const candidates = this.candidates(preference);
    if (candidates.length === 0) {
      throw new Error(preference === 'remote'
        ? 'No remote Tytus AIL gateway available. Choose Auto or Local AIL in Atomek Settings, or connect a Tytus AIL pod.'
        : 'No local AIL gateway available. Choose Auto or Remote Tytus AIL in Atomek Settings, or start switchAILocal.');
    }
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

const extractModelIds = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (typeof item === 'string' && item.trim()) ids.push(item.trim());
    else if (item && typeof item === 'object') {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string' && id.trim()) ids.push(id.trim());
    }
  }
  return Array.from(new Set(ids));
};
