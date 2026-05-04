/**
 * Transaction model with explicit `baseRevisions` per touched document.
 *
 * Each Transaction carries the revisions of every doc the agent read
 * during the session. At commit time, the runner verifies every doc's
 * current revision matches the transaction's recorded baseline; if any
 * mismatch, abort with `error.errorKind === 'revision_stale'` and the
 * app re-issues against fresh state.
 *
 * Per spec §"Transaction model with baseRevisions" / 02-ai-engine.md.
 */

import type { AppId, PreviewBlock } from '../types';
import type { Patch } from './algebra';

export interface Transaction {
  txId: string;
  app: AppId;
  /** docId → revision the agent saw when it first read each doc. */
  baseRevisions: Record<string, number>;
  patches: Patch[];
  /** All FileNode ids the transaction will create or modify. Used by the
   *  modal's "files affected" header + by the engine's logging. */
  filesAffected: string[];
  estimatedCost: { tokens: number; usd: number };
  preview: PreviewBlock[];
}

/** PreparedPatch is opaque to the runner — each PatchApplier defines its
 *  own shape (snapshotted state, locks acquired, etc.) and reads it in
 *  commit/rollback. */
export type PreparedPatch = unknown;

export interface CommitResult {
  /** Optional outcome metadata the applier surfaces (e.g. the new
   *  fileNodeId for file.create). */
  details?: unknown;
}

export interface TxCtx {
  txId: string;
  appId: AppId;
  /** Live document revisions read from each docId at validate time.
   *  Appliers may re-check against this; the runner does the initial
   *  baseRevision comparison itself. */
  liveRevisions: Record<string, number>;
}

/** Per-app patch applier. Apps register a set of these via
 *  `engine.registerAppliers(...)`; the runner picks the matching one
 *  per patch by `patchKinds`. */
export interface PatchApplier<P extends Patch = Patch> {
  /** The Patch.kind values this applier handles. */
  patchKinds: P['kind'][];
  /** Stage the patch — validate against current state, take any locks,
   *  capture undo data. NO mutation here. */
  prepare(patch: P, ctx: TxCtx): Promise<PreparedPatch>;
  /** Apply the prepared patch. Throws to abort the transaction; the
   *  runner will rollback every committed peer. */
  commit(prepared: PreparedPatch, ctx: TxCtx): Promise<CommitResult>;
  /** Undo a previously prepared OR committed patch. Best-effort — if
   *  rollback fails, the runner surfaces a recovery prompt with partial
   *  state. */
  rollback(prepared: PreparedPatch, ctx: TxCtx): Promise<void>;
}

/** Outcome of a TransactionRunner.commit call. */
export type RunnerOutcome =
  | { state: 'committed'; results: CommitResult[] }
  | {
      state: 'aborted';
      reason: 'revision_stale';
      staleDocs: string[];
    }
  | {
      state: 'aborted';
      reason: 'prepare_failed';
      patchIndex: number;
      error: Error;
    }
  | {
      state: 'aborted';
      reason: 'commit_failed';
      patchIndex: number;
      error: Error;
      partialResults: CommitResult[];
    }
  | {
      state: 'partial';
      reason: 'rollback_failed';
      patchIndex: number;
      error: Error;
      committedResults: CommitResult[];
      rollbackErrors: Error[];
    };

export interface RunnerDeps {
  /** Get the current revision of a doc. The shell wires this to its
   *  buffer-revision ledger. Tests pass a fake. */
  getCurrentRevision(docId: string): Promise<number>;
}

/**
 * TransactionRunner — orchestrates validate → prepare → commit, with
 * rollback on commit failure. Stateless across calls.
 */
