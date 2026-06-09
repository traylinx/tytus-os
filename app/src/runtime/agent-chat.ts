import type { AgentChatEvent, AgentChatRequest } from '@tytus/host-api';

export interface RuntimeAgentChatOptions {
  appId: string;
  fetchImpl?: typeof fetch;
}

type AgentChatPayload = {
  route_id?: string;
  agent_identity_id?: string;
  message: string;
  session_id?: string | null;
  agent_mode: 'operator';
  chat_target: 'agent';
  app_id: string;
  model_preference: 'fast' | 'balanced' | 'deep';
  stream: true;
};

type ParsedSseBlock = {
  event: string;
  data: unknown;
};

const FALLBACK_STATUSES = new Set([404, 500, 502, 503, 504]);
const NO_FALLBACK_STATUSES = new Set([400, 401, 403]);
const REDACTION_TAIL_CHARS = 160;

export const sanitizeVisibleAgentText = (text: string): string =>
  text
    .replace(
      /https?:\/\/(?:(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(?::\d+)?[^\s)]*/gi,
      '[private gateway]',
    )
    .replace(
      /https?:\/\/[^\s)]*(?:strato|scalesys|wannolot|droplet|pod|gateway|route)[^\s)]*/gi,
      '[private gateway]',
    )
    .replace(
      /https?:\/\/[^\s)]*(?:tytus\.traylinx\.com|\.internal|\.local|digitalocean|do\.com|hetzner)[^\s)]*/gi,
      '[private gateway]',
    )
    .replace(/\b(?:fe80|fc00|fd[0-9a-f]{2}):[0-9a-f:]+(?:%[a-z0-9]+)?\b/gi, '[private host]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[private host]')
    .replace(/\broute[_-]?id\s*[:=]\s*[A-Za-z0-9._:-]+\b/gi, 'private route')
    .replace(/\bstrato-eu-[A-Za-z0-9._-]+\b/gi, 'agent runtime')
    .replace(/\bMiniMax-M[A-Za-z0-9._-]+\b/gi, 'current model')
    .replace(/\b(?:ail-compound|deepseek-[A-Za-z0-9._-]+|qwen[0-9A-Za-z._-]+|kimi-[A-Za-z0-9._-]+|moonshot-[A-Za-z0-9._-]+)\b/gi, 'current model')
    .replace(
      /\b(strato|scalesys|wannolot|digitalocean|hetzner|minimax|moonshot|kimi|deepseek|openrouter|alibaba|xiaomi|mimo|qwen|nous(?:\s+research)?)\b/gi,
      'private AI route',
    );

export const parseAgentSseBlock = (block: string): ParsedSseBlock | null => {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // Plain text chunks are valid for simple SSE bridges.
  }
  return { event, data };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

export const agentEventTextChunk = (data: unknown): string => {
  if (typeof data === 'string') return data === '[DONE]' ? '' : data;
  const obj = asRecord(data);
  if (!obj) return '';
  for (const key of ['chunk', 'content', 'delta', 'message', 'text']) {
    const value = obj[key];
    if (typeof value === 'string') return value;
  }
  const message = asRecord(obj.message);
  if (typeof message?.content === 'string') return message.content;
  const choices = Array.isArray(obj.choices) ? obj.choices : null;
  const first = asRecord(choices?.[0]);
  const delta = asRecord(first?.delta);
  const choiceMessage = asRecord(first?.message);
  if (typeof delta?.content === 'string') return delta.content;
  if (typeof choiceMessage?.content === 'string') return choiceMessage.content;
  if (typeof first?.text === 'string') return first.text;
  return '';
};

export const agentEventSessionId = (data: unknown): string | null => {
  const obj = asRecord(data);
  if (!obj) return null;
  const value = obj.session_id ?? obj.sessionId;
  return typeof value === 'string' && value.trim() ? value : null;
};

