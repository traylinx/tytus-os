/**
 * EngineEvent — the union streamed from `Session.send()` /
 * `Session.ghostRequest()`. Apps `for await` the event stream and route
 * by `kind` for the few types they care about (`token`, `done`,
 * `staged_patch`, `error`).
 *
 * Per spec §"Engine event stream" / 02-ai-engine.md.
 */

import type { Patch } from './edits/algebra';
import type { Transaction } from './edits/transaction';
import type { ErrorKind, TokenUsage } from './types';

export type EngineEvent =
  | TokenEvent
  | ToolCallEvent
  | ToolResultEvent
  | StagedPatchEvent
  | DoneEvent
  | ErrorEvent;

export interface TokenEvent {
  kind: 'token';
  text: string;
  /** The buffer revision that was current when the model started
   *  emitting this token. Apps drop tokens whose sourceRevision !==
   *  the current buffer revision. */
  sourceRevision: number;
  /** Optional cursor position the ghost request was anchored at; only
   *  present on tokens emitted by `ghostRequest`. Apps drop tokens
   *  whose sourceCursor !== currentCursor before painting. */
  sourceCursor?: number;
}

export interface ToolCallEvent {
  kind: 'tool_call';
  callId: string;
  tool: string;
  args: unknown;
}

export interface ToolResultEvent {
  kind: 'tool_result';
  callId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface StagedPatchEvent {
  kind: 'staged_patch';
  txId: string;
  patch: Patch;
}

export interface DoneEvent {
  kind: 'done';
  txId: string;
  transaction: Transaction;
  usage: TokenUsage;
  finishReason: string;
}

export interface ErrorEvent {
  kind: 'error';
  message: string;
  retryable: boolean;
  /** Required (no `?`) — apps switch on this for structured handling.
   *  The 'unknown' fallback covers untyped failures. Renamed from
   *  `kind` to avoid collision with the `EngineEvent.kind` discriminator. */
  errorKind: ErrorKind;
  details?: unknown;
}
