/**
 * SSE consumer with revision-tagged event filtering.
 *
 * Wire protocol (matches the Tytus pod gateway):
 * - Each event is `data: <JSON-encoded EngineEvent>\n\n`
 * - Empty lines separate events
 * - Comments start with `:` (per SSE spec) and are ignored
 * - The stream ends when the pod closes the connection or emits
 *   `data: {"kind":"done",...}` followed by EOF
 *
 * Revision filtering: every `token` event carries a `sourceRevision`.
 * Apps watching a buffer that may have mutated since the request started
 * pass `currentRevision()` into `consumeStream` so stale tokens are
 * dropped before they reach the for-await loop. Ghost streams also pass
 * a `currentCursor()` so suggestions for stale cursor positions are
 * dropped.
 *
 * The consumer never throws on malformed events — it emits an
 * `errorEvent` (synthetic) and continues. The pod's transport-level
 * failures (network drop, non-200 status) DO throw before any event is
 * yielded.
 *
 * Per spec §"Engine event stream" + §"Ghost completion debounce".
 */

import type { EngineEvent } from './events';

export interface ConsumeOptions {
  /** Optional source revision filter for `token` events. Returns the
   *  current buffer revision; tokens whose sourceRevision !== this
   *  value are dropped. */
  currentRevision?: () => number;
  /** Optional cursor filter for ghost streams. Tokens whose
   *  `sourceCursor` is set and != current cursor are dropped. */
  currentCursor?: () => number;
  /** Abort signal — when fired, the consumer stops reading and emits
   *  an `aborted` error event (terminal). */
  signal?: AbortSignal;
}

const TEXT_DECODER = new TextDecoder('utf-8');

export interface SsePodResponse {
  /** Async iterable of UTF-8 chunks (or strings already-decoded). The
   *  pod's response body is the canonical case; tests pass an
   *  in-memory iterator. */
  readonly body:
    | AsyncIterable<Uint8Array>
    | AsyncIterable<string>;
}

/**
 * Yield EngineEvents parsed from an SSE stream, dropping events that
 * fail revision/cursor filters.
 */
export async function* consumeStream(
  source: SsePodResponse,
  opts: ConsumeOptions = {},
): AsyncGenerator<EngineEvent> {
  const { currentRevision, currentCursor, signal } = opts;
  let buffer = '';

  const isAborted = (): boolean => signal?.aborted ?? false;

  // Iterate raw chunks; reassemble into events delimited by blank lines.
  for await (const chunk of source.body as AsyncIterable<Uint8Array | string>) {
    if (isAborted()) {
      yield {
        kind: 'error',
        message: 'aborted',
        retryable: false,
        errorKind: 'aborted',
      };
      return;
    }
    buffer +=
      typeof chunk === 'string' ? chunk : TEXT_DECODER.decode(chunk, { stream: true });
    let sepIdx = -1;
    while ((sepIdx = findEventEnd(buffer)) !== -1) {
      const raw = buffer.slice(0, sepIdx);
      // Advance past the blank-line separator (\n\n or \r\n\r\n).
      buffer = buffer.slice(sepIdx + (buffer[sepIdx] === '\r' ? 4 : 2));
      const event = parseSseEvent(raw);
      if (!event) continue;
      // Apply filters.
      if (event.kind === 'token') {
        if (
          currentRevision !== undefined &&
          event.sourceRevision !== currentRevision()
        ) {
          continue;
        }
        if (
          currentCursor !== undefined &&
          event.sourceCursor !== undefined &&
          event.sourceCursor !== currentCursor()
        ) {
          continue;
        }
      }
      yield event;
    }
  }
  // Flush any tail (single event without a trailing blank line).
  // Decoder may have buffered bytes — finalize now.
  buffer += TEXT_DECODER.decode();
  const tail = buffer.trim();
  if (tail.length > 0) {
    const event = parseSseEvent(tail);
    if (event) yield event;
  }
}

function findEventEnd(buffer: string): number {
  // SSE event boundaries: \n\n or \r\n\r\n.
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/**
 * Parse a single SSE event block (one or more `data: ...` lines, optional
 * `event:` / `id:` / `:`-comments). Returns null when the block had no
 * data field; emits a synthetic error event when the data isn't valid
 * JSON-encoded EngineEvent (so the consumer can surface it without
 * throwing).
 */
export function parseSseEvent(block: string): EngineEvent | null {
  const lines = block.split(/\r\n|\n/);
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith(':')) continue; // comment
    if (line.startsWith('data:')) {
      // SSE strips a single space after `:` if present.
      const payload = line.slice(5).startsWith(' ')
        ? line.slice(6)
        : line.slice(5);
      dataParts.push(payload);
      continue;
    }
    // event: / id: / retry: not used by the engine wire format; skip.
  }
  if (dataParts.length === 0) return null;
  const raw = dataParts.join('\n');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      kind: 'error',
      message: `malformed SSE payload: ${(err as Error).message}`,
      retryable: false,
      errorKind: 'unknown',
      details: { raw: raw.slice(0, 200) },
    };
  }
  if (!isEngineEvent(parsed)) {
    return {
      kind: 'error',
      message: 'SSE payload is not a valid EngineEvent',
      retryable: false,
      errorKind: 'unknown',
      details: parsed,
    };
  }
  return parsed;
}

const VALID_KINDS = new Set([
  'token',
  'tool_call',
  'tool_result',
  'staged_patch',
  'done',
  'error',
]);

function isEngineEvent(v: unknown): v is EngineEvent {
  if (!v || typeof v !== 'object') return false;
  const o = v as { kind?: unknown };
  if (typeof o.kind !== 'string') return false;
  if (!VALID_KINDS.has(o.kind)) return false;
  // Per-kind shape spot-checks. The transactional fields (patch /
  // transaction) are not deep-validated here — the runner re-validates
  // patches via validatePatch(), so deep schema work would duplicate.
  switch (o.kind) {
    case 'token':
      return (
        typeof (o as { text?: unknown }).text === 'string' &&
        typeof (o as { sourceRevision?: unknown }).sourceRevision === 'number'
      );
    case 'tool_call':
      return (
        typeof (o as { callId?: unknown }).callId === 'string' &&
        typeof (o as { tool?: unknown }).tool === 'string'
      );
    case 'tool_result':
      return (
        typeof (o as { callId?: unknown }).callId === 'string' &&
        typeof (o as { ok?: unknown }).ok === 'boolean'
      );
    case 'staged_patch':
      return (
        typeof (o as { txId?: unknown }).txId === 'string' &&
        typeof (o as { patch?: unknown }).patch === 'object'
      );
    case 'done':
      return (
        typeof (o as { txId?: unknown }).txId === 'string' &&
        typeof (o as { transaction?: unknown }).transaction === 'object'
      );
    case 'error':
      return (
        typeof (o as { message?: unknown }).message === 'string' &&
        typeof (o as { retryable?: unknown }).retryable === 'boolean' &&
        typeof (o as { errorKind?: unknown }).errorKind === 'string'
      );
    default:
      return false;
  }
}

/**
 * Helper: turn an iterable of strings into an SSE-shaped Response body.
 * Used by tests — fixtures pass `\n\n`-delimited event blocks directly.
 */
export function streamFromStrings(
  parts: Iterable<string>,
): SsePodResponse {
  return {
    body: (async function* () {
      for (const p of parts) yield p;
    })(),
  };
}
