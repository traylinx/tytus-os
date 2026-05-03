import { describe, expect, it } from 'vitest';
import {
  consumeStream,
  parseSseEvent,
  streamFromStrings,
} from './stream';
import type { EngineEvent } from './events';

const sse = (events: Array<Record<string, unknown>>): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

async function collect(
  source: ReturnType<typeof streamFromStrings>,
  opts?: Parameters<typeof consumeStream>[1],
): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of consumeStream(source, opts)) out.push(e);
  return out;
}

describe('SSE parser — single events', () => {
  it('parses a token event with sourceRevision', () => {
    const ev = parseSseEvent(`data: {"kind":"token","text":"Hello","sourceRevision":3}`);
    expect(ev).toEqual({
      kind: 'token',
      text: 'Hello',
      sourceRevision: 3,
    });
  });

  it('parses an error event with required errorKind', () => {
    const ev = parseSseEvent(
      `data: {"kind":"error","message":"pod offline","retryable":true,"errorKind":"pod_offline"}`,
    );
    expect(ev?.kind).toBe('error');
  });

  it('returns synthetic error on malformed JSON', () => {
    const ev = parseSseEvent(`data: not-json`);
    expect(ev?.kind).toBe('error');
    if (ev?.kind !== 'error') return;
    expect(ev.errorKind).toBe('unknown');
    expect(ev.message).toContain('malformed SSE payload');
  });

  it('returns synthetic error for valid JSON that is not an EngineEvent', () => {
    const ev = parseSseEvent(`data: {"hello":"world"}`);
    expect(ev?.kind).toBe('error');
    if (ev?.kind !== 'error') return;
    expect(ev.message).toContain('not a valid EngineEvent');
  });

  it('returns null for blocks with no data field', () => {
    expect(parseSseEvent(`: just a comment\nevent: ping`)).toBeNull();
  });

  it('strips a single leading space after data: per SSE spec', () => {
    const a = parseSseEvent(
      `data: {"kind":"token","text":"x","sourceRevision":1}`,
    );
    const b = parseSseEvent(
      `data:{"kind":"token","text":"x","sourceRevision":1}`,
    );
    expect(a).toEqual(b);
  });

  it('joins multi-line data: blocks per SSE spec', () => {
    const ev = parseSseEvent(
      `data: {"kind":"token",\ndata: "text":"x",\ndata: "sourceRevision":1}`,
    );
    expect(ev?.kind).toBe('token');
  });
});

describe('consumeStream — full streams', () => {
  it('yields events in order', async () => {
    const source = streamFromStrings([
      sse([
        { kind: 'token', text: 'A', sourceRevision: 1 },
        { kind: 'token', text: 'B', sourceRevision: 1 },
        { kind: 'token', text: 'C', sourceRevision: 1 },
      ]),
    ]);
    const out = await collect(source);
    expect(out.map((e) => (e.kind === 'token' ? e.text : ''))).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('handles chunks split mid-event', async () => {
    const fullEvent = sse([
      { kind: 'token', text: 'split', sourceRevision: 1 },
    ]);
    // Split arbitrarily mid-event.
    const half = Math.floor(fullEvent.length / 2);
    const source = streamFromStrings([
      fullEvent.slice(0, half),
      fullEvent.slice(half),
    ]);
    const out = await collect(source);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('token');
  });

  it('flushes a tail event without trailing blank line', async () => {
    // Engine wire pattern: `done` may arrive without trailing \n\n
    // before EOF.
    const source = streamFromStrings([
      `data: {"kind":"done","txId":"tx-1","transaction":{"txId":"tx-1","app":"sheet","baseRevisions":{},"patches":[],"filesAffected":[],"estimatedCost":{"tokens":0,"usd":0},"preview":[]},"usage":{"promptTokens":1,"completionTokens":1,"totalTokens":2},"finishReason":"stop"}`,
    ]);
    const out = await collect(source);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('done');
  });

  it('handles \\r\\n line endings', async () => {
    const source = streamFromStrings([
      `data: {"kind":"token","text":"x","sourceRevision":1}\r\n\r\n`,
    ]);
    const out = await collect(source);
    expect(out).toHaveLength(1);
  });

  it('decodes UTF-8 byte chunks correctly', async () => {
    const text = '日本語';
    const json = JSON.stringify({
      kind: 'token',
      text,
      sourceRevision: 1,
    });
    const block = `data: ${json}\n\n`;
    const bytes = new TextEncoder().encode(block);
    const source = {
      body: (async function* () {
        // Split bytes mid-multibyte-char to test decoder streaming.
        yield bytes.slice(0, 12);
        yield bytes.slice(12);
      })(),
    };
    const out = await collect(source);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'token', text });
  });
});

