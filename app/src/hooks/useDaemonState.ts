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
   * Daemon identity from the latest successful /api/version poll.
   * Survives across transient state-fetch failures (last-known wins
   * until the version probe succeeds against a different daemon).
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
  // Forward-compat: older daemons (< the /api/version sprint) return
  // 404. After the first such 404 we stop polling /api/version on
  // this session — otherwise every state tick logs a red 404 in the
  // browser network tab and there's no graceful upgrade path. Reset
  // on `refresh()` so a re-detection happens after the user upgrades.
  const versionUnsupportedRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    versionUnsupportedRef.current = false;
    let abort: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      timer = setTimeout(() => {
        if (!cancelledRef.current) run();
      }, intervalMs);
    };

    const run = async () => {
      abort = new AbortController();
      // Parallel fetch — state drives the banner / status FSM, version
      // drives restart detection. Failures are independent: keep the
      // last-known version across transient state errors so a
      // half-second blip doesn't make the UI think the daemon
      // restarted.
      const [stateR, versionR] = await Promise.all([
        client.getState(abort.signal),
        versionUnsupportedRef.current
          ? Promise.resolve(null)
          : client.getVersion(abort.signal),
      ]);
      if (cancelledRef.current) return;
      if (versionR && versionR.ok) {
        setVersion(versionR.value);
      } else if (versionR && !versionR.ok && versionR.error.code === "not_found") {
        // Old daemon that predates /api/version. Stop probing for the
        // rest of this session — restart detection just stays inert.
        versionUnsupportedRef.current = true;
      }
      if (stateR.ok) {
        setState(stateR.value);
        setError(null);
        setFailureCount(0);
        setStatus(stateR.value.logged_in ? "online" : "auth_required");
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
