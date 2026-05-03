import { describe, expect, it, vi } from 'vitest';
import {
  TransactionRunner,
  type CommitResult,
  type PatchApplier,
  type PreparedPatch,
  type Transaction,
  type TxCtx,
} from './transaction';
import type { Patch, TextInsertPatch } from './algebra';

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  txId: 'tx-1',
  app: 'sheet',
  baseRevisions: { 'doc-A': 1 },
  patches: [],
  filesAffected: [],
  estimatedCost: { tokens: 0, usd: 0 },
  preview: [],
  ...overrides,
});

const insertPatch = (
  docId: string,
  text: string,
): TextInsertPatch => ({
  kind: 'text.insert',
  docId,
  at: { offset: 0 },
  text,
});

/** Test applier that records every prepare/commit/rollback for assertions
 *  and lets each phase be configured to throw. */
class TestApplier implements PatchApplier<Patch> {
  patchKinds: Patch['kind'][];
  prepares: Array<{ patch: Patch; ctx: TxCtx }> = [];
  commits: PreparedPatch[] = [];
  rollbacks: PreparedPatch[] = [];
  prepareThrowAt: number | null = null;
  commitThrowAt: number | null = null;
  rollbackThrows = false;

  constructor(kinds: Patch['kind'][]) {
    this.patchKinds = kinds;
  }

  async prepare(patch: Patch, ctx: TxCtx): Promise<PreparedPatch> {
    if (this.prepareThrowAt !== null && this.prepares.length === this.prepareThrowAt) {
      this.prepares.push({ patch, ctx });
      throw new Error(`prepare boom #${this.prepares.length - 1}`);
    }
    this.prepares.push({ patch, ctx });
    return { patchRef: patch, idx: this.prepares.length - 1 };
  }

  async commit(prepared: PreparedPatch): Promise<CommitResult> {
    if (this.commitThrowAt !== null && this.commits.length === this.commitThrowAt) {
      this.commits.push(prepared);
      throw new Error(`commit boom #${this.commits.length - 1}`);
    }
    this.commits.push(prepared);
    return { details: { ok: true } };
  }

  async rollback(prepared: PreparedPatch): Promise<void> {
    if (this.rollbackThrows) {
      this.rollbacks.push(prepared);
      throw new Error(`rollback boom`);
    }
    this.rollbacks.push(prepared);
  }
}

describe('TransactionRunner — registration', () => {
  it('throws on duplicate applier registration for the same kind', () => {
    const runner = new TransactionRunner({
      getCurrentRevision: async () => 1,
    });
    runner.registerApplier(new TestApplier(['text.insert']));
    expect(() =>
      runner.registerApplier(new TestApplier(['text.insert'])),
    ).toThrow(/duplicate applier/);
  });

  it('hasApplierFor reports registration state', () => {
    const runner = new TransactionRunner({
      getCurrentRevision: async () => 1,
    });
    runner.registerApplier(new TestApplier(['text.insert']));
    expect(runner.hasApplierFor('text.insert')).toBe(true);
    expect(runner.hasApplierFor('text.replace')).toBe(false);
  });
});

describe('TransactionRunner — happy path', () => {
  it('validates → prepares → commits when revisions match', async () => {
    const applier = new TestApplier(['text.insert']);
    const runner = new TransactionRunner({
      getCurrentRevision: async () => 1,
    });
    runner.registerApplier(applier);
    const tx = makeTx({
      patches: [insertPatch('doc-A', 'hello')],
    });
    const outcome = await runner.commit(tx);
    expect(outcome.state).toBe('committed');
    if (outcome.state !== 'committed') return;
    expect(outcome.results).toHaveLength(1);
    expect(applier.prepares).toHaveLength(1);
    expect(applier.commits).toHaveLength(1);
    expect(applier.rollbacks).toHaveLength(0);
  });

  it('passes liveRevisions snapshot in TxCtx to appliers', async () => {
    const applier = new TestApplier(['text.insert']);
    const runner = new TransactionRunner({
      getCurrentRevision: async (id) => (id === 'doc-A' ? 7 : 0),
    });
    runner.registerApplier(applier);
    const tx = makeTx({
      baseRevisions: { 'doc-A': 7 },
      patches: [insertPatch('doc-A', 'hi')],
    });
    await runner.commit(tx);
    expect(applier.prepares[0].ctx.liveRevisions).toEqual({ 'doc-A': 7 });
  });
});

describe('TransactionRunner — revision_stale', () => {
  it('aborts when any baseRevision mismatches', async () => {
    const applier = new TestApplier(['text.insert']);
    const runner = new TransactionRunner({
      getCurrentRevision: async (id) => (id === 'doc-A' ? 2 : 1),
    });
    runner.registerApplier(applier);
    const tx = makeTx({
      baseRevisions: { 'doc-A': 1, 'doc-B': 1 },
      patches: [insertPatch('doc-A', 'x')],
    });
    const outcome = await runner.commit(tx);
    expect(outcome.state).toBe('aborted');
    if (outcome.state !== 'aborted') return;
    expect(outcome.reason).toBe('revision_stale');
    if (outcome.reason !== 'revision_stale') return;
    expect(outcome.staleDocs).toEqual(['doc-A']);
    // Nothing prepared or committed — appliers untouched.
    expect(applier.prepares).toHaveLength(0);
    expect(applier.commits).toHaveLength(0);
  });
});

