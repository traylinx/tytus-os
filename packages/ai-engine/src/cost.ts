/**
 * Cost telemetry — UsageRecord lifecycle from `done` event through
 * `recordOutcome` to a daemon-backed log.
 *
 * Per spec §"Cost telemetry" / 02-ai-engine.md:
 *   1. `done` event → engine writes a partial UsageRecord with
 *      accepted: null, finalState: null
 *   2. App calls session.recordOutcome(txId, ...) → engine merges +
 *      attempts POST /api/ai/usage
 *   3. POST success → row purged; POST failure → row stays for next
 *      flush cycle
 *   4. 60 s grace → engine internally fires recordOutcome with
 *      { accepted: false, finalState: 'abandoned' } if no app call
 *
 * M2 ships an in-memory + IndexedDB-backed CostStore. M8 wires the
 * daemon endpoint so committed records flush server-side. The store
 * abstraction lets tests run with a Map; the engine itself never
 * touches IndexedDB directly.
 */

import type { AppId, AppMode, TokenUsage } from './types';
import type { TransactionOutcome } from '@tytus/host-api';

export interface UsageRecord {
  txId: string;
  sessionId: string;
  app: AppId;
  mode: AppMode;
  model: string;
  promptVersion: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  /** null until recordOutcome fires (or grace timer marks abandoned). */
  accepted: boolean | null;
  finalState: TransactionOutcome['finalState'] | null;
  ghostAccepted: number;
  ghostRejected: number;
  relevanceFeedback: 'thumbs_up' | 'thumbs_down' | null;
  hunksApplied: number | null;
  hunksTotal: number | null;
  /** Local-time ms when the partial row was first written. */
  createdAt: number;
}

/** Storage abstraction so tests can swap in an in-memory implementation
 *  while production uses IndexedDB. M8 may layer the daemon's
 *  `/api/ai/usage` POST as a second step around the same interface. */
export interface CostStore {
  put(record: UsageRecord): Promise<void>;
  get(txId: string): Promise<UsageRecord | null>;
  /** Pending records (no outcome merged yet). Settings → AI → Usage
   *  shows these as "in flight". */
  listPending(): Promise<UsageRecord[]>;
  /** Records with outcomes that haven't yet flushed to the daemon.
   *  Settings → AI → Usage shows these as "awaiting daemon ack". */
  listCommittedLocal(): Promise<UsageRecord[]>;
  delete(txId: string): Promise<void>;
}

/** Simple in-memory store — the canonical test fixture and the v1
 *  fallback when IndexedDB isn't available (private windows, very old
 *  browsers). */
export class MemoryCostStore implements CostStore {
  private rows = new Map<string, UsageRecord>();

  async put(record: UsageRecord): Promise<void> {
    this.rows.set(record.txId, record);
  }

  async get(txId: string): Promise<UsageRecord | null> {
    return this.rows.get(txId) ?? null;
  }

  async listPending(): Promise<UsageRecord[]> {
    return [...this.rows.values()].filter((r) => r.accepted === null);
  }

  async listCommittedLocal(): Promise<UsageRecord[]> {
    return [...this.rows.values()].filter((r) => r.accepted !== null);
  }

  async delete(txId: string): Promise<void> {
    this.rows.delete(txId);
  }

  /** Test helper. */
  __size(): number {
    return this.rows.size;
  }
}

export interface CostReporterDeps {
  store: CostStore;
  /** Called when a record has an outcome AND should be flushed to the
   *  daemon. Returns true on successful flush; false signals the record
   *  stays local for the next flush cycle. M2 ships a no-op flusher
   *  (always returns false → records pile up locally). M8 wires the
   *  real `/api/ai/usage` POST. */
  flush?: (record: UsageRecord) => Promise<boolean>;
  /** Time-source override for tests. */
  now?: () => number;
}

/**
 * CostReporter — orchestrates the partial-write → outcome-merge → flush
 * lifecycle on top of any CostStore.
 */
export class CostReporter {
  private readonly deps: CostReporterDeps;

  constructor(deps: CostReporterDeps) {
    this.deps = deps;
  }

  /** Step 1 of the lifecycle. Called by the engine on `done`. */
  async writePartial(input: {
    txId: string;
    sessionId: string;
    app: AppId;
    mode: AppMode;
    model: string;
    promptVersion: string;
    usage: TokenUsage;
    durationMs: number;
  }): Promise<UsageRecord> {
    const now = (this.deps.now ?? (() => Date.now()))();
    const record: UsageRecord = {
      txId: input.txId,
      sessionId: input.sessionId,
      app: input.app,
      mode: input.mode,
      model: input.model,
      promptVersion: input.promptVersion,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      durationMs: input.durationMs,
      accepted: null,
      finalState: null,
      ghostAccepted: 0,
      ghostRejected: 0,
      relevanceFeedback: null,
      hunksApplied: null,
      hunksTotal: null,
      createdAt: now,
    };
    await this.deps.store.put(record);
    return record;
  }

  /** Step 2 of the lifecycle. Called when the user decides on a
   *  staged transaction (Apply / Discard / Refresh-and-apply). The
   *  60-s grace timer in the session also calls this with
   *  { accepted: false, finalState: 'abandoned' }. */
  async mergeOutcome(
    txId: string,
    outcome: TransactionOutcome,
  ): Promise<UsageRecord | null> {
    const existing = await this.deps.store.get(txId);
    if (!existing) return null;
    const merged: UsageRecord = {
      ...existing,
      accepted: outcome.accepted,
      finalState: outcome.finalState,
      relevanceFeedback: outcome.relevanceFeedback ?? null,
      hunksApplied: outcome.hunksApplied ?? null,
      hunksTotal: outcome.hunksTotal ?? null,
      ghostAccepted:
        existing.ghostAccepted +
        (outcome.ghost?.accepted === true ? 1 : 0),
      ghostRejected:
        existing.ghostRejected +
        (outcome.ghost?.accepted === false ? 1 : 0),
    };
    await this.deps.store.put(merged);
    if (this.deps.flush) {
      const ok = await this.deps.flush(merged);
      if (ok) await this.deps.store.delete(txId);
    }
    return merged;
  }

  /** Step 3 (manual): retry every locally-committed record against the
   *  daemon. Settings → AI → Usage exposes a "Sync now" button that
   *  calls this. M8 wires it into a periodic background flush. */
  async retryFlush(): Promise<{ flushed: number; remaining: number }> {
    if (!this.deps.flush) {
      const remaining = (await this.deps.store.listCommittedLocal()).length;
      return { flushed: 0, remaining };
    }
    let flushed = 0;
    for (const r of await this.deps.store.listCommittedLocal()) {
      const ok = await this.deps.flush(r);
      if (ok) {
        await this.deps.store.delete(r.txId);
        flushed += 1;
      }
    }
    const remaining = (await this.deps.store.listCommittedLocal()).length;
    return { flushed, remaining };
  }
}
