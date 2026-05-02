import type { DaemonError, StateSnapshot } from "@/types/daemon";
import type { DaemonStatus } from "@/hooks/useDaemonState";

export type PillColor = "red" | "yellow" | "green" | "gray";

export interface PillState {
  color: PillColor;
  label: string;
  detail: string;
  kind?: "session-expired";
}

export const isRefreshTokenExpired = (error: string | null | undefined): boolean => {
  const normalized = (error ?? "").toLowerCase();
  return (
    normalized.includes("refresh token expired") ||
    normalized.includes("run `tytus login`") ||
    normalized.includes("run 'tytus login'") ||
    normalized.includes("no refresh token available")
  );
};

// Tri-state pill per Lope review fix #2.
//
//   green  = daemon_running && tunnel_active && keychain_healthy
//             && last_refresh_error === null
//   yellow = daemon_running && (! tunnel_active
//                                || ! keychain_healthy
//                                || last_refresh_error !== null)
//   red    = !daemon_running || status === 'offline'
//   gray   = loading / unknown
export const computePill = (
  status: DaemonStatus,
  state: StateSnapshot | null,
  error: DaemonError | null,
): PillState => {
  if (status === "loading") {
    return { color: "gray", label: "Checking", detail: "Polling daemon…" };
  }
  if (status === "offline") {
    return {
      color: "red",
      label: "Offline",
      detail: error?.message ?? "Daemon not reachable",
    };
  }
  if (!state) {
    return {
      color: "red",
      label: "No state",
      detail: error?.message ?? "Daemon returned no state",
    };
  }
  if (!state.daemon_running) {
    return { color: "red", label: "Stopped", detail: "Daemon not running" };
  }
  const issues: string[] = [];
  if (!state.tunnel_active) issues.push("tunnel down");
  if (!state.keychain_healthy) issues.push("keychain unhealthy");
  if (isRefreshTokenExpired(state.last_refresh_error)) {
    return {
      color: "yellow",
      label: "Session expired",
      detail:
        "Your Tytus session expired. Sign in again to refresh access; running pods stay online.",
      kind: "session-expired",
    };
  }
  if (state.last_refresh_error)
    issues.push(`refresh error: ${state.last_refresh_error}`);
  if (issues.length > 0) {
    return {
      color: "yellow",
      label: "Degraded",
      detail: issues.join(" · "),
    };
  }
  return {
    color: "green",
    label: "Connected",
    detail: `${state.tier} · ${state.units_used}/${state.units_limit} units`,
  };
};
