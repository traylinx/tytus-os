import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TytusAppsTab } from './TytusAppsTab';
import type { InstalledAppRow } from '@/runtime/installed-apps-repo';
import type { Manifest } from '@tytus/host-api';

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

  it('shows the post-v1 placeholder when no third-party apps are installed', async () => {
    render(<TytusAppsTab loadInstalledApps={async () => []} />);
    await waitFor(() => {
      expect(
        screen.getByText('Coming after v1 — third-party app installs.'),
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