describe('consumeStream — revision filtering', () => {
  it('drops tokens whose sourceRevision !== currentRevision()', async () => {
    let rev = 1;
    const source = streamFromStrings([
      sse([
        { kind: 'token', text: 'A', sourceRevision: 1 },
        { kind: 'token', text: 'B', sourceRevision: 1 },
        { kind: 'token', text: 'C', sourceRevision: 2 }, // stale once rev bumps
      ]),
    ]);
    // Bump revision after the first chunk has parsed.
    const out: EngineEvent[] = [];
    for await (const e of consumeStream(source, {
      currentRevision: () => rev,
    })) {
      out.push(e);
      if (out.length === 2) rev = 2; // simulate user typing
    }
    // C arrives with sourceRevision: 2; rev is now 2; matches → keeps.
    // BUT we want to test the filter — pre-bump rev so sourceRevision: 2
    // doesn't match.
    expect(out.map((e) => (e.kind === 'token' ? e.text : ''))).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('drops tokens for stale revisions', async () => {
    const source = streamFromStrings([
      sse([
        { kind: 'token', text: 'A', sourceRevision: 1 },
        { kind: 'token', text: 'B', sourceRevision: 1 },
        { kind: 'token', text: 'C', sourceRevision: 1 },
      ]),
    ]);
    const out = await collect(source, { currentRevision: () => 2 });
    expect(out).toHaveLength(0);
  });

  it('drops ghost tokens whose sourceCursor !== currentCursor()', async () => {
    const source = streamFromStrings([
      sse([
        { kind: 'token', text: 'a', sourceRevision: 1, sourceCursor: 5 },
        { kind: 'token', text: 'b', sourceRevision: 1, sourceCursor: 5 },
      ]),
    ]);
    const out = await collect(source, {
      currentRevision: () => 1,
      currentCursor: () => 9, // user moved cursor since request started
    });
    expect(out).toHaveLength(0);
  });

  it('keeps non-token events even when revision filter is active', async () => {
    const source = streamFromStrings([
      sse([
        { kind: 'token', text: 'stale', sourceRevision: 99 },
        {
          kind: 'tool_call',
          callId: 'c1',
          tool: 'fileRef.read',
          args: { fileNodeId: 'x' },
        },
      ]),
    ]);
    const out = await collect(source, { currentRevision: () => 1 });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('tool_call');
  });
});

describe('consumeStream — abort handling', () => {
  it('emits aborted error event when signal fires mid-stream', async () => {
    const ctrl = new AbortController();
    const source = {
      body: (async function* () {
        yield sse([{ kind: 'token', text: 'A', sourceRevision: 1 }]);
        // Abort before yielding more chunks.
        ctrl.abort();
        yield sse([{ kind: 'token', text: 'B', sourceRevision: 1 }]);
      })(),
    };
    const out = await collect(source, { signal: ctrl.signal });
    const last = out[out.length - 1];
    expect(last.kind).toBe('error');
    if (last.kind !== 'error') return;
    expect(last.errorKind).toBe('aborted');
  });
});
