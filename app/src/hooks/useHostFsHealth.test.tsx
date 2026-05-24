import { describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { createHostFsHealth } from '@/runtime/host-fs-health';
import { useHostFsHealth } from './useHostFsHealth';

function Probe({ instance }: { instance: ReturnType<typeof createHostFsHealth> }) {
  const snap = useHostFsHealth(instance);
  return (
    <div>
      <span data-testid="status">{snap.status}</span>
      <span data-testid="errors">{snap.errorOpsCount}</span>
      <span data-testid="successes">{snap.successOpsCount}</span>
    </div>
  );
}

describe('useHostFsHealth', () => {
  it('renders the initial snapshot synchronously', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    const { getByTestId } = render(<Probe instance={health} />);
    expect(getByTestId('status').textContent).toBe('unknown');
    expect(getByTestId('successes').textContent).toBe('0');
  });

  it('re-renders when the underlying snapshot changes', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    const { getByTestId } = render(<Probe instance={health} />);
    expect(getByTestId('status').textContent).toBe('unknown');
    act(() => {
      health.record({ kind: 'success', op: 'list' });
    });
    expect(getByTestId('status').textContent).toBe('ok');
    expect(getByTestId('successes').textContent).toBe('1');
  });

  it('tracks errors → degraded → offline through React', () => {
    const health = createHostFsHealth({
      offlineErrorThreshold: 2,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const { getByTestId } = render(<Probe instance={health} />);
    act(() => {
      health.record({ kind: 'error', op: 'read', error: new Error('x') });
    });
    expect(getByTestId('status').textContent).toBe('degraded');
    expect(getByTestId('errors').textContent).toBe('1');
    act(() => {
      health.record({ kind: 'error', op: 'read', error: new Error('y') });
    });
    expect(getByTestId('status').textContent).toBe('offline');
  });

  it('unsubscribes on unmount', () => {
    const health = createHostFsHealth({ fetchImpl: vi.fn() as unknown as typeof fetch });
    const { getByTestId, unmount } = render(<Probe instance={health} />);
    act(() => {
      health.record({ kind: 'success', op: 'list' });
    });
    expect(getByTestId('status').textContent).toBe('ok');
    unmount();
    // After unmount, mutating the store should not throw and should not
    // reach the (now-disconnected) tree.
    expect(() => {
      health.record({ kind: 'error', op: 'read', error: new Error('z') });
    }).not.toThrow();
  });
});
