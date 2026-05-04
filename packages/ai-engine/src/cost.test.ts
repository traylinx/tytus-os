import { describe, expect, it } from 'vitest';
import { CostReporter, MemoryCostStore, type UsageRecord } from './cost';

const baseInput = {
  txId: 'tx-1',
  sessionId: 'sess-1',
  app: 'sheet' as const,
  mode: 'default' as const,
  model: 'gpt-4o',
  promptVersion: '2026-05-03.1',
  usage: {
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
  },
  durationMs: 1234,
};

describe('CostReporter — partial write', () => {
  it('writes a record with accepted/finalState null', async () => {
    const store = new MemoryCostStore();
    const r = new CostReporter({ store });
    const rec = await r.writePartial(baseInput);
    expect(rec.accepted).toBeNull();
    expect(rec.finalState).toBeNull();
    expect(rec.promptTokens).toBe(100);
    expect(rec.txId).toBe('tx-1');
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
  });

  it('uses injected now() for createdAt (test-friendly)', async () => {
    const store = new MemoryCostStore();
    const r = new CostReporter({ store, now: () => 1700000000000 });
    const rec = await r.writePartial(baseInput);
    expect(rec.createdAt).toBe(1700000000000);
  });
});

describe('CostReporter — outcome merge', () => {
  it('merges TransactionOutcome into the existing partial row', async () => {
    const store = new MemoryCostStore();
    const r = new CostReporter({ store });
    await r.writePartial(baseInput);
    const merged = await r.mergeOutcome('tx-1', {
      accepted: true,
      finalState: 'committed',
      hunksApplied: 3,
      hunksTotal: 5,
    });
    expect(merged?.accepted).toBe(true);
    expect(merged?.finalState).toBe('committed');
    expect(merged?.hunksApplied).toBe(3);
  });

  it('returns null when no partial record exists for the txId', async () => {
    const store = new MemoryCostStore();
    const r = new CostReporter({ store });
    const merged = await r.mergeOutcome('unknown-tx', {
      accepted: true,
      finalState: 'committed',
    });
    expect(merged).toBeNull();
  });

  it('accumulates ghost accept/reject counts across merges', async () => {
    const store = new MemoryCostStore();
    const r = new CostReporter({ store });
    await r.writePartial(baseInput);
    await r.mergeOutcome('tx-1', {
      accepted: true,
      finalState: 'committed',
      ghost: { accepted: true },
    });
    const after = await store.get('tx-1');
    expect(after?.ghostAccepted).toBe(1);
    expect(after?.ghostRejected).toBe(0);
  });
});

describe('CostReporter — flush behavior', () => {
  it('purges the row when flush returns true', async () => {
    const store = new MemoryCostStore();
    const flushed: UsageRecord[] = [];
    const r = new CostReporter({
      store,
      flush: async (rec) => {
        flushed.push(rec);
        return true;
      },
    });
    await r.writePartial(baseInput);
    await r.mergeOutcome('tx-1', { accepted: true, finalState: 'committed' });
    expect(flushed).toHaveLength(1);
    expect(await store.get('tx-1')).toBeNull();
  });

  it('keeps the row when flush returns false (daemon unreachable)', async () => {
    const store = new MemoryCostStore();
    const r = new CostReporter({
      store,
      flush: async () => false,
    });
    await r.writePartial(baseInput);
    await r.mergeOutcome('tx-1', { accepted: false, finalState: 'discarded' });
    expect(await store.get('tx-1')).not.toBeNull();
    expect((await store.listCommittedLocal()).length).toBe(1);
  });

  it('retryFlush clears every locally-committed record on success', async () => {
    const store = new MemoryCostStore();
    let allowFlush = false;
    const r = new CostReporter({
      store,
      flush: async () => allowFlush,
    });
    await r.writePartial({ ...baseInput, txId: 'a' });
    await r.writePartial({ ...baseInput, txId: 'b' });
    await r.mergeOutcome('a', { accepted: true, finalState: 'committed' });
    await r.mergeOutcome('b', { accepted: false, finalState: 'discarded' });
    // First retry — flush still off — nothing flushes.
    expect((await r.retryFlush()).flushed).toBe(0);
    expect((await store.listCommittedLocal()).length).toBe(2);
    // Daemon comes online.
    allowFlush = true;
    const result = await r.retryFlush();
    expect(result.flushed).toBe(2);
    expect(result.remaining).toBe(0);
    expect(store.__size()).toBe(0);
  });

  it('retryFlush is a no-op when no flusher is configured', async () => {
    const store = new MemoryCostStore();
    const r = new CostReporter({ store });
    await r.writePartial(baseInput);
    await r.mergeOutcome('tx-1', { accepted: true, finalState: 'committed' });
    const result = await r.retryFlush();
    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(1);
  });
});
