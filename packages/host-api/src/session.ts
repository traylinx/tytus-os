/**
 * Session-related TYPE ALIASES.
 *
 * Implementations live in @tytus/ai-engine. They live here as types because
 * apps' `bootSheet(env: AppBootEnv)` signature needs Session/ToolDef/etc
 * shapes at the type level. Forcing apps to `import type` from ai-engine
 * just for type aliases would add ai-engine to every app's tsconfig
 * "references" — even Calculator that has no AI. Putting the aliases here
 * keeps the dep graph one-way: ai-engine IMPLEMENTS these; apps READ THEM
 * from the contract.
 */

export type AppMode =
  | 'default' // Sheet, Memo
  | 'code'
  | 'text'
  | 'markdown'
  | 'json'; // Studio

export interface SendRequest {
  intent: 'chat' | 'edit' | 'plan';
  prompt: string;
  /** Selection shape is narrowed per app — Sheet uses cell ranges, Studio uses
   *  text ranges, Memo uses block ids. The host-api keeps it open. */
  selection?: { range: unknown; text: string };
  context?: Record<string, unknown>;
}

export interface TransactionOutcome {
  accepted: boolean;
  finalState: 'committed' | 'discarded' | 'abandoned';
  ghost?: { accepted: boolean };
  relevanceFeedback?: 'thumbs_up' | 'thumbs_down';
  hunksApplied?: number;
  hunksTotal?: number;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** `true` = always prompt; `false` = no prompt; `'first-time-per-session'` =
   *  prompt once per app session, then auto-approve. */
  requiresApproval: boolean | 'first-time-per-session';
  execute: (
    args: unknown,
    ctx: {
      sessionId: string;
      appId: string;
      approvalAlreadyGranted: boolean;
    },
  ) => Promise<unknown>;
}

export interface SessionCost {
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}

export type SessionStatus = 'ready' | 'connecting' | 'degraded' | 'error';

export interface Session {
  /** Send a request; returns an async iterable of EngineEvents (full union
   *  in @tytus/ai-engine). Apps treat each event as opaque and route by
   *  `kind` for the few types they care about. */
  send(req: SendRequest): AsyncIterable<unknown>;
  /** Request a ghost completion (autocomplete). `at` is a byte offset; `after`
   *  is the number of characters to project ahead. Sheet doesn't use this. */
  ghostRequest(opts: {
    at: number;
    after: number;
  }): AsyncIterable<unknown>;
  /** Cancel any in-flight request. */
  abort(): void;
  /** Telemetry: the app reports the user's final disposition of a transaction
   *  so the engine can attribute outcomes (accepted vs discarded vs abandoned)
   *  for adaptive prompting + relevance feedback. */
  recordOutcome(txId: string, outcome: TransactionOutcome): Promise<void>;
  status: SessionStatus;
  cost: SessionCost;
}

export interface AppCreateSessionOpts {
  app: 'sheet' | 'studio' | 'memo';
  mode: AppMode;
  documentId: string;
  documentRevision: number;
  initialContext?: Record<string, unknown>;
  tools: ToolDef[];
  promptVersion?: string;
}

/** Pre-bound by the shell's loader factory. App receives this through
 *  AppBootEnv; calling it returns a Session ready to use. */
export type AppCreateSession = (opts: AppCreateSessionOpts) => Session;
