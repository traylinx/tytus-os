/**
 * useInstalledAppIds — hook tests.
 *
 * Verifies the live-DB → React state bridge that AppRouter consumes
 * for its routing decision. Covers:
 *   1. First-render snapshot from the injected `loader`.
 *   2. Refresh after a `notifyInstalledAppsChanged()` event.
 *   3. Cleanup on unmount (no setState after teardown).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useInstalledAppIds } from './use-installed-app-ids';
import { notifyInstalledAppsChanged } from '../installed-apps-events';
import type { InstalledAppRow } from '../installed-apps-repo';
import type { Manifest } from '@tytus/host-api';

function row(
  id: string,
  kind: InstalledAppRow['kind'],
): InstalledAppRow {
  const manifest: Manifest = {
    id,
    name: id,
    version: '1.0.0',
    icon: 'Box',
    category: 'Utilities',
    description: '',
    window: {
      defaultSize: { width: 100, height: 100 },
      minSize: { width: 100, height: 100 },
    },
    permissions: [],
    entry: { module: '' },
  };
  return {
    id,
    kind,
    manifest,
    entryUrl: null,
    assetsUrl: null,
    manifestUrl: null,
    installedAt: 0,
    enabled: true,
    builtinProtected: kind === 'bundled',
  };
}

describe('useInstalledAppIds', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a Map<id, kind> from the injected loader after first render', async () => {
    const loader = vi.fn(async () => [
      row('memo', 'bundled'),
      row('todoist', 'installed'),
    ]);
    const { result } = renderHook(() => useInstalledAppIds({ loader }));

    await waitFor(() => {
      expect(result.current.size).toBe(2);
    });
    expect(result.current.get('memo')).toBe('bundled');
    expect(result.current.get('todoist')).toBe('installed');
  });

  it('refreshes when notifyInstalledAppsChanged is dispatched', async () => {
    let rows = [row('memo', 'bundled')];
    const loader = vi.fn(async () => rows);
    const { result } = renderHook(() => useInstalledAppIds({ loader }));

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    rows = [row('memo', 'bundled'), row('todoist', 'installed')];
    await act(async () => {
      notifyInstalledAppsChanged();
    });

    await waitFor(() => {
      expect(result.current.size).toBe(2);
    });
    expect(result.current.get('todoist')).toBe('installed');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('returns an empty Map when the loader rejects', async () => {
    const loader = vi.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useInstalledAppIds({ loader }));
    // First effect rejects → empty map. Give the microtask queue a tick.
    await waitFor(() => {
      expect(result.current.size).toBe(0);
    });
  });

  it('unsubscribes on unmount (subsequent events do not call the loader)', async () => {
    const loader = vi.fn(async () => [row('memo', 'bundled')]);
    const { result, unmount } = renderHook(() =>
      useInstalledAppIds({ loader }),
    );
    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    unmount();
    const callsBefore = loader.mock.calls.length;
    notifyInstalledAppsChanged();
    // Wait a tick to let any zombie subscription fire (it shouldn't).
    await new Promise((r) => setTimeout(r, 10));
    expect(loader.mock.calls.length).toBe(callsBefore);
  });
});
