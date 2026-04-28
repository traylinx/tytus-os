import { useEffect, useRef, useState } from "react";
import type {
  DaemonClient,
} from "@/lib/daemon";
import type {
  DaemonError,
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
      const r = await client.getState(abort.signal);
      if (cancelledRef.current) return;
      if (r.ok) {
        setState(r.value);
        setError(null);
        setFailureCount(0);
        setStatus(r.value.logged_in ? "online" : "auth_required");
      } else {
        setError(r.error);
        if (r.error.code === "daemon_offline") {
          // A1a: immediate.
          setStatus("offline");
          setFailureCount((c) => c + 1);
        } else if (r.error.code === "auth_required") {
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
    refresh: () => setTick((t) => t + 1),
  };
};
