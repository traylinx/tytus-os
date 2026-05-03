/**
 * Engine-internal types layered on top of the @tytus/host-api type aliases.
 *
 * Aliases (Session, ToolDef, AppMode, SendRequest, TransactionOutcome) live
 * in host-api so apps can compile against them without depending on the
 * engine package. The engine RE-EXPORTS them here so callers using
 * `@tytus/ai-engine` directly (tests, headless agents) get the same names.
 */

import type {
  AppMode,
  HostClient,
  SendRequest,
  Session,
  ToolDef,
  TransactionOutcome,
} from '@tytus/host-api';

export type { AppMode, SendRequest, Session, ToolDef, TransactionOutcome };

/** Cursor position in a text buffer. Offset-based (UTF-16 code units, matching
 *  the DOM Selection API). */
export interface TextPos {
  offset: number;
  /** Optional convenience for app-side rendering; the engine uses offset. */
  line?: number;
  column?: number;
}

export interface TextRange {
  start: TextPos;
  end: TextPos;
}

/** A1 spreadsheet position (e.g. "B7") + range ("A1:C12"). The engine
 *  treats these as opaque strings; Sheet's appliers parse them. */
export type A1Pos = string;
export type A1Range = string;
export type A1 = A1Pos;

/** Single-cell value used by sheet patches. Always JSON-serialisable. */
export type CellValue = string | number | boolean | null;

/** Memo metadata patch shape — partial, additive. */
export interface MemoMeta {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  [extension: string]: unknown;
}

/** Engine-internal tool execution context. Passed to every ToolDef.execute. */
export interface ToolCtx {
  sessionId: string;
  appId: string;
  /** True if the user clicked Approve on the chip; tools may skip
   *  re-asking for the same scope this session. */
  approvalAlreadyGranted: boolean;
}

/** Transaction preview block — what the modal renders for a slice. */
export interface PreviewBlock {
  kind:
    | 'text-diff'
    | 'sheet-range-flash'
    | 'memo-metadata'
    | 'file-create'
    | 'brain-block';
  payload: unknown;
  summary?: string;
}

/** Engine asset resolver. Reads from packages/ai-engine/dist/assets/, NOT
 *  from the host app's bundle. The shell creates it once at boot and
 *  passes it through to every session. */
export interface AssetResolver {
  text(path: string): Promise<string>;
  bytes(path: string): Promise<Uint8Array>;
}

/** App identifier inside the engine. Currently the three AI-native apps
 *  M2 ships for. M6 + M7 + M4 land Studio + Memo + Sheet wedge respectively. */
export type AppId = 'sheet' | 'studio' | 'memo';

/** Token usage reported by the gateway on `done`. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
  totalTokens: number;
}

/** Read-only per-session cost summary, exposed via Session.cost. */
export interface CostSummary extends TokenUsage {
  totalCost: number;
}

export type ErrorKind =
  | 'revision_stale'
  | 'patch_invalid'
  | 'pod_offline'
  | 'queue_overflow'
  | 'rate_limit'
  | 'context_overflow'
  | 'aborted'
  | 'tool_failed'
  | 'unknown';

/** Session options as accepted by createSession. */
export interface SessionOptions {
  app: AppId;
  mode: AppMode;
  documentId: string;
  documentRevision: number;
  initialContext?: Record<string, unknown>;
  host: HostClient;
  tools: ToolDef[];
  assets: AssetResolver;
  promptVersion?: string;
}
