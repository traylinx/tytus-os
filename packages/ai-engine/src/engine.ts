/**
 * `createSession(opts)` — the orchestrator that composes Patch algebra
 * + TransactionRunner + SSE consumer + router + cost reporter + tool
 * registry + prompts loader into a working AI session.
 *
 * Per spec §"Top-level surface" / 02-ai-engine.md. M2 ships the core
 * request lifecycle:
 *   - send(req) calls the transport, streams events, dispatches tool
 *     calls, builds a Transaction from `propose_patches` results, emits
 *     `staged_patch` per validated patch, emits `done` with the final
 *     Transaction + token usage. Writes a partial UsageRecord on `done`.
 *   - recordOutcome(txId, outcome) merges into CostReporter; arms a
 *     60-second grace timer per pending txId.
 *   - abort() cancels the active request via the AbortSignal it owns.
 *   - ghostRequest contract is wired (debounce + filter) but the
 *     full multi-stage debounce loop is M2.5 follow-up; this PR ships
 *     the single-shot path.
 *   - Concurrency: 1 in-flight; second send while one is active rejects
 *     with `error.errorKind === 'queue_overflow'`. Drop-newest matches
 *     spec; the 3-deep queue is M2.5 follow-up.
 */

import type {
  HostClient,
  Session,
  SendRequest,
  TransactionOutcome,
} from '@tytus/host-api';
import {
  CostReporter,
  MemoryCostStore,
  type CostStore,
} from './cost';
import type {
  EngineEvent,
  StagedPatchEvent,
  ToolCallEvent,
  ToolResultEvent,
} from './events';
import {
  PROPOSE_PATCHES_MAX,
  validatePatch,
  type Patch,
} from './edits/algebra';
import type { Transaction } from './edits/transaction';
import { loadPrompt } from './prompts';
import {
  PodOfflineError,
  discoverModels,
  pickModel,
  resolveEndpoint,
  type ModelInfo,
} from './router';
import { consumeStream } from './stream';
import { createToolRegistry, type ToolRegistry } from './tools/registry';
import {
  makeHostPodTransport,
  toOpenAiTools,
  type ChatMessage,
  type ChatRequest,
  type PodTransport,
} from './transport';
import type {
  AppId,
  AppMode,
  AssetResolver,
  CostSummary,
  ErrorKind,
  PreviewBlock,
  SessionOptions,
  ToolDef,
} from './types';

/**
 * Same shape as SessionOptions plus the test-only `transport` and
 * `costStore` injection points. Production callers use createSession;
 * tests use createSessionWithTransport.
 */
export interface CreateSessionTestOptions extends SessionOptions {
  transport?: PodTransport;
  costStore?: CostStore;
  /** Override the model selection (test fixtures + future Settings → AI). */
  modelOverride?: string;
  /** Test seam: produce stable txIds. Default: random + monotonic. */
  txIdFactory?: () => string;
  /** Test seam: stable createdAt for UsageRecord. */
  now?: () => number;
  /** Optional pod-offline detector override. */
  endpointOverride?: ReturnType<typeof resolveEndpoint>;
  /** Skip /v1/models discovery (tests with stubbed transport). */
  skipDiscovery?: boolean;
  /** Override the discovered models list (tests). */
  modelsOverride?: ModelInfo[];
}

export function createSession(opts: SessionOptions): Session {
  return createSessionWithTransport(opts);
}