const agentEventErrorMessage = (data: unknown): string => {
  if (typeof data === 'string' && data.trim()) return data;
  const obj = asRecord(data);
  if (!obj) return 'Agent chat failed.';
  for (const key of ['message', 'error', 'detail']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  const nestedError = asRecord(obj.error);
  if (typeof nestedError?.message === 'string' && nestedError.message.trim()) {
    return nestedError.message;
  }
  return 'Agent chat failed.';
};

const isDoneData = (data: unknown): boolean => {
  if (data === '[DONE]') return true;
  const obj = asRecord(data);
  return obj?.done === true || obj?.finish_reason === 'stop';
};

const friendlyAgentError = (status: number | null, raw: string): AgentChatEvent => {
  const cleaned = sanitizeVisibleAgentText(raw || 'Agent chat failed.');
  const lowered = cleaned.toLowerCase();
  if (
    status === 408 ||
    status === 504 ||
    lowered.includes('timeout') ||
    lowered.includes('timed out')
  ) {
    return {
      type: 'error',
      message: 'Connection timed out. The agent may still be working. Try again.',
      retryable: true,
    };
  }
  if (
    status === 424 ||
    status === 503 ||
    lowered.includes('not ready') ||
    lowered.includes('warming') ||
    lowered.includes('starting') ||
    lowered.includes('unreachable')
  ) {
    return {
      type: 'error',
      message: 'Agent is warming up. Try again in a moment.',
      retryable: true,
    };
  }
  if (status === 404 || lowered.includes('not found') || lowered.includes('offline')) {
    return {
      type: 'error',
      message: 'Agent is offline. Restart the pod or pick another agent.',
      retryable: true,
    };
  }
  if (status === 401 || status === 403) {
    return {
      type: 'error',
      message: 'Sign in again to enable local agent chat.',
      retryable: false,
    };
  }
  return {
    type: 'error',
    message: cleaned || 'Agent chat failed. Try again in a moment.',
    retryable: status === null || status >= 500,
  };
};

const buildPayload = (request: AgentChatRequest, appId: string): AgentChatPayload => {
  const routeId = request.routeId?.trim();
  const agentIdentityId = request.agentIdentityId?.trim();
  return {
    ...(routeId ? { route_id: routeId } : {}),
    ...(agentIdentityId ? { agent_identity_id: agentIdentityId } : {}),
    message: request.message,
    session_id: request.sessionId ?? null,
    agent_mode: request.mode ?? 'operator',
    chat_target: request.target ?? 'agent',
    app_id: appId.trim() || 'tytus-os',
    model_preference: request.modelPreference ?? 'balanced',
    stream: true,
  };
};

const fetchAgent = (
  fetchImpl: typeof fetch,
  podId: string,
  path: 'cortex/chat' | 'agent/chat',
  payload: AgentChatPayload,
  signal?: AbortSignal,
): Promise<Response> =>
  fetchImpl(`/api/pods/${encodeURIComponent(podId)}/${path}`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream, application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
    signal,
  });

const readErrorBody = async (res: Response): Promise<string> => {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => null);
    return agentEventErrorMessage(body);
  }
  return res.text().catch(() => '') || res.statusText || `HTTP ${res.status}`;
};

