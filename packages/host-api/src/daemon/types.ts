/**
 * Daemon HTTP contract types — shapes for the Tytus daemon endpoints
 * (`/api/ai/usage`, `/api/brain/search`, `/api/brain/append`) that
 * workspace apps call through `createDaemonClient`.
 */

export interface UsageRecord {
  txId: string;
  sessionId: string;
  mode: string;
  model: string;
  promptVersion: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  accepted: boolean | null;
  finalState: 'committed' | 'discarded' | 'abandoned' | null;
  ghostAccepted: number;
  ghostRejected: number;
  relevanceFeedback: 'thumbs_up' | 'thumbs_down' | null;
  hunksApplied: number | null;
  hunksTotal: number | null;
  createdAt: number;
}

export interface BrainSearchResultSource {
  kind: 'journal' | 'page' | 'memo';
  path: string;
}

export interface BrainSearchResult {
  id: string;
  snippet: string;
  score: number;
  source: BrainSearchResultSource;
}

export interface BrainEntry {
  kind: 'memo' | 'journal';
  body: string;
  sourceApp?: string;
  tags?: string[];
}

export class DaemonClientError extends Error {
  readonly statusCode: number | null;
  readonly body: unknown;
  readonly cause?: unknown;
  constructor(
    message: string,
    opts: { statusCode: number | null; body: unknown; cause?: unknown },
  ) {
    super(message);
    this.name = 'DaemonClientError';
    this.statusCode = opts.statusCode;
    this.body = opts.body;
    if (opts.cause !== undefined) {
      this.cause = opts.cause;
    }
  }
}