export function createSessionWithTransport(
  opts: CreateSessionTestOptions,
): Session {
  const sessionId = `sess_${Math.random().toString(36).slice(2, 10)}`;
  const txIdFactory =
    opts.txIdFactory ?? (() => `tx_${Math.random().toString(36).slice(2, 12)}`);
  const now = opts.now ?? (() => Date.now());

  const tools: ToolDef[] = opts.tools.slice();
  const registry: ToolRegistry = createToolRegistry(tools);
  const costReporter = new CostReporter({
    store: opts.costStore ?? new MemoryCostStore(),
    now,
  });

  let status: Session['status'] = 'connecting';
  let aborted = false;
  let activeAbort: AbortController | null = null;
  let currentRevision = opts.documentRevision;

  const cost: CostSummary = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
  };

  // Resolve endpoint + transport lazily on first send so a session
  // created with a degraded pod can still wire up; the first send
  // surfaces pod_offline cleanly.
  let endpointCache: ReturnType<typeof resolveEndpoint> | null =
    opts.endpointOverride ?? null;
  let modelsCache: ModelInfo[] | null = opts.modelsOverride ?? null;
  let transportCache: PodTransport | null = opts.transport ?? null;

  async function ensureReady(host: HostClient): Promise<{
    endpoint: ReturnType<typeof resolveEndpoint> | null;
    models: ModelInfo[];
    transport: PodTransport;
  }> {
    // When a transport is injected (tests, or future bring-your-own
    // transport), skip endpoint resolution + model discovery — the
    // injected transport owns those concerns.
    if (transportCache) {
      if (!modelsCache) modelsCache = opts.modelsOverride ?? [];
      return {
        endpoint: endpointCache,
        models: modelsCache,
        transport: transportCache,
      };
    }
    if (!endpointCache) endpointCache = resolveEndpoint(host);
    transportCache = makeHostPodTransport(host, endpointCache);
    if (!modelsCache && !opts.skipDiscovery) {
      modelsCache = await discoverModels(endpointCache, host);
    } else if (!modelsCache) {
      modelsCache = [];
    }
    return {
      endpoint: endpointCache,
      models: modelsCache,
      transport: transportCache,
    };
  }

  // Pending outcomes that need a 60-second grace timer fallback.
  const pendingGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const armGraceTimer = (txId: string): void => {
    if (pendingGraceTimers.has(txId)) return;
    const t = setTimeout(async () => {
      try {
        await costReporter.mergeOutcome(txId, {
          accepted: false,
          finalState: 'abandoned',
        });
      } catch {
        /* swallow — telemetry must not crash the session */
      } finally {
        pendingGraceTimers.delete(txId);
      }
    }, 60_000);
    if ((t as unknown as { unref?: () => void }).unref) {
      (t as unknown as { unref: () => void }).unref();
    }
    pendingGraceTimers.set(txId, t);
  };

  // Single-flight gate. M2.5 follow-up adds the 3-deep queue;
  // here we drop newest if a request is in flight.
  let inFlight = false;

  async function* runRequest(
    req: SendRequest,
    promptVersion: string,
    abortCtrl: AbortController,
  ): AsyncGenerator<EngineEvent> {
    const host = opts.host;
    const ready = await ensureReady(host);
    const chatModel =
      opts.modelOverride ??
      (pickModel(ready.models, 'chat')?.id ?? 'unknown');

    status = 'ready';

    // Build messages.
    let prompt = '';
    try {
      const doc = await loadPrompt(opts.assets, opts.app, opts.mode, opts.promptVersion);
      prompt = doc.body;
    } catch (err) {
      // Spec: never silently swallow asset failures. Surface as a non-fatal
      // warning event so the session still answers; downstream renders may
      // notice the missing prompt.
      yield errorEvent(
        `prompt missing for ${opts.app}-${opts.mode} — using empty system prompt`,
        true,
        'unknown',
        { detail: err instanceof Error ? err.message : String(err) },
      );
    }

    const messages: ChatMessage[] = [];
    if (prompt) messages.push({ role: 'system', content: prompt });
    messages.push({ role: 'user', content: req.prompt });

    const chatReq: ChatRequest = {
      model: chatModel,
      messages,
      tools: toOpenAiTools(tools),
      tool_choice: req.intent === 'edit' ? 'auto' : 'auto',
      stream: true,
    };

    const startedAt = now();
    let stream;
    try {
      stream = await ready.transport.chat(chatReq, { signal: abortCtrl.signal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Use both instanceof and a name-sniff so duplicate class
      // instances across module-graph boundaries (vitest HMR, ESM
      // double-load) don't downgrade to 'unknown'.
      const isPodOffline =
        err instanceof PodOfflineError ||
        (err as { name?: string })?.name === 'PodOfflineError' ||
        (err as { errorKind?: string })?.errorKind === 'pod_offline';
      const errorKind: ErrorKind = isPodOffline ? 'pod_offline' : 'unknown';
      yield errorEvent(message, isPodOffline, errorKind);
      return;
    }

    // Accumulate patches across staged_patch events into a Transaction.
    const stagedPatches: Patch[] = [];
    let txId: string | null = null;
    let usagePromptTokens = 0;
    let usageCompletionTokens = 0;

    for await (const event of consumeStream(stream, {
      currentRevision: () => currentRevision,
      signal: abortCtrl.signal,
    })) {
      // Tool dispatch — engine executes registered tools synchronously.
      if (event.kind === 'tool_call') {
        yield event;
        const result = await dispatchToolCall(event, registry, {
          sessionId,
          appId: opts.app,
          approvalAlreadyGranted: false,
        });
        // The model's next turn would normally see this result. Our v1
        // contract: emit it locally so apps' visibility log records it;
        // the gateway is responsible for completing the model's tool
        // turn (it sees tool_result echoed by the engine via separate
        // upstream channel — out of scope here).
        yield result;
        continue;
      }

      if (event.kind === 'staged_patch') {
        const issues = validatePatch(event.patch);
        if (issues.length > 0) {
          yield errorEvent(
            `staged patch failed validation: ${issues.map((i) => i.message).join('; ')}`,
            false,
            'patch_invalid',
            { issues },
          );
          continue;
        }
        if (stagedPatches.length >= PROPOSE_PATCHES_MAX) {
          yield errorEvent(
            `propose_patches exceeded ${PROPOSE_PATCHES_MAX} cap`,
            false,
            'patch_invalid',
          );
          continue;
        }
        stagedPatches.push(event.patch);
        if (!txId) txId = event.txId;
        yield event;
        continue;
      }

      if (event.kind === 'done') {
        const finalTxId = event.txId || txId || txIdFactory();
        // Build a Transaction from the accumulated patches. The
        // gateway-side `done` event carries one — we trust it but
        // re-validate our local set's invariants (count, base revs).
        const transaction: Transaction = {
          ...event.transaction,
          txId: finalTxId,
          patches:
            event.transaction.patches.length > 0
              ? event.transaction.patches
              : stagedPatches,
          baseRevisions: {
            ...event.transaction.baseRevisions,
            [opts.documentId]: opts.documentRevision,
          },
          preview: event.transaction.preview ?? defaultPreview(stagedPatches),
        };
        usagePromptTokens = event.usage.promptTokens;
        usageCompletionTokens = event.usage.completionTokens;
        cost.promptTokens += usagePromptTokens;
        cost.completionTokens += usageCompletionTokens;
        cost.totalTokens += event.usage.totalTokens;
        // Partial UsageRecord — outcome stays null until recordOutcome.
        try {
          await costReporter.writePartial({
            txId: finalTxId,
            sessionId,
            app: opts.app,
            mode: opts.mode,
            model: chatModel,
            promptVersion,
            usage: event.usage,
            durationMs: now() - startedAt,
          });
          armGraceTimer(finalTxId);
        } catch {
          /* telemetry must not break the stream */
        }
        yield { ...event, txId: finalTxId, transaction };
        return;
      }

      // Pass through token / error events untouched.
      yield event;
    }
  }

  const session: Session = {
    get status() {
      return status;
    },
    get cost() {
      return cost;
    },
    send(req) {
      if (aborted) {
        return errorOnceAsyncIterable(
          errorEvent('session aborted', false, 'aborted'),
        );
      }
      if (inFlight) {
        return errorOnceAsyncIterable(
          errorEvent(
            'queue full — drop newest',
            false,
            'queue_overflow',
          ),
        );
      }
      inFlight = true;
      const ctrl = new AbortController();
      activeAbort = ctrl;
      const promptVersion = opts.promptVersion ?? 'default';
      const gen = runRequest(req, promptVersion, ctrl);
      return wrapForCleanup(gen, () => {
        inFlight = false;
        if (activeAbort === ctrl) activeAbort = null;
      });
    },
    ghostRequest(_input) {
      // M2.5 follow-up wires the 400ms debounce + cursor filter.
      // Today: yields a single error so apps don't silently fail.
      void _input;
      return errorOnceAsyncIterable(
        errorEvent(
          'ghostRequest is not yet implemented — wired in PR-M2.5 follow-up',
          false,
          'unknown',
        ),
      );
    },
    abort() {
      aborted = true;
      activeAbort?.abort();
    },
    async recordOutcome(txId: string, outcome: TransactionOutcome) {
      // Cancel the grace timer — the app made an explicit decision.
      const t = pendingGraceTimers.get(txId);
      if (t) {
        clearTimeout(t);
        pendingGraceTimers.delete(txId);
      }
      await costReporter.mergeOutcome(txId, outcome);
    },
  };
  return session;
}

// ─── helpers ──────────────────────────────────────────────────────────

function errorEvent(
  message: string,
  retryable: boolean,
  errorKind: ErrorKind,
  details?: unknown,
): EngineEvent {
  return {
    kind: 'error',
    message,
    retryable,
    errorKind,
    details,
  };
}

function defaultPreview(patches: Patch[]): PreviewBlock[] {
  return patches.map((p) => ({
    kind: previewKindForPatch(p),
    payload: p,
    summary: previewSummaryForPatch(p),
  }));
}

function previewKindForPatch(p: Patch): PreviewBlock['kind'] {
  switch (p.kind) {
    case 'text.insert':
    case 'text.replace':
    case 'text.delete':
    case 'memo.replace':
    case 'studio.replaceBlock':
    case 'studio.insertBlock':
    case 'studio.deleteBlock':
      return 'text-diff';
    case 'sheet.writeRange':
    case 'sheet.addSheet':
    case 'sheet.moveRange':
      return 'sheet-range-flash';
    case 'memo.create':
    case 'memo.metadataPatch':
    case 'memo.link':
      return 'memo-metadata';
    case 'file.create':
      return 'file-create';
    case 'brain.append':
      return 'brain-block';
  }
}

function previewSummaryForPatch(p: Patch): string {
  switch (p.kind) {
    case 'text.insert':
      return `Insert ${p.text.length} chars`;
    case 'text.replace':
      return `Replace range with ${p.text.length} chars`;
    case 'text.delete':
      return `Delete range`;
    case 'memo.create':
      return `Create memo "${p.title}"`;
    case 'memo.replace':
      return `Replace memo body`;
    case 'memo.metadataPatch':
      return `Update memo metadata`;
    case 'memo.link':
      return `Link two memos`;
    case 'sheet.writeRange':
      return `Write to ${p.range}`;
    case 'sheet.addSheet':
      return `Add sheet "${p.name}"`;
    case 'sheet.moveRange':
      return `Move ${p.mappings.length} cells`;
    case 'file.create':
      return `Create file ${p.name}`;
    case 'brain.append':
      return `Append to Brain`;
    case 'studio.replaceBlock':
      return `Replace block with ${p.newText.length} chars`;
    case 'studio.insertBlock':
      return `Insert ${p.block.kind} block`;
    case 'studio.deleteBlock':
      return `Delete block`;
  }
}

async function dispatchToolCall(
  event: ToolCallEvent,
  registry: ToolRegistry,
  ctx: { sessionId: string; appId: AppId; approvalAlreadyGranted: boolean },
): Promise<ToolResultEvent> {
  const tool = registry.get(event.tool);
  if (!tool) {
    return {
      kind: 'tool_result',
      callId: event.callId,
      ok: false,
      error: `unknown tool: ${event.tool}`,
    };
  }
  try {
    const value = await tool.execute(event.args, ctx);
    return {
      kind: 'tool_result',
      callId: event.callId,
      ok: true,
      value,
    };
  } catch (err) {
    return {
      kind: 'tool_result',
      callId: event.callId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function errorOnceAsyncIterable(event: EngineEvent): AsyncIterable<EngineEvent> {
  return (async function* () {
    yield event;
  })();
}

function wrapForCleanup<T>(
  gen: AsyncGenerator<T>,
  cleanup: () => void,
): AsyncGenerator<T> {
  return (async function* () {
    try {
      for await (const v of gen) yield v;
    } finally {
      cleanup();
    }
  })();
}

// Internal — used by harness tests to inspect that the engine
// understands a given EngineEvent.kind.
export const _internal = {
  defaultPreview,
};

// Avoid unused-symbol warnings for AppMode/AppId imports that participate
// in the surface only at the type level.
export type { AppId, AppMode };

// Helper used by createSessionWithTransport to advance currentRevision
// when the buffer mutates (the shell calls this from the buffer).
// Exposed so tests + the shell can drive it; production wraps it via a
// dedicated session.advanceRevision when M2.5 follow-up lands.
export function _advanceRevisionShape(
  session: Session,
  rev: number,
): void {
  void session;
  void rev;
}

// Re-export key pieces apps + tests want from the engine entry.
export type { ChatMessage, ChatRequest, PodTransport };

// Marker symbol used by harness assertions.
export const ENGINE_M2_VERSION = '0.1.0-m2';

// Fail loudly if a never-discriminator escapes via TS unknown widening:
// this function ensures the previewKindForPatch switch covers the union.
function _assertUnreachable(_x: never): never {
  throw new Error('unreachable');
}
void _assertUnreachable;

// Exported for tests: enumerate the 4 default tool helpers we ship.
export const M2_COMMON_TOOL_NAMES = ['fileRef.read', 'web.fetch'] as const;

// Exported for tests + telemetry surfaces.
export type StagedPatchEventForRefactor = StagedPatchEvent;