async function* eventsFromSseResponse(res: Response): AsyncGenerator<AgentChatEvent> {
  if (!res.body) {
    yield friendlyAgentError(null, 'Agent stream is empty.');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  let errored = false;
  let redactionTail = '';

  const flushToken = function* (chunk: string, force = false): Generator<AgentChatEvent> {
    const combined = `${redactionTail}${chunk}`;
    if (!force && combined.length <= REDACTION_TAIL_CHARS) {
      redactionTail = combined;
      return;
    }
    const flushLength = force ? combined.length : combined.length - REDACTION_TAIL_CHARS;
    if (flushLength > 0) {
      const text = sanitizeVisibleAgentText(combined.slice(0, flushLength));
      if (text) yield { type: 'token', text };
    }
    redactionTail = force ? '' : combined.slice(flushLength);
  };

  const consumeBlock = function* (block: string): Generator<AgentChatEvent> {
    const parsed = parseAgentSseBlock(block);
    if (!parsed) return;
    // Sprint 2026-05-21-chat-with-pods-local-cortex-parity:
    // tray daemon injects `event: profile` as the FIRST frame of every
    // cortex/chat stream. Apps use it to label which Cortex served the
    // chat ("Cloud Cortex" vs "Local Cortex"). Tolerate the data shape
    // being missing — fall through to the cloud default rather than
    // breaking the rest of the stream.
    if (parsed.event === 'profile') {
      const obj = asRecord(parsed.data);
      const rawProfile = obj?.profile;
      const profile: 'cloud' | 'local' =
        rawProfile === 'local' ? 'local' : 'cloud';
      const cortexVersion =
        typeof obj?.cortex_version === 'string'
          ? (obj.cortex_version as string)
          : undefined;
      yield cortexVersion
        ? { type: 'profile', profile, cortexVersion }
        : { type: 'profile', profile };
      return;
    }
    if (parsed.event === 'error') {
      yield friendlyAgentError(null, agentEventErrorMessage(parsed.data));
      errored = true;
      finished = true;
      return;
    }
    const sessionId = agentEventSessionId(parsed.data);
    if (sessionId) yield { type: 'session', sessionId };
    if (parsed.event === 'done' || isDoneData(parsed.data)) {
      finished = true;
      return;
    }
    const chunk = agentEventTextChunk(parsed.data);
    if (chunk) yield* flushToken(chunk);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      yield* consumeBlock(part);
      if (finished) break;
    }
    if (done || finished) break;
  }
  if (!finished && buffer.trim()) {
    yield* consumeBlock(buffer);
  }
  yield* flushToken('', true);
  if (!errored) yield { type: 'done' };
}

async function* eventsFromJsonResponse(res: Response): AsyncGenerator<AgentChatEvent> {
  const raw = await res.text().catch(() => '');
  let body: unknown = raw;
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  } else {
    body = null;
  }
  const sessionId = agentEventSessionId(body);
  if (sessionId) yield { type: 'session', sessionId };
  const text = sanitizeVisibleAgentText(agentEventTextChunk(body));
  if (text) yield { type: 'token', text };
  yield { type: 'done' };
}

async function* eventsFromResponse(res: Response): AsyncGenerator<AgentChatEvent> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    yield* eventsFromSseResponse(res);
  } else {
    yield* eventsFromJsonResponse(res);
  }
}

export async function* streamAgentChat(
  request: AgentChatRequest,
  opts: RuntimeAgentChatOptions,
): AsyncGenerator<AgentChatEvent> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const podId = request.podId.trim();
  const message = request.message.trim();

  if (!podId) {
    yield { type: 'error', message: 'Agent is offline. Restart the pod or pick another agent.', retryable: true };
    return;
  }
  if (!message) {
    yield { type: 'error', message: 'Message is required.', retryable: false };
    return;
  }

  const payload = buildPayload({ ...request, message }, opts.appId);

  let primary: Response;
  try {
    primary = await fetchAgent(fetchImpl, podId, 'cortex/chat', payload, request.signal);
  } catch (err) {
    if (request.signal?.aborted) return;
    yield friendlyAgentError(null, err instanceof Error ? err.message : 'Agent chat failed.');
    return;
  }

  if (primary.ok) {
    yield* eventsFromResponse(primary);
    return;
  }

  const primaryMessage = await readErrorBody(primary);
  if (NO_FALLBACK_STATUSES.has(primary.status) || !FALLBACK_STATUSES.has(primary.status)) {
    yield friendlyAgentError(primary.status, primaryMessage);
    return;
  }

  let fallback: Response;
  try {
    fallback = await fetchAgent(fetchImpl, podId, 'agent/chat', payload, request.signal);
  } catch (err) {
    if (request.signal?.aborted) return;
    yield friendlyAgentError(null, err instanceof Error ? err.message : primaryMessage);
    return;
  }

  if (!fallback.ok) {
    yield friendlyAgentError(fallback.status, await readErrorBody(fallback));
    return;
  }

  yield* eventsFromResponse(fallback);
}
