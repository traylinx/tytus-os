import { useEffect, useRef, useState } from "react";
import type {
  DaemonClient,
} from "@/lib/daemon";
import type {
  DaemonError,
  DaemonVersion,
  StateSnapshot,
} from "@/types/daemon";

export type DaemonStatus =
  | "loading"
  | "online"
  | "offline"           // immediate banner: ECONNREFUSED / port file missing
  | "degraded"          // transient errors counted; banner after threshold
  | "auth_required";

export interface UseDaemonStateResult {
  state: StateSnapshot | null;
  error: DaemonError | null;
  status: DaemonStatus;
  failureCount: number;
  /** True when the offline banner should be visible per A1a / A1b. */
  bannerVisible: boolean;
  /**
   * Daemon identity derived from the latest /api/state response (the
   * `daemon_version` + `daemon_started_at` fields landed alongside
   * the existing snapshot, no separate /api/version request fires).
   *
   * `null` when:
   *   • The daemon predates the state-includes-version sprint and
   *     omits both fields. Restart detection stays inert in that case.
   *   • The first /api/state poll hasn't completed yet.
   *
   * Consumers depend on `version?.daemon_started_at` in a useEffect
   * to detect daemon restart and drop in-flight job state — the
   * registry is in-memory so every active job_id is invalid past a
   * restart.
   */
  version: DaemonVersion | null;
  /** Force an immediate refresh (e.g. after user starts the daemon). */
  refresh: () => void;
}

export interface UseDaemonStateOptions {
  client: DaemonClient;
  /** Polling interval in ms. Default 2000. */
  intervalMs?: number;
  /** Transient failures before banner per A1b. Default 3. */
  bannerThreshold?: number;
}

/**
 * Pull `daemon_version` + `daemon_started_at` off a StateSnapshot if
 * the daemon advertises them. Returns `null` for pre-sprint daemons
 * so consumers can branch on it cleanly. Both fields are optional on
 * the wire and arrive together; if either is missing we treat the
 * pair as absent (don't surface a half-populated DaemonVersion).
 */
const versionFromState = (s: StateSnapshot): DaemonVersion | null => {
  if (
    typeof s.daemon_version === "string" &&
    typeof s.daemon_started_at === "number"
  ) {
    return {
      daemon_version: s.daemon_version,
      daemon_pid: s.daemon_pid,
      daemon_started_at: s.daemon_started_at,
    };
  }
  return null;
};

export const useDaemonState = (
  options: UseDaemonStateOptions,
): UseDaemonStateResult => {
  const { client, intervalMs = 2000, bannerThreshold = 3 } = options;
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [error, setError] = useState<DaemonError | null>(null);
  const [status, setStatus] = useState<DaemonStatus>("loading");
  const [failureCount, setFailureCount] = useState(0);
  const [version, setVersion] = useState<DaemonVersion | null>(null);
  const [tick, setTick] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let abort: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      timer = setTimeout(() => {
        if (!cancelledRef.current) run();
      }, intervalMs);
    };

    const run = async () => {
      abort = new AbortController();
      const stateR = await client.getState(abort.signal);
      if (cancelledRef.current) return;
      if (stateR.ok) {
        setState(stateR.value);
        setError(null);
        setFailureCount(0);
        setStatus(stateR.value.logged_in ? "online" : "auth_required");
        // Version derives from the same response — last-known wins
        // across transient blips (we only update when stateR.ok, so
        // a failed poll never wipes the cached value).
        const v = versionFromState(stateR.value);
        if (v) setVersion(v);
      } else {
        setError(stateR.error);
        if (stateR.error.code === "daemon_offline") {
          // A1a: immediate.
          setStatus("offline");
          setFailureCount((c) => c + 1);
        } else if (stateR.error.code === "auth_required") {
          setStatus("auth_required");
          setFailureCount(0);
        } else {
          // transient — count toward A1b banner.
          setFailureCount((c) => c + 1);
          setStatus("degraded");
        }
      }
      schedule();
    };

    run();

    return () => {
      cancelledRef.current = true;
      if (abort) abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [client, intervalMs, tick]);

  const bannerVisible =
    status === "offline" ||
    (status === "degraded" && failureCount >= bannerThreshold);

  return {
    state,
    error,
    status,
    failureCount,
    bannerVisible,
    version,
    refresh: () => setTick((t) => t + 1),
  };
};