describe('TransactionRunner — prepare failure', () => {
  it('rolls back already-prepared peers', async () => {
    const applier = new TestApplier(['text.insert']);
    applier.prepareThrowAt = 1; // Second prepare throws.
    const runner = new TransactionRunner({
      getCurrentRevision: async () => 1,
    });
    runner.registerApplier(applier);
    const tx = makeTx({
      patches: [insertPatch('doc-A', 'a'), insertPatch('doc-A', 'b')],
    });
    const outcome = await runner.commit(tx);
    expect(outcome.state).toBe('aborted');
    if (outcome.state !== 'aborted') return;
    expect(outcome.reason).toBe('prepare_failed');
    if (outcome.reason !== 'prepare_failed') return;
    expect(outcome.patchIndex).toBe(1);
    expect(outcome.error.message).toContain('prepare boom #1');
    // First patch was prepared; rollback called for it.
    expect(applier.prepares).toHaveLength(2);
    expect(applier.rollbacks).toHaveLength(1);
    // Nothing committed.
    expect(applier.commits).toHaveLength(0);
  });

  it('aborts with prepare_failed when no applier is registered for a kind', async () => {
    const runner = new TransactionRunner({
      getCurrentRevision: async () => 1,
    });
    // No applier.
    const tx = makeTx({
      patches: [insertPatch('doc-A', 'orphan')],
    });
    const outcome = await runner.commit(tx);
    expect(outcome.state).toBe('aborted');
    if (outcome.state !== 'aborted') return;
    expect(outcome.reason).toBe('prepare_failed');
    if (outcome.reason !== 'prepare_failed') return;
    expect(outcome.error.message).toMatch(/no applier registered/);
  });
});

describe('TransactionRunner — commit failure', () => {
  it('rolls back prior commits + the still-prepared tail', async () => {
    const applier = new TestApplier(['text.insert']);
    applier.commitThrowAt = 1; // Second commit throws.
    const runner = new TransactionRunner({
      getCurrentRevision: async () => 1,
    });
    runner.registerApplier(applier);
    const tx = makeTx({
      patches: [
        insertPatch('doc-A', 'a'),
        insertPatch('doc-A', 'b'),
        insertPatch('doc-A', 'c'),
      ],
    });
    const outcome = await runner.commit(tx);
    expect(outcome.state).toBe('aborted');
    if (outcome.state !== 'aborted') return;
    expect(outcome.reason).toBe('commit_failed');
    if (outcome.reason !== 'commit_failed') return;
    expect(outcome.patchIndex).toBe(1);
    // 3 prepared; 1 committed (the success); commit #2 threw; commit #3 not attempted.
    expect(applier.prepares).toHaveLength(3);
    expect(applier.commits).toHaveLength(2); // The successful one + the failing call.
    // Rollbacks: the successful commit (1) + the failing one (still prepared) +
    // the never-committed third = 3.
    expect(applier.rollbacks.length).toBeGreaterThanOrEqual(2);
  });

  it('reports rollback_failed partial state when rollback of a prior commit throws', async () => {
    // Two patches: first commits OK, second's commit throws. The runner
    // tries to rollback the first; rollback throws → partial state.
    const applier = new TestApplier(['text.insert']);
    applier.commitThrowAt = 1;
    applier.rollbackThrows = true;
    const runner = new TransactionRunner({
      getCurrentRevision: async () => 1,
    });
    runner.registerApplier(applier);
    const tx = makeTx({
      patches: [insertPatch('doc-A', 'a'), insertPatch('doc-A', 'b')],
    });
    const outcome = await runner.commit(tx);
    expect(outcome.state).toBe('partial');
    if (outcome.state !== 'partial') return;
    expect(outcome.reason).toBe('rollback_failed');
    expect(outcome.rollbackErrors.length).toBeGreaterThan(0);
  });
});

describe('TransactionRunner — multi-doc baseRevisions', () => {
  it('checks every doc, not just the active one', async () => {
    const calls: string[] = [];
    const runner = new TransactionRunner({
      getCurrentRevision: async (id) => {
        calls.push(id);
        return 1;
      },
    });
    runner.registerApplier(new TestApplier(['text.insert']));
    const tx = makeTx({
      baseRevisions: { 'doc-A': 1, 'doc-B': 1, 'doc-C': 1 },
      patches: [insertPatch('doc-A', 'x')],
    });
    await runner.commit(tx);
    expect(calls.sort()).toEqual(['doc-A', 'doc-B', 'doc-C']);
  });

  it('logs only — does not surface — prepare-rollback errors after prepare failure', async () => {
    const applier = new TestApplier(['text.insert']);
    applier.prepareThrowAt = 1;
    applier.rollbackThrows = true;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = new TransactionRunner({
      getCurrentRevision: async () => 1,
    });
    runner.registerApplier(applier);
    const tx = makeTx({
      patches: [insertPatch('doc-A', 'a'), insertPatch('doc-A', 'b')],
    });
    const outcome = await runner.commit(tx);
    expect(outcome.state).toBe('aborted');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
