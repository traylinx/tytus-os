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
import { I18nProvider } from '@/i18n';
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

const opencode: StoreApp = {
  id: 'opencode',
  name: 'OpenCode',
  description: 'AI-powered code editor and terminal assistant.',
  category: 'Developer Tools',
  icon: 'Terminal',
  url: 'https://opencode.ai/',
  docs: 'https://opencode.ai/docs/',
  platforms: ['macos', 'linux'],
  detect: { macos: ['opencode'], linux: ['opencode'] },
  install: { macos: 'brew install opencode-ai/tap/opencode', linux: 'curl -fsSL https://opencode.ai/install.sh | sh' },
  launch: { macos: { kind: 'terminal', target: 'opencode' }, linux: { kind: 'terminal', target: 'opencode' } },
  llm_setup: {
    adapter: 'opencode',
    provider: 'tytus-ail',
    default_model: 'ail-compound',
    supports_default: true,
  },
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
    <I18nProvider>
      <DaemonClientProvider client={client}>
        <OSProvider>
          <AppStore />
        </OSProvider>
      </DaemonClientProvider>
    </I18nProvider>,
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

  it('shows one-click Tytus AIL setup for installed LLM-capable apps and configures them', async () => {
    const routes: RouteSpec[] = [
      { method: 'GET', path: '/api/apps', body: [opencode, discord, ghostty] },
      {
        method: 'POST',
        path: '/api/apps/check',
        body: {
          results: [
            { id: 'opencode', installed: true },
            { id: 'discord', installed: true },
            { id: 'ghostty', installed: true },
          ],
        },
      },
      {
        method: 'GET',
        path: '/api/apps/llm-status?app_id=opencode',
        body: {
          app_id: 'opencode',
          supported: true,
          configured: false,
          provider: 'tytus-ail',
          model: 'ail-compound',
          base_url: 'http://10.42.42.1:18080/v1',
          key_hint: null,
          restart_required: true,
          message: 'OpenCode can be configured with Tytus AIL.',
        },
      },
      {
        method: 'POST',
        path: '/api/apps/configure-llm',
        body: {
          ok: true,
          app_id: 'opencode',
          configured: true,
          provider: 'tytus-ail',
          model: 'ail-compound',
          backup_path: null,
          restart_required: true,
          message: 'Tytus AIL is now the default provider for OpenCode.',
        },
      },
      { method: 'POST', path: '/api/apps/open', body: { ok: true, opened: ['opencode'], skipped: [] } },
    ];
    const handle = renderStore(routes);
    await gotoDesktopTab();

    const llmButton = await screen.findByTestId('appcard-llm-opencode');
    await waitFor(() => expect((llmButton as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId('appcard-llm-status-opencode').textContent).toContain('available');
    expect(screen.queryByTestId('appcard-llm-discord')).toBeNull();
    expect(screen.queryByTestId('appcard-llm-ghostty')).toBeNull();

    fireEvent.click(llmButton);

    await waitFor(() => {
      const call = handle.calls.find(
        (c) => c.url.endsWith('/api/apps/configure-llm') && (c.init?.method ?? 'GET') === 'POST',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call!.init!.body as string)).toEqual({ app_id: 'opencode', provider: 'tytus-ail' });
    });
    expect(await screen.findByTestId('appcard-feedback-opencode')).toBeTruthy();
  });
});
