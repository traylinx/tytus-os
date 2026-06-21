import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@/i18n';
import { DaemonClientProvider } from '@/hooks/useDaemonClient';
import type { DaemonClient } from '@/lib/daemon';
import type { UpdateStatus } from '@/types/daemon/UpdateStatus';
import SoftwareUpdateModal from './SoftwareUpdateModal';

function makeStatus(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    current_version: '0.7.63',
    installed_version: '0.7.63',
    latest_version: '0.7.66',
    release_tag: 'v0.7.66',
    release_url: 'https://github.com/traylinx/tytus-cli/releases/tag/v0.7.66',
    install_url: 'https://get.traylinx.com/install.sh',
    install_command: 'curl -fsSL https://get.traylinx.com/install.sh | bash',
    can_install: true,
    channel: 'stable',
    status: 'update_available',
    automatic_checks: true,
    last_checked_at: 1,
    checked_at: 1,
    detail: 'Tytus 0.7.66 is available.',
    ...over,
  };
}

// Minimal DaemonClient stub — the hook only touches these three methods.
function makeClient(
  status: UpdateStatus,
  over: Partial<Pick<DaemonClient, 'postUpdateCheck' | 'getUpdateStatus' | 'postUpdateInstall'>> = {},
): DaemonClient {
  return {
    postUpdateCheck: vi.fn().mockResolvedValue({ ok: true, value: status }),
    getUpdateStatus: vi.fn().mockResolvedValue({ ok: true, value: status }),
    postUpdateInstall: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { ok: true, command: status.install_command, message: 'Update started. Tytus will restart.' } }),
    ...over,
  } as unknown as DaemonClient;
}

function renderModal(client: DaemonClient) {
  return render(
    <I18nProvider>
      <DaemonClientProvider client={client}>
        <SoftwareUpdateModal />
      </DaemonClientProvider>
    </I18nProvider>,
  );
}

describe('SoftwareUpdateModal', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forces a fresh check on mount and shows the window when an update is available', async () => {
    const client = makeClient(makeStatus());
    renderModal(client);

    expect(await screen.findByText('Update available')).toBeTruthy();
    expect(screen.getByText(/0\.7\.66 is ready to install/)).toBeTruthy();
    // The mount-time forced re-check is what defeats a stale "up to date" cache.
    expect(client.postUpdateCheck).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the daemon reports up_to_date', async () => {
    const client = makeClient(makeStatus({ status: 'up_to_date' }));
    renderModal(client);

    // Give the mount effect a tick, then assert no dialog.
    await waitFor(() => expect(client.postUpdateCheck).toHaveBeenCalled());
    expect(screen.queryByText('Update available')).toBeNull();
  });

  it('installs via the daemon and shows the result when "Update now" is clicked', async () => {
    const client = makeClient(makeStatus());
    renderModal(client);

    const btn = await screen.findByRole('button', { name: /update now/i });
    fireEvent.click(btn);

    await waitFor(() => expect(client.postUpdateInstall).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Update started\. Tytus will restart\./)).toBeTruthy();
  });

  it('"Later" dismisses the current version and persists it', async () => {
    const client = makeClient(makeStatus());
    renderModal(client);

    fireEvent.click(await screen.findByRole('button', { name: /later/i }));

    await waitFor(() => expect(screen.queryByText('Update available')).toBeNull());
    expect(localStorage.getItem('tytus.update.dismissedVersion')).toBe('0.7.66');
  });

  it('stays hidden for a version the user already dismissed', async () => {
    localStorage.setItem('tytus.update.dismissedVersion', '0.7.66');
    const client = makeClient(makeStatus());
    renderModal(client);

    await waitFor(() => expect(client.postUpdateCheck).toHaveBeenCalled());
    expect(screen.queryByText('Update available')).toBeNull();
  });

  it('shows the install command (no Update button) when the daemon cannot self-install', async () => {
    const client = makeClient(makeStatus({ can_install: false }));
    renderModal(client);

    expect(await screen.findByText('Update available')).toBeTruthy();
    expect(screen.getByText(/curl -fsSL https:\/\/get\.traylinx\.com\/install\.sh/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /update now/i })).toBeNull();
  });
});
