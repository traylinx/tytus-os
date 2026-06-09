import { describe, expect, it, vi } from 'vitest';
import {
  parseAgentSseBlock,
  sanitizeVisibleAgentText,
  streamAgentChat,
} from './agent-chat';
import type { AgentChatEvent } from '@tytus/host-api';

const collect = async (iterable: AsyncIterable<AgentChatEvent>) => {
  const events: AgentChatEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
};

const sseResponse = (body: string, status = 200): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status, headers: { 'Content-Type': 'text/event-stream' } },
  );

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('agent-chat runtime bridge', () => {
  it('parses SSE blocks', () => {
    expect(parseAgentSseBlock('event: token\ndata: {"chunk":"hi"}')).toEqual({
      event: 'token',
      data: { chunk: 'hi' },
    });
  });

  it('redacts provider, model, route and network details', () => {
    const sanitized = sanitizeVisibleAgentText(
      'MiniMax-M2 at http://10.42.1.2:18080/v1 via strato-eu-1 route_id=abc and DeepSeek.',
    );
    expect(sanitized).not.toMatch(/MiniMax|10\.42|strato-eu-1|route_id|DeepSeek/i);
    expect(sanitized).toContain('current model');
    expect(sanitized).toContain('[private gateway]');
  });

  // Sprint 2026-05-21-chat-with-pods-local-cortex-parity:
  it('emits a profile event when the tray daemon injects event:profile first', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse(
        [
          'event: profile\ndata: {"profile":"local","cortex_version":"2026-05-17"}',
          'data: {"session_id":"sess_local"}',
          'data: {"chunk":"hi"}',
          'event: done\ndata: {}',
          '',
        ].join('\n\n'),
      ),
    );
    const events = await collect(
      streamAgentChat(
        { podId: 'pod-1', message: 'hi' },
        { appId: 'atomek', fetchImpl },
      ),
    );
    // Profile must be the first event so apps can label the chat
    // accurately before the first token renders.
    expect(events[0]).toEqual({
      type: 'profile',
      profile: 'local',
      cortexVersion: '2026-05-17',
    });
    expect(events.find((e) => e.type === 'session')).toEqual({
      type: 'session',
      sessionId: 'sess_local',
    });
  });

  it('defaults profile event to cloud when payload is missing or malformed', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse(
        [
          'event: profile\ndata: {}',
          'event: done\ndata: {}',
          '',
        ].join('\n\n'),
      ),
    );
    const events = await collect(
      streamAgentChat(
        { podId: 'pod-1', message: 'hi' },
        { appId: 'atomek', fetchImpl },
      ),
    );
    // Default to cloud rather than skipping the frame entirely — apps
    // get a consistent contract regardless of upstream daemon version.
    expect(events[0]).toEqual({ type: 'profile', profile: 'cloud' });
  });

  it('streams sanitized session, token, and done events from Cortex SSE', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse(
        [
          'data: {"session_id":"sess_1"}',
          'data: {"chunk":"Hello from MiniMax-M2 at http://10.0.0.4:18080"}',
          'event: done\ndata: {}',
          '',
        ].join('\n\n'),
      ),
    );

    const events = await collect(
      streamAgentChat(
        { podId: 'pod-1', message: 'status', sessionId: 'prev' },
        { appId: 'atomek', fetchImpl },
      ),
    );

    expect(events[0]).toEqual({ type: 'session', sessionId: 'sess_1' });
    const token = events.find((event) => event.type === 'token');
    expect(token).toMatchObject({ type: 'token' });
    expect(token && 'text' in token ? token.text : '').not.toMatch(/MiniMax|10\.0\.0\.4/);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('falls back from Cortex 503 to direct agent chat and propagates app_id', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const parsed = JSON.parse(String((init as RequestInit).body));
      expect(parsed.app_id).toBe('atomek');
      expect(parsed.route_id).toBe('route-1');
      expect(parsed.agent_identity_id).toBe('aid-hermie');
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('Authorization')).toBeNull();
      if (String(url).endsWith('/cortex/chat')) {
        return jsonResponse({ message: 'warming' }, 503);
      }
      return jsonResponse({ message: 'Direct answer via DeepSeek', session_id: 'sess_2' });
    });

    const events = await collect(
      streamAgentChat(
        { podId: 'pod-1', routeId: 'route-1', agentIdentityId: 'aid-hermie', message: 'status' },
        { appId: 'atomek', fetchImpl },
      ),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      '/api/pods/pod-1/cortex/chat',
      '/api/pods/pod-1/agent/chat',
    ]);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'sess_2' });
    const token = events.find((event) => event.type === 'token');
    expect(token && 'text' in token ? token.text : '').not.toMatch(/DeepSeek/i);
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('falls back from Cortex 500 before the stream opens', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/cortex/chat')) {
        return jsonResponse({ message: 'cortex internal error from MiniMax route' }, 500);
      }
      return jsonResponse({ message: 'Direct fallback answer from DeepSeek' });
    });

    const events = await collect(
      streamAgentChat(
        { podId: 'pod-1', message: 'status' },
        { appId: 'atomek', fetchImpl },
      ),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      '/api/pods/pod-1/cortex/chat',
      '/api/pods/pod-1/agent/chat',
    ]);
    const token = events.find((event) => event.type === 'token');
    expect(token && 'text' in token ? token.text : '').not.toMatch(/DeepSeek/i);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('does not fallback on auth failures', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: 'forbidden by MiniMax route' }, 403),
    );

    const events = await collect(
      streamAgentChat(
        { podId: 'pod-1', message: 'status' },
        { appId: 'atomek', fetchImpl },
      ),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        type: 'error',
        message: 'Sign in again to enable local agent chat.',
        retryable: false,
      },
    ]);
  });

  it('streams safe text from non-SSE text responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response('Plain answer from http://10.0.0.9:18080', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const events = await collect(
      streamAgentChat(
        { podId: 'pod-1', message: 'status' },
        { appId: 'atomek', fetchImpl },
      ),
    );

    const token = events.find((event) => event.type === 'token');
    expect(token && 'text' in token ? token.text : '').toContain('[private gateway]');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
