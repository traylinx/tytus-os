/**
 * App Store "Desktop" tab — Install / Open / Docs actions.
 *
 * Renders the real AppStore against a route-based fake daemon (GET /api/apps,
 * POST /api/apps/check, POST /api/apps/open) and asserts the per-card action
 * buttons and the header "Open all installed" control wire to the daemon.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import AppStore from './AppStore';
import { DaemonClientProvider } from '@/hooks/useDaemonClient';
import { OSProvider } from '@/hooks/useOSStore';
import { createDaemonClient } from '@/lib/daemon';
import { makeFakeFetch, type RouteSpec, type FakeFetchHandle } from '@/test/fakeFetch';
import type { StoreApp } from '@/types/daemon';

const discord: StoreApp = {
  id: 'discord',
  name: 'Discord',
  description: 'Voice, video, and text chat.',
  category: 'Communication',
  icon: 'Headphones',
  url: 'https://discord.com/download',
  docs: 'https://support.discord.com/',
  platforms: ['macos', 'linux'],
  detect: { macos: ['Discord'], linux: ['discord'] },
  install: { macos: 'brew install --cask discord', linux: 'sudo snap install discord' },
  launch: { macos: { kind: 'app', target: 'Discord' }, linux: { kind: 'app', target: 'discord' } },
};

const ghostty: StoreApp = {
  id: 'ghostty',
  name: 'Ghostty',
  description: 'A fast terminal emulator.',
  category: 'Developer Tools',
  icon: 'Terminal',
  url: 'https://ghostty.org/',
  docs: 'https://ghostty.org/docs',
  platforms: ['macos', 'linux'],
  detect: { macos: ['Ghostty'], linux: ['ghostty'] },
  install: { macos: 'brew install --cask ghostty', linux: 'Visit https://ghostty.org/download for your distro' },
  launch: { macos: { kind: 'app', target: 'Ghostty' }, linux: { kind: 'app', target: 'ghostty' } },
};

const defaultRoutes: RouteSpec[] = [
  { method: 'GET', path: '/api/apps', body: [discord, ghostty] },
  {
    method: 'POST',
    path: '/api/apps/check',
    body: { results: [{ id: 'discord', installed: true }, { id: 'ghostty', installed: false }] },
  },
  // Single-open and open-all both POST here; this body satisfies both result
  // shapes (single only reads `ok`).
  { method: 'POST', path: '/api/apps/open', body: { ok: true, opened: ['discord'], skipped: [] } },
];

function renderStore(routes: RouteSpec[] = defaultRoutes): FakeFetchHandle {
  const handle = makeFakeFetch(routes);
  const client = createDaemonClient({ fetch: handle.fetch });
  render(
    <DaemonClientProvider client={client}>
      <OSProvider>
        <AppStore />
      </OSProvider>
    </DaemonClientProvider>,
  );
  return handle;
}

async function gotoDesktopTab() {
  fireEvent.click(await screen.findByTestId('appstore-tab-desktop'));
}

afterEach(() => cleanup());

describe('AppStore — Desktop tab actions', () => {
  it('shows Open + Docs for an installed app (no Install)', async () => {
    renderStore();
    await gotoDesktopTab();

    expect(await screen.findByTestId('appcard-open-discord')).toBeTruthy();
    expect(screen.getByTestId('appcard-docs-discord')).toBeTruthy();
    expect(screen.queryByTestId('appcard-install-discord')).toBeNull();

    const docs = screen.getByTestId('appcard-docs-discord') as HTMLAnchorElement;
    expect(docs.getAttribute('href')).toBe('https://support.discord.com/');
  });

  it('shows Install + Docs for a not-installed app (no Open)', async () => {
    renderStore();
    await gotoDesktopTab();

    expect(await screen.findByTestId('appcard-install-ghostty')).toBeTruthy();
    expect(screen.getByTestId('appcard-docs-ghostty')).toBeTruthy();
    expect(screen.queryByTestId('appcard-open-ghostty')).toBeNull();

    const docs = screen.getByTestId('appcard-docs-ghostty') as HTMLAnchorElement;
    expect(docs.getAttribute('href')).toBe('https://ghostty.org/docs');
  });

  it('clicking Open posts /api/apps/open with the app id', async () => {
    const handle = renderStore();
    await gotoDesktopTab();

    fireEvent.click(await screen.findByTestId('appcard-open-discord'));

    await waitFor(() => {
      const call = handle.calls.find(
        (c) => c.url.endsWith('/api/apps/open') && (c.init?.method ?? 'GET') === 'POST',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call!.init!.body as string)).toEqual({ app_id: 'discord' });
    });
  });

  it('"Open all installed" posts { all: true } and reports the result', async () => {
    const handle = renderStore();
    await gotoDesktopTab();

    const btn = await screen.findByTestId('appstore-open-all');
    // Enabled once the install-check resolves (discord installed).
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    await waitFor(() => {
      const call = handle.calls.find(
        (c) => c.url.endsWith('/api/apps/open') && (c.init?.method ?? 'GET') === 'POST',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call!.init!.body as string)).toEqual({ all: true });
    });

    expect(await screen.findByTestId('appstore-open-all-msg')).toBeTruthy();
    expect(screen.getByTestId('appstore-open-all-msg').textContent).toContain('discord');
  });
});
