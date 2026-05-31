import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import AppLauncher from '@/components/AppLauncher';
import { OSProvider, useOS } from '@/hooks/useOSStore';
import { DaemonClientProvider } from '@/hooks/useDaemonClient';
import { DaemonStateProvider } from '@/hooks/useDaemonStateContext';
import { I18nProvider } from '@/i18n';
import { createDaemonClient } from '@/lib/daemon';
import { makeFakeFetch } from '@/test/fakeFetch';
import { stateFixture } from '@/test/fixtures';
import {
  __clearInstalledAppsCacheForTests,
  addToInstalledAppsCache,
  removeFromInstalledAppsCache,
} from '@/runtime/installed-apps-cache';
import { notifyInstalledAppsChanged } from '@/runtime/installed-apps-events';
import type { InstalledAppRow } from '@/runtime/installed-apps-repo';
import type { Manifest } from '@tytus/host-api';
import type { ReactNode } from 'react';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  }
});

afterEach(() => {
  __clearInstalledAppsCacheForTests();
});

function installedRow(id: string, name = id): InstalledAppRow {
  const manifest: Manifest = {
    id,
    name,
    version: '1.0.0',
    icon: 'Box',
    category: 'Productivity',
    description: `${name} dynamic app`,
    window: {
      defaultSize: { width: 800, height: 600 },
      minSize: { width: 400, height: 300 },
    },
    permissions: [],
    entry: { url: `https://cdn.example.com/${id}/dist/index.js` },
  };
  return {
    id,
    kind: 'installed',
    manifest,
    entryUrl: manifest.entry?.url ?? null,
    assetsUrl: null,
    manifestUrl: `https://cdn.example.com/${id}/tytus-app.json`,
    installedAt: 0,
    enabled: true,
    builtinProtected: false,
  };
}

const OpenLauncher = () => {
  const { dispatch } = useOS();
  useEffect(() => {
    dispatch({ type: 'SET_APP_LAUNCHER', open: true });
  }, [dispatch]);
  return null;
};

const WindowProbe = ({ onWindows }: { onWindows: (ids: string[]) => void }) => {
  const { state } = useOS();
  useEffect(() => {
    onWindows(state.windows.map((w) => w.appId));
  }, [state.windows, onWindows]);
  return null;
};

function renderLauncher(children?: ReactNode) {
  const { fetch } = makeFakeFetch([
    { method: 'GET', path: '/api/state', body: stateFixture },
  ]);
  const client = createDaemonClient({ fetch });
  return render(
    <I18nProvider>
      <DaemonClientProvider client={client}>
        <DaemonStateProvider intervalMs={60_000}>
          <OSProvider>
            <OpenLauncher />
            {children}
            <AppLauncher />
          </OSProvider>
        </DaemonStateProvider>
      </DaemonClientProvider>
    </I18nProvider>,
  );
}

describe('AppLauncher installed apps', () => {
  it('enumerates installed dynamic app rows from the cache', async () => {
    addToInstalledAppsCache(installedRow('openhouse', 'OpenHouse'));
    renderLauncher();

    expect(await screen.findByText('OpenHouse')).toBeTruthy();
  });

  it('searches installed dynamic app names and descriptions', async () => {
    addToInstalledAppsCache(installedRow('openhouse', 'OpenHouse'));
    renderLauncher();

    const input = (await screen.findByPlaceholderText(/search applications/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'dynamic app' } });

    expect(await screen.findByText('OpenHouse')).toBeTruthy();
  });

  it('opens an installed dynamic app from the launcher', async () => {
    const seen: string[][] = [];
    addToInstalledAppsCache(installedRow('openhouse', 'OpenHouse'));
    renderLauncher(<WindowProbe onWindows={(ids) => seen.push(ids)} />);

    fireEvent.click(await screen.findByText('OpenHouse'));

    await waitFor(() => {
      expect(seen.some((ids) => ids.includes('openhouse'))).toBe(true);
    });
  });

  it('removes uninstalled dynamic apps after installed-apps change event', async () => {
    addToInstalledAppsCache(installedRow('openhouse', 'OpenHouse'));
    renderLauncher();
    expect(await screen.findByText('OpenHouse')).toBeTruthy();

    act(() => {
      removeFromInstalledAppsCache('openhouse');
      notifyInstalledAppsChanged();
    });

    await waitFor(() => {
      expect(screen.queryByText('OpenHouse')).toBeNull();
    });
  });
});