export class TransactionRunner {
  private readonly appliers = new Map<string, PatchApplier>();
  private readonly deps: RunnerDeps;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
  }

  registerApplier(applier: PatchApplier): void {
    for (const kind of applier.patchKinds) {
      if (this.appliers.has(kind)) {
        throw new Error(
          `TransactionRunner: duplicate applier registration for kind "${kind}"`,
        );
      }
      this.appliers.set(kind, applier);
    }
  }

  hasApplierFor(kind: Patch['kind']): boolean {
    return this.appliers.has(kind);
  }

  /** Run the full validate → prepare → commit pipeline. Returns the
   *  outcome; never throws (errors are encoded in the outcome). */
  async commit(tx: Transaction): Promise<RunnerOutcome> {
    // 1. Validate revisions — every doc's current rev must match the
    //    transaction's recorded baseline.
    const liveRevisions: Record<string, number> = {};
    const stale: string[] = [];
    for (const [docId, baseRev] of Object.entries(tx.baseRevisions)) {
      const live = await this.deps.getCurrentRevision(docId);
      liveRevisions[docId] = live;
      if (live !== baseRev) stale.push(docId);
    }
    if (stale.length > 0) {
      return { state: 'aborted', reason: 'revision_stale', staleDocs: stale };
    }

    const ctx: TxCtx = {
      txId: tx.txId,
      appId: tx.app,
      liveRevisions,
    };

    // 2. Prepare phase — every patch stages without mutation. Track which
    //    appliers prepared what, so we can rollback on prepare failure.
    const prepared: Array<{
      patch: Patch;
      applier: PatchApplier;
      prepared: PreparedPatch;
    }> = [];
    for (let i = 0; i < tx.patches.length; i += 1) {
      const patch = tx.patches[i];
      const applier = this.appliers.get(patch.kind);
      if (!applier) {
        await this.rollbackAll(prepared, ctx);
        return {
          state: 'aborted',
          reason: 'prepare_failed',
          patchIndex: i,
          error: new Error(
            `no applier registered for patch kind "${patch.kind}"`,
          ),
        };
      }
      try {
        const result = await applier.prepare(patch, ctx);
        prepared.push({ patch, applier, prepared: result });
      } catch (err) {
        await this.rollbackAll(prepared, ctx);
        return {
          state: 'aborted',
          reason: 'prepare_failed',
          patchIndex: i,
          error: toError(err),
        };
      }
    }

    // 3. Commit phase — apply each prepared patch in order. On any
    //    commit failure, rollback every successfully-committed peer.
    const committed: Array<{ applier: PatchApplier; prepared: PreparedPatch }> =
      [];
    const results: CommitResult[] = [];
    for (let i = 0; i < prepared.length; i += 1) {
      const { applier, prepared: preparedPatch } = prepared[i];
      try {
        const r = await applier.commit(preparedPatch, ctx);
        committed.push({ applier, prepared: preparedPatch });
        results.push(r);
      } catch (err) {
        // Rollback prior commits + the still-prepared (uncommitted) tail.
        const rollbackErrors: Error[] = [];
        for (const { applier: a, prepared: p } of committed.reverse()) {
          try {
            await a.rollback(p, ctx);
          } catch (re) {
            rollbackErrors.push(toError(re));
          }
        }
        // Rollback the not-yet-committed prepared patches too — they may
        // have taken locks or staged state.
        for (let j = i + 1; j < prepared.length; j += 1) {
          const { applier: a, prepared: p } = prepared[j];
          try {
            await a.rollback(p, ctx);
          } catch (re) {
            rollbackErrors.push(toError(re));
          }
        }
        if (rollbackErrors.length > 0) {
          return {
            state: 'partial',
            reason: 'rollback_failed',
            patchIndex: i,
            error: toError(err),
            committedResults: results,
            rollbackErrors,
          };
        }
        return {
          state: 'aborted',
          reason: 'commit_failed',
          patchIndex: i,
          error: toError(err),
          partialResults: results,
        };
      }
    }

    return { state: 'committed', results };
  }

  private async rollbackAll(
    prepared: Array<{ applier: PatchApplier; prepared: PreparedPatch }>,
    ctx: TxCtx,
  ): Promise<void> {
    for (const { applier, prepared: p } of [...prepared].reverse()) {
      try {
        await applier.rollback(p, ctx);
      } catch (err) {
        // Best-effort: prepare-failure rollbacks shouldn't surface a
        // partial state to the user (nothing was committed). Log only.
        // eslint-disable-next-line no-console
        console.error(
          '[TransactionRunner] rollback after prepare-failure threw',
          err,
        );
      }
    }
  }
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
