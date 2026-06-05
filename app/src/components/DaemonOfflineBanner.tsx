// ============================================================
// DaemonOfflineBanner — A1a / A1b shell banner
// ============================================================
//
// Owned by the shell (App.tsx). Visible above the TopPanel when the
// daemon is unreachable. Two trigger paths from useDaemonState:
//
//  - A1a: status === 'offline'   immediately (ECONNREFUSED / port file
//                                missing)
//  - A1b: status === 'degraded'  AND failureCount >= bannerThreshold
//                                (timeout / 5xx / malformed)
//
// CTA: "Start daemon" → POST /api/daemon/start; on success the next
// poll picks up the daemon and the banner self-dismisses.

import { memo, useCallback, useState } from "react";
import { AlertTriangle, Loader2, Power, RefreshCw } from "lucide-react";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import type { DaemonError } from "@/types/daemon";

interface Props {
  /** Whether useDaemonState has decided the banner should be visible. */
  visible: boolean;
  /** Last error from useDaemonState (for diagnostic copy). */
  error: DaemonError | null;
  /** Force an immediate /api/state refresh. */
  onRefresh: () => void;
}

const DaemonOfflineBanner = memo(function DaemonOfflineBanner({
  visible,
  error,
  onRefresh,
}: Props) {
  const client = useDaemonClient();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const onStart = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    const r = await client.postDaemonStart();
    setStarting(false);
    if (!r.ok) {
      setStartError(r.error.message);
    } else {
      onRefresh();
    }
  }, [client, onRefresh]);

  if (!visible) return null;

  const trayApiUnavailable = error?.message === "tray_api_unavailable";
  const title = trayApiUnavailable ? "Local control unavailable." : "Daemon offline.";
  const detail =
    trayApiUnavailable
      ? "TytusOS cannot reach the tray bridge. The daemon may still be running."
      : error?.code === "daemon_offline"
      ? "Tytus daemon is not running on this machine."
      : error?.code === "network_timeout"
        ? "Daemon is not responding."
        : error
          ? `Daemon error: ${error.message}`
          : "Daemon is unreachable.";

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[10000] px-4 py-2 flex items-center gap-3 text-sm"
      style={{
        background: "rgba(244,67,54,0.92)",
        color: "#fff",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
    >
      <AlertTriangle size={16} className="flex-shrink-0" />
      <span className="flex-1">
        <strong>{title}</strong>{" "}
        <span className="opacity-90">{detail}</span>
        {startError && (
          <span className="ml-2 opacity-90">— {startError}</span>
        )}
      </span>
      <button
        onClick={onStart}
        disabled={starting}
        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors"
        style={{
          background: "rgba(255,255,255,0.15)",
          opacity: starting ? 0.7 : 1,
        }}
      >
        {starting ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Power size={12} />
        )}
        Start daemon
      </button>
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors"
        style={{ background: "rgba(255,255,255,0.10)" }}
      >
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
});

export default DaemonOfflineBanner;
