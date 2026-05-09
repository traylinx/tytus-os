/**
 * AppRouter routing tests.
 *
 * Focus: confirm that AppRouter consults the live `installed_apps`
 * map (via `useInstalledAppIds`) to decide whether to mount
 * `WorkspaceAppHost` or fall through to the static switch /
 * `AppPlaceholder`. This is the bug fix landing point — before the
 * fix, only ids in the hardcoded `WORKSPACE_APP_IDS` Set could open
 * via the dynamic loader, so any third-party app (e.g. `todoist`)
 * installed via "Install from URL" rendered as <AppPlaceholder/>.
 *
 * We mock the heavy concrete app modules (`WorkspaceAppHost`,
 * `AppPlaceholder`) plus the `useInstalledAppIds` hook so the test
 * runs fast and deterministically. The other static-switch app
 * components are imported by the module but never rendered for the
 * appIds under test, so their bodies don't run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Mock the dynamic-loader-driven host so we can assert "did the router
// decide to use it?" without spinning up SQLite.
vi.mock('./WorkspaceAppHost', () => ({
  default: ({ appId }: { appId: string }) => (
    <div data-testid={`workspace-host-${appId}`}>workspace:{appId}</div>
  ),
}));

vi.mock('./AppPlaceholder', () => ({
  default: ({ appId }: { appId: string }) => (
    <div data-testid={`placeholder-${appId}`}>placeholder:{appId}</div>
  ),
}));

// Hoisted mock for the live-installed-apps hook. Tests reassign
// `installedIdsMock` via `setInstalledIds(...)` to control what the
// router sees.
const { installedIdsRef, setInstalledIds } = vi.hoisted(() => {
  const ref = { current: new Map<string, 'bundled' | 'installed' | 'alias'>() };
  return {
    installedIdsRef: ref,
    setInstalledIds: (m: Map<string, 'bundled' | 'installed' | 'alias'>) => {
      ref.current = m;
    },
  };
});

vi.mock('@/runtime/hooks/use-installed-app-ids', () => ({
  useInstalledAppIds: () => installedIdsRef.current,
}));

// Import AFTER the mocks so the static `import WorkspaceAppHost from
// './WorkspaceAppHost'` resolves to our stub.
import AppRouter from './AppRouter';

describe('AppRouter — installed-apps routing (regression: third-party Open)', () => {
  beforeEach(() => {
    cleanup();
    setInstalledIds(new Map());
  });

  it('mounts WorkspaceAppHost for an id whose installed_apps row has kind="installed"', () => {
    // Repro the original bug fixture: a freshly-installed third-party
    // app whose id is NOT in the static WORKSPACE_APP_IDS_HINT. Before
    // the fix this fell through to AppPlaceholder.
    setInstalledIds(new Map([['todoist', 'installed']]));
    render(<AppRouter appId="todoist" windowId="w1" />);

    expect(screen.getByTestId('workspace-host-todoist')).toBeTruthy();
    expect(screen.queryByTestId('placeholder-todoist')).toBeNull();
  });

  it('mounts WorkspaceAppHost for an id whose installed_apps row has kind="bundled"', () => {
    setInstalledIds(new Map([['memo', 'bundled']]));
    render(<AppRouter appId="memo" windowId="w1" />);
    expect(screen.getByTestId('workspace-host-memo')).toBeTruthy();
  });

  it('falls through to the static switch / AppPlaceholder for an unknown id when the live map is non-empty', () => {
    // Map non-empty (DB has booted) but doesn't contain `notarealapp`,
    // so the fast-path Set is also bypassed. Should hit the default
    // case of the static switch.
    setInstalledIds(new Map([['todoist', 'installed']]));
    render(<AppRouter appId="notarealapp" windowId="w1" />);
    expect(screen.getByTestId('placeholder-notarealapp')).toBeTruthy();
  });

  it('falls back to the WORKSPACE_APP_IDS_HINT Set on first render when the live map is still empty', () => {
    // Empty map = SQLite still booting. The hint Set carries the 11
    // build-time ids so we don't flash a placeholder for them.
    setInstalledIds(new Map());
    render(<AppRouter appId="memo" windowId="w1" />);
    expect(screen.getByTestId('workspace-host-memo')).toBeTruthy();
  });



  it('does not flash the static placeholder for Atomek while installed_apps hydrates', () => {
    setInstalledIds(new Map());
    render(<AppRouter appId="atomek" windowId="w1" />);
    expect(screen.getByTestId('workspace-host-atomek')).toBeTruthy();
    expect(screen.queryByTestId('placeholder-atomek')).toBeNull();
  });

  it('honours LEGACY_APP_ID_ALIASES when consulting the live installed_apps map', () => {
    // The legacy `notes` id is aliased to `memo` — a bundled row at
    // `memo` should win even when the request comes in via the
    // legacy id.
    setInstalledIds(new Map([['memo', 'bundled']]));
    render(<AppRouter appId="notes" windowId="w1" />);
    expect(screen.getByTestId('workspace-host-memo')).toBeTruthy();
  });

  it('mounts WorkspaceAppHost for an arbitrary id once the row appears (simulates post-install re-render)', () => {
    // First render with empty map — non-bundled id falls to placeholder.
    setInstalledIds(new Map());
    const { rerender } = render(
      <AppRouter appId="todoist" windowId="w1" />,
    );
    expect(screen.getByTestId('placeholder-todoist')).toBeTruthy();

    // Now the install completes; the next render sees the row.
    setInstalledIds(new Map([['todoist', 'installed']]));
    rerender(<AppRouter appId="todoist" windowId="w1" />);
    expect(screen.getByTestId('workspace-host-todoist')).toBeTruthy();
  });
});
