import { useCallback, useEffect, useState } from "react";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import type {
  UpdateStatus,
  UpdateInstallResult,
} from "@/types/daemon/UpdateStatus";

// Per-version dismissal: "Later" suppresses the CURRENT available version, but a
// newer release later on re-opens the window (we only remember the exact version
// the user dismissed).
const DISMISS_KEY = "tytus.update.dismissedVersion";
// The daemon runs its own background update check; the OS just surfaces it. Poll
// hourly so a release published mid-session eventually shows without a restart.
const DEFAULT_POLL_MS = 60 * 60 * 1000;

export interface SoftwareUpdate {
  /** Latest known daemon update status (null until the first check returns). */
  status: UpdateStatus | null;
  /** True when an update is available, installable-or-manual, and not dismissed. */
  visible: boolean;
  installing: boolean;
  installResult: UpdateInstallResult | null;
  error: string | null;
  /** Kick off `tytus tray install` via the daemon. */
  install: () => Promise<void>;
  /** Suppress the window for the current available version. */
  dismiss: () => void;
  /** Force a fresh check (bypasses the daemon's cached status). */
  recheck: () => Promise<void>;
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * Drives the in-OS "update available" window.
 *
 * On mount it forces ONE fresh `/api/update/check` so a stale "up to date"
 * cache can't hide a release that shipped after the daemon's last background
 * poll (the exact failure mode behind "live docs offline" on an out-of-date
 * tray). It then refreshes `/api/update/status` on an interval. The window is
 * shown when the daemon reports `update_available` for a version the user has
 * not already dismissed.
 */
export function useSoftwareUpdate(opts?: { pollMs?: number }): SoftwareUpdate {
  const client = useDaemonClient();
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;

  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() =>
    readDismissed(),
  );
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<UpdateInstallResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Initial forced check, then fall back to the cached status if the check
  // endpoint is unavailable (older daemon, transient error).
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      let r = await client.postUpdateCheck(ac.signal);
      if (!r.ok) r = await client.getUpdateStatus(ac.signal);
      if (!cancelled && r.ok) setStatus(r.value);
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [client]);

  // Periodic refresh so a mid-session release eventually surfaces.
  useEffect(() => {
    if (pollMs <= 0) return;
    let cancelled = false;
    const id = setInterval(async () => {
      const r = await client.getUpdateStatus();
      if (!cancelled && r.ok) setStatus(r.value);
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, pollMs]);

  // The single source of truth for "which version is on offer" — used for
  // display, visibility, and dismissal so they can't disagree (a release that
  // carries only release_tag still shows and dismisses correctly).
  const availableVersion = status?.latest_version ?? status?.release_tag ?? null;

  const install = useCallback(async () => {
    setInstalling(true);
    setError(null);
    const r = await client.postUpdateInstall();
    setInstalling(false);
    if (r.ok) setInstallResult(r.value);
    else setError(r.error.message);
  }, [client]);

  const dismiss = useCallback(() => {
    if (availableVersion) {
      try {
        localStorage.setItem(DISMISS_KEY, availableVersion);
      } catch {
        /* ignore storage failures — dismissal is best-effort */
      }
      setDismissedVersion(availableVersion);
    }
    // Also clear any post-install result / error so Close fully dismisses the
    // window (the result panel keeps `open` true until this runs).
    setInstallResult(null);
    setError(null);
  }, [availableVersion]);

  const recheck = useCallback(async () => {
    setError(null);
    const r = await client.postUpdateCheck();
    if (r.ok) setStatus(r.value);
    else setError(r.error.message);
  }, [client]);

  const visible =
    !!status &&
    status.status === "update_available" &&
    !!availableVersion &&
    availableVersion !== dismissedVersion &&
    // Once the user has kicked off an install, keep the result panel but stop
    // treating it as a fresh prompt on the next poll.
    !installResult;

  return {
    status,
    visible,
    installing,
    installResult,
    error,
    install,
    dismiss,
    recheck,
  };
}
