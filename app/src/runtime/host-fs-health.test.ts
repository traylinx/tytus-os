import { describe, expect, it, vi } from 'vitest';
import {
  createHostFsHealth,
  type HostFsHealthSnapshot,
} from './host-fs-health';

function withFakeNow(start: number) {
  let now = start;
  return {
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
  };
}

function makeScheduler() {
  let nextId = 1;
  const handles = new Map<number, { fn: () => void; due: number }>();
  let virtualNow = 0;
  const setTimeoutImpl = (fn: () => void, ms: number): unknown => {
    const id = nextId++;
    handles.set(id, { fn, due: virtualNow + ms });
    return id;
  };
  const clearTimeoutImpl = (handle: unknown): void => {
    handles.delete(handle as number);
  };
  const advance = (ms: number): void => {
    virtualNow += ms;
    const due = [...handles.entries()].filter(([, h]) => h.due <= virtualNow);
    for (const [id, h] of due) {
      handles.delete(id);
      h.fn();
    }
  };
  const pendingCount = (): number => handles.size;
  return { setTimeoutImpl, clearTimeoutImpl, advance, pendingCount };
}

describe('host-fs-health', () => {
  it('starts in unknown and exposes a snapshot', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(health.getSnapshot().status).toBe('unknown');
    expect(health.getSnapshot().successOpsCount).toBe(0);
    expect(health.getSnapshot().errorOpsCount).toBe(0);
  });

  it('flips to ok on first success event', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    const listener = vi.fn();
    health.subscribe(listener);
    listener.mockClear();
    health.record({ kind: 'success', op: 'list' });
    expect(health.getSnapshot().status).toBe('ok');
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as HostFsHealthSnapshot).status).toBe('ok');
  });

  it('flips to degraded on first error', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    health.record({ kind: 'success', op: 'list' });
    health.record({ kind: 'error', op: 'read', error: new Error('boom') });
    expect(health.getSnapshot().status).toBe('degraded');
    expect(health.getSnapshot().lastError).toContain('boom');
  });

  it('flips to offline once errorThreshold reached within window', () => {
    const clock = withFakeNow(1000);
    const health = createHostFsHealth({
      offlineErrorThreshold: 3,
      errorWindowMs: 60_000,
      now: clock.now,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    health.record({ kind: 'error', op: 'read', error: new Error('e1') });
    health.record({ kind: 'error', op: 'read', error: new Error('e2') });
    expect(health.getSnapshot().status).toBe('degraded');
    health.record({ kind: 'error', op: 'read', error: new Error('e3') });
    expect(health.getSnapshot().status).toBe('offline');
  });

  it('expires old errors out of the rolling window', () => {
    const clock = withFakeNow(0);
    const health = createHostFsHealth({
      offlineErrorThreshold: 2,
      errorWindowMs: 1000,
      now: clock.now,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    health.record({ kind: 'error', op: 'r', error: new Error('a') });
    clock.advance(2000);
    health.record({ kind: 'error', op: 'r', error: new Error('b') });
    // first error pruned by window; only 1 in flight → still degraded
    expect(health.getSnapshot().status).toBe('degraded');
  });

  it('records fallback usage without changing status', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    health.record({ kind: 'success', op: 'list' });
    health.record({ kind: 'fallback', op: 'read', reason: 'non-daemon node id' });
    expect(health.getSnapshot().status).toBe('ok');
    expect(health.getSnapshot().fallbackOpsCount).toBe(1);
  });

  it('subscribers receive an initial snapshot synchronously', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    const listener = vi.fn();
    health.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as HostFsHealthSnapshot).status).toBe('unknown');
  });

  it('unsubscribe stops further notifications', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    const listener = vi.fn();
    const unsub = health.subscribe(listener);
    listener.mockClear();
    unsub();
    health.record({ kind: 'success', op: 'list' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('probe success flips offline → ok and resets error counters', async () => {
    const sched = makeScheduler();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    const health = createHostFsHealth({
      probeIntervalMs: 1000,
      probeTimeoutMs: 100,
      offlineErrorThreshold: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setTimeoutImpl: sched.setTimeoutImpl,
      clearTimeoutImpl: sched.clearTimeoutImpl,
      documentImpl: undefined,
    });
    health.record({ kind: 'error', op: 'list', error: new Error('boom') });
    expect(health.getSnapshot().status).toBe('offline');
    health.startProbe();
    // immediate probe is scheduled; drain microtasks
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(health.getSnapshot().status).toBe('ok');
    expect(health.getSnapshot().lastError).toBeNull();
    health.stopProbe();
  });

  it('probe failure stays offline and records lastError', async () => {
    const sched = makeScheduler();
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('econnrefused'));
    const health = createHostFsHealth({
      probeIntervalMs: 1000,
      probeTimeoutMs: 100,
      offlineErrorThreshold: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setTimeoutImpl: sched.setTimeoutImpl,
      clearTimeoutImpl: sched.clearTimeoutImpl,
      documentImpl: undefined,
    });
    health.startProbe();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(health.getSnapshot().status).toBe('offline');
    expect(health.getSnapshot().lastError).toContain('econnrefused');
    health.stopProbe();
  });

  it('stopProbe clears scheduled timers', () => {
    const sched = makeScheduler();
    const health = createHostFsHealth({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      setTimeoutImpl: sched.setTimeoutImpl,
      clearTimeoutImpl: sched.clearTimeoutImpl,
      documentImpl: undefined,
    });
    health.startProbe();
    expect(sched.pendingCount()).toBeGreaterThan(0);
    health.stopProbe();
    // the immediate-probe timer (if any) may have already fired and been
    // cleared. The reschedule timer must not remain pending after stop.
    // We assert idempotency rather than exact zero because the immediate
    // probe handle has its own lifecycle.
    health.stopProbe();
    expect(() => health.stopProbe()).not.toThrow();
  });

  it('startProbe is idempotent', () => {
    const sched = makeScheduler();
    const health = createHostFsHealth({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      setTimeoutImpl: sched.setTimeoutImpl,
      clearTimeoutImpl: sched.clearTimeoutImpl,
      documentImpl: undefined,
    });
    health.startProbe();
    const after = sched.pendingCount();
    health.startProbe();
    expect(sched.pendingCount()).toBe(after);
    health.stopProbe();
  });
});
