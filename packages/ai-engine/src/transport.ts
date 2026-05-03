/**
 * Pod transport — the boundary between the engine's pure-TS request
 * machinery and the actual fetch against the gateway. Production
 * implementations route through `host.daemon.callPodEndpoint` so the
 * gateway key never crosses package boundaries; tests inject a mock
 * that yields canned SSE bytes.
 *
 * Per spec §"Router (pod-only in v1)" + §"Engine event stream".
 */

import type { HostClient } from '@tytus/host-api';
import type { Endpoint, ModelInfo } from './router';
import type { SsePodResponse } from './stream';
import type { ToolDef } from './types';

/** OpenAI-shape chat message. The engine renders prompts + history into
 *  this list before calling the transport. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For role=tool: the tool_call_id this message responds to. */
  tool_call_id?: string;
  /** For role=assistant with tool calls. */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** OpenAI-shape tools schema array. The engine builds this from the
   *  registered ToolDefs (runtime conversion). */
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: ToolDef['parameters'];
    };
  }>;
  /** Forces the model to call propose_patches when intent === 'edit'. */
  tool_choice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };
  stream: true;
}

export interface PodTransport {
  /** POST a chat-completion request to the active pod. Returns an SSE
   *  response whose events are EngineEvent JSON payloads. The transport
   *  implementation translates from the gateway's wire format (e.g.
   *  OpenAI streaming) into the engine's EngineEvent shape so the
   *  consumer doesn't need to know which gateway is upstream. */
  chat(req: ChatRequest, opts: { signal?: AbortSignal }): Promise<SsePodResponse>;
}

/** Build a transport that POSTs through `host.daemon.callPodEndpoint`.
 *  Production callers use this; tests inject their own. */
export function makeHostPodTransport(
  host: HostClient,
  endpoint: Endpoint,
): PodTransport {
  return {
    async chat(req, opts) {
      const res = await host.daemon.callPodEndpoint(
        endpoint.podId,
        '/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify(req),
          signal: opts.signal,
        },
      );
      if (!res.ok) {
        throw new Error(
          `pod gateway returned ${res.status}: ${await res.text().catch(() => '')}`,
        );
      }
      // Adapt the Response body (ReadableStream<Uint8Array>) to our
      // SsePodResponse shape. The engine assumes the gateway already
      // emits engine-shaped events; the gateway translation layer (M3+
      // when Music Creator's gateway moves) ensures this.
      return {
        body: streamFromReadable(res.body),
      };
    },
  };
}

async function* streamFromReadable(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Convert a ToolDef list into the OpenAI tools schema shape that the
 *  gateway expects. Pure function. */
export function toOpenAiTools(tools: ToolDef[]): ChatRequest['tools'] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export type { ModelInfo };
