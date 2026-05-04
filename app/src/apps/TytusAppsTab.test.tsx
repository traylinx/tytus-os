import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TytusAppsTab } from './TytusAppsTab';
import type { InstalledAppRow } from '@/runtime/installed-apps-repo';
import type { Manifest } from '@tytus/host-api';

// Stub global fetch so the production loadFeaturedApps() default
// doesn't fire a real network request during tests (which dangles past
// teardown and triggers a happy-dom AbortError noise). Tests that need
// specific Featured behaviour inject `loadFeatured` directly.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('fetch is stubbed in TytusAppsTab tests');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function row(
  id: string,
  kind: InstalledAppRow['kind'],
  overrides: Partial<InstalledAppRow> = {},
): InstalledAppRow {
  const manifest: Manifest = {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    version: '1.0.0',
    icon: 'Box',
    category: 'System',
    description: `${id} description`,
    window: {
      defaultSize: { width: 100, height: 100 },
      minSize: { width: 100, height: 100 },
    },
    permissions: [],
    entry: { module: '' },
    ...(overrides.manifest ?? {}),
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
    ...overrides,
  };
}

describe('TytusAppsTab', () => {
  it('renders a loading state before the first load resolves', async () => {
    const slow = () =>
      new Promise<InstalledAppRow[]>((r) => setTimeout(() => r([]), 50));
    render(<TytusAppsTab loadInstalledApps={slow} />);
    expect(screen.getByTestId('tytus-apps-loading')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByTestId('tytus-apps-loading')).toBeNull();
    });
  });

  it('renders system apps from kind=bundled rows', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('sheet', 'bundled'),
          row('memo', 'bundled'),
        ]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tytus-app-card-sheet')).toBeTruthy();
      expect(screen.getByTestId('tytus-app-card-memo')).toBeTruthy();
    });
  });

  it('disables the Uninstall button for builtin-protected system apps with the spec tooltip', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [row('sheet', 'bundled')]}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-app-card-sheet'));
    const btn = screen.getByTestId('tytus-app-uninstall-sheet') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('System app — auto-updated with Tytus OS');
  });

  it('shows the empty hint when there are no system apps', async () => {
    render(<TytusAppsTab loadInstalledApps={async () => []} />);
    await waitFor(() => {
      expect(screen.getByText('No system apps installed yet.')).toBeTruthy();
    });
  });

  it('shows the install-from-URL placeholder when no third-party apps are installed', async () => {
    render(<TytusAppsTab loadInstalledApps={async () => []} />);
    await waitFor(() => {
      expect(
        screen.getByText(
          'No third-party apps installed. Use Install from URL above.',
        ),
      ).toBeTruthy();
    });
  });

  it('hides the System apps history section when there are no aliases', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [row('sheet', 'bundled')]}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-app-card-sheet'));
    expect(screen.queryByTestId('tytus-apps-history-toggle')).toBeNull();
  });

  it('renders the System apps history section when alias rows exist (collapsed by default)', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('spreadsheet', 'alias', {
            manifest: { aliasOf: 'sheet' } as Manifest,
          }),
        ]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tytus-apps-history-toggle')).toBeTruthy();
    });
    // Collapsed: alias row is NOT rendered yet.
    expect(screen.queryByTestId('tytus-app-alias-spreadsheet')).toBeNull();
  });

  it('expands the System apps history section on click', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('spreadsheet', 'alias', {
            manifest: { aliasOf: 'sheet' } as Manifest,
          }),
        ]}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-apps-history-toggle'));
    fireEvent.click(screen.getByTestId('tytus-apps-history-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('tytus-app-alias-spreadsheet')).toBeTruthy();
    });
  });

  it('fires onOpen with the bundled app id on Open click', async () => {
    const onOpen = vi.fn();
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [row('sheet', 'bundled')]}
        onOpen={onOpen}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-app-card-sheet'));
    fireEvent.click(screen.getByTestId('tytus-app-open-sheet'));
    expect(onOpen).toHaveBeenCalledWith('sheet');
  });

  it('fires onOpen with the alias TARGET id (not the alias id) when opening from history', async () => {
    const onOpen = vi.fn();
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('spreadsheet', 'alias', {
            manifest: { aliasOf: 'sheet' } as Manifest,
          }),
        ]}
        onOpen={onOpen}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-apps-history-toggle'));
    fireEvent.click(screen.getByTestId('tytus-apps-history-toggle'));
    await waitFor(() => screen.getByTestId('tytus-app-alias-spreadsheet'));
    const aliasRow = screen.getByTestId('tytus-app-alias-spreadsheet');
    const openBtn = aliasRow.querySelector('button');
    if (!openBtn) throw new Error('open button missing');
    fireEvent.click(openBtn);
    expect(onOpen).toHaveBeenCalledWith('sheet');
  });

  it('survives a loader that throws (degrades to empty)', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => {
          throw new Error('db down');
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('No system apps installed yet.')).toBeTruthy();
    });
  });

  it('renders the Install from URL button', async () => {
    render(<TytusAppsTab loadInstalledApps={async () => []} />);
    await waitFor(() => {
      expect(screen.getByTestId('tytus-apps-install-from-url')).toBeTruthy();
    });
  });

  it('opens the install modal when the Install from URL button is clicked', async () => {
    render(<TytusAppsTab loadInstalledApps={async () => []} />);
    await waitFor(() => screen.getByTestId('tytus-apps-install-from-url'));
    fireEvent.click(screen.getByTestId('tytus-apps-install-from-url'));
    await waitFor(() => {
      expect(screen.getByTestId('tytus-apps-install-modal')).toBeTruthy();
      expect(screen.getByTestId('tytus-apps-install-modal-input')).toBeTruthy();
    });
  });

  it('drives onInstallFromUrl on submit and refreshes the list', async () => {
    let calls = 0;
    const newRow = row('shiny', 'installed');
    const onInstallFromUrl = vi.fn(async () => newRow);
    const loadInstalledApps = vi.fn(async () => {
      calls++;
      return calls > 1 ? [newRow] : [];
    });
    render(
      <TytusAppsTab
        loadInstalledApps={loadInstalledApps}
        onInstallFromUrl={onInstallFromUrl}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-apps-install-from-url'));
    fireEvent.click(screen.getByTestId('tytus-apps-install-from-url'));
    await waitFor(() => screen.getByTestId('tytus-apps-install-modal-input'));
    const input = screen.getByTestId(
      'tytus-apps-install-modal-input',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'https://cdn.example.com/shiny/tytus-app.json' },
    });
    fireEvent.click(screen.getByTestId('tytus-apps-install-modal-submit'));
    await waitFor(() => {
      expect(onInstallFromUrl).toHaveBeenCalledWith(
        'https://cdn.example.com/shiny/tytus-app.json',
      );
      expect(screen.queryByTestId('tytus-apps-install-modal')).toBeNull();
      expect(screen.getByTestId('tytus-app-card-shiny')).toBeTruthy();
    });
  });

  it('renders InstallerError details inside the modal on failure', async () => {
    const { InstallerError } = await import('@/runtime/installer');
    const onInstallFromUrl = vi.fn(async () => {
      throw new InstallerError('invalid_manifest', [
        { path: '/id', message: 'must match APP_ID_PATTERN' },
      ]);
    });
    render(
      <TytusAppsTab
        loadInstalledApps={async () => []}
        onInstallFromUrl={onInstallFromUrl}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-apps-install-from-url'));
    fireEvent.click(screen.getByTestId('tytus-apps-install-from-url'));
    const input = await waitFor(() =>
      screen.getByTestId('tytus-apps-install-modal-input'),
    );
    fireEvent.change(input, { target: { value: 'https://x/y' } });
    fireEvent.click(screen.getByTestId('tytus-apps-install-modal-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('tytus-apps-install-modal-error');
      expect(err.textContent).toContain('invalid_manifest');
      expect(err.textContent).toContain('must match APP_ID_PATTERN');
    });
    // Modal stays open on error so the user can fix + retry.
    expect(screen.getByTestId('tytus-apps-install-modal')).toBeTruthy();
  });

  it('drives onUninstall via a confirm step on installed-app rows', async () => {
    const onUninstall = vi.fn(async () => {});
    let calls = 0;
    render(
      <TytusAppsTab
        loadInstalledApps={async () => {
          calls++;
          return calls > 1
            ? []
            : [row('shiny', 'installed', { builtinProtected: false })];
        }}
        onUninstall={onUninstall}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-app-card-shiny'));
    // First click → confirm step.
    fireEvent.click(screen.getByTestId('tytus-app-uninstall-shiny'));
    expect(onUninstall).not.toHaveBeenCalled();
    // Second click on the confirm button → actually uninstalls.
    fireEvent.click(screen.getByTestId('tytus-app-uninstall-confirm-shiny'));
    await waitFor(() => {
      expect(onUninstall).toHaveBeenCalledWith('shiny');
      // Refreshed list — row gone.
      expect(screen.queryByTestId('tytus-app-card-shiny')).toBeNull();
    });
  });

  it('drives onReinstall when manifestUrl is set', async () => {
    const onReinstall = vi.fn(async () =>
      row('shiny', 'installed', {
        builtinProtected: false,
        manifestUrl: 'https://cdn.example.com/shiny/tytus-app.json',
        manifest: {
          version: '1.1.0',
        } as unknown as InstalledAppRow['manifest'],
      }),
    );
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('shiny', 'installed', {
            builtinProtected: false,
            manifestUrl: 'https://cdn.example.com/shiny/tytus-app.json',
          }),
        ]}
        onReinstall={onReinstall}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-app-card-shiny'));
    fireEvent.click(screen.getByTestId('tytus-app-reinstall-shiny'));
    await waitFor(() => {
      expect(onReinstall).toHaveBeenCalledWith('shiny');
    });
  });

  it('hides the Reinstall button when manifestUrl is null', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('shiny', 'installed', {
            builtinProtected: false,
            manifestUrl: null,
          }),
        ]}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-app-card-shiny'));
    expect(screen.queryByTestId('tytus-app-reinstall-shiny')).toBeNull();
  });

  it('renders Featured apps catalog when no entries are installed yet', async () => {
    render(<TytusAppsTab loadInstalledApps={async () => []} />);
    await waitFor(() => {
      expect(screen.getByTestId('tytus-apps-featured')).toBeTruthy();
      expect(screen.getByTestId('tytus-featured-card-text-editor')).toBeTruthy();
      expect(screen.getByTestId('tytus-featured-card-code-editor')).toBeTruthy();
      expect(screen.getByTestId('tytus-featured-card-api-tester')).toBeTruthy();
    });
  });

  it('hides Featured cards whose id is already in installed_apps', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('text-editor', 'installed', { manifestUrl: 'x' }),
        ]}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('tytus-featured-card-text-editor')).toBeNull();
      // Other featured entries still show.
      expect(screen.getByTestId('tytus-featured-card-code-editor')).toBeTruthy();
    });
  });

  it('drives doInstall with the Featured manifest URL on Install click', async () => {
    const onInstallFromUrl = vi.fn(async (manifestUrl: string) =>
      row('code-editor', 'installed', { manifestUrl }),
    );
    render(
      <TytusAppsTab
        loadInstalledApps={async () => []}
        onInstallFromUrl={onInstallFromUrl}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-featured-install-code-editor'));
    fireEvent.click(screen.getByTestId('tytus-featured-install-code-editor'));
    await waitFor(() => {
      expect(onInstallFromUrl).toHaveBeenCalledWith(
        expect.stringContaining('cdn.jsdelivr.net/gh/traylinx/tytus-app-code-editor@v0.1.0/tytus-app.json'),
      );
    });
  });

  it('hides the entire Featured section when every catalog entry is installed', async () => {
    render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('juli3ta', 'installed', { manifestUrl: 'x' }),
          row('text-editor', 'installed', { manifestUrl: 'x' }),
          row('code-editor', 'installed', { manifestUrl: 'x' }),
          row('markdown-preview', 'installed', { manifestUrl: 'x' }),
          row('photo-editor', 'installed', { manifestUrl: 'x' }),
          row('api-tester', 'installed', { manifestUrl: 'x' }),
        ]}
      />,
    );
    await waitFor(() => screen.getByTestId('tytus-app-card-text-editor'));
    expect(screen.queryByTestId('tytus-apps-featured')).toBeNull();
  });

  it('sorts system apps alphabetically by name', async () => {
    const { container } = render(
      <TytusAppsTab
        loadInstalledApps={async () => [
          row('zeta', 'bundled', {
            manifest: { name: 'Zeta App' } as Manifest,
          }),
          row('alpha', 'bundled', {
            manifest: { name: 'Alpha App' } as Manifest,
          }),
        ]}
      />,
    );
    await waitFor(() => {
      const cards = container.querySelectorAll('[data-testid^="tytus-app-card-"]');
      expect(cards[0].getAttribute('data-testid')).toBe('tytus-app-card-alpha');
      expect(cards[1].getAttribute('data-testid')).toBe('tytus-app-card-zeta');
    });
  });
});
