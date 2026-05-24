/**
 * host-fs-health — observability for the daemon-backed host.fs.
 *
 * The daemon FsApi (host-fs-daemon.ts) does not silently fall back to
 * localStorage on mid-session network errors — the "stable id ⇒ stable
 * backend" invariant means a write that lands on the daemon must read
 * back from the daemon. So when the daemon is unreachable, apps see
 * thrown errors and the user sees broken behavior with no signal.
 *
 * This module is a thin observer. It collects transport events from the
 * daemon FsApi (success / error / fallback) and exposes a coarse
 * status: 'unknown' | 'ok' | 'degraded' | 'offline'. A periodic probe
 * (visibility-gated) checks the `/api/files/list?source=user-documents`
 * endpoint so we can flip back to 'ok' once the daemon recovers without
 * waiting for the next user-driven FS call.
 *
 * No mutation to the daemon code path: this module is read-only
 * observability. Apps consume the status via `useHostFsHealth`; the
 * shell renders `<HostFsStatusChip>` in the top panel when status≠ok.
 */

export type HostFsStatus = 'unknown' | 'ok' | 'degraded' | 'offline';

export type HostFsTransportEvent =
  | { kind: 'success'; op: string }
  | { kind: 'error'; op: string; error: unknown }
  | { kind: 'fallback'; op: string; reason: string };

export interface HostFsHealthSnapshot {
  status: HostFsStatus;
  lastChecked: number | null;
  lastError: string | null;
  fallbackOpsCount: number;
  errorOpsCount: number;
  successOpsCount: number;
}

export interface HostFsHealth {
  getSnapshot(): HostFsHealthSnapshot;
  subscribe(listener: (snapshot: HostFsHealthSnapshot) => void): () => void;
  record(event: HostFsTransportEvent): void;
  startProbe(): void;
  stopProbe(): void;
}

export interface HostFsHealthOptions {
  /** Probe interval in ms while tab is visible. Default 30000. */
  probeIntervalMs?: number;
  /** Probe timeout in ms. Default 800. */
  probeTimeoutMs?: number;
  /** Number of errors in errorWindowMs that flips status to 'offline'. Default 3. */
  offlineErrorThreshold?: number;
  /** Sliding window for error counting. Default 60000. */
  errorWindowMs?: number;
  /** Injected fetch (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Probe URL. Default `/api/files/list?source=user-documents`. */
  probeUrl?: string;
  /** Injected scheduler (tests). Defaults to globalThis setTimeout/clearTimeout. */
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  /** Document for visibility wiring (tests). Default globalThis.document. */
  documentImpl?: Document;
  /** Now (tests). Default Date.now. */
  now?: () => number;
}

export function createHostFsHealth(opts: HostFsHealthOptions = {}): HostFsHealth {
  const probeIntervalMs = opts.probeIntervalMs ?? 30_000;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 800;
  const offlineErrorThreshold = opts.offlineErrorThreshold ?? 3;
  const errorWindowMs = opts.errorWindowMs ?? 60_000;
  const probeUrl = opts.probeUrl ?? '/api/files/list?source=user-documents';
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const setTimeoutImpl =
    opts.setTimeoutImpl ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimeoutImpl =
    opts.clearTimeoutImpl ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const documentImpl: Document | undefined =
    opts.documentImpl ?? (typeof document !== 'undefined' ? document : undefined);
  const now = opts.now ?? Date.now;

  let status: HostFsStatus = 'unknown';
  let lastChecked: number | null = null;
  let lastError: string | null = null;
  let fallbackOpsCount = 0;
  let errorOpsCount = 0;
  let successOpsCount = 0;
  const errorTimestamps: number[] = [];

  const listeners = new Set<(snapshot: HostFsHealthSnapshot) => void>();
  let probeHandle: unknown = null;
  let probeStarted = false;
  let firstErrorWarned = false;
  let visibilityListener: (() => void) | null = null;

  // Cache the snapshot so `useSyncExternalStore` sees a stable reference
  // between renders. We only build a new object when one of the
  // observable fields changes (via `invalidate()`). Returning a fresh
  // object every call would cause React to think the store changed on
  // every render and loop indefinitely.
  let cachedSnapshot: HostFsHealthSnapshot = {
    status,
    lastChecked,
    lastError,
    fallbackOpsCount,
    errorOpsCount,
    successOpsCount,
  };

  const invalidate = (): void => {
    cachedSnapshot = {
      status,
      lastChecked,
      lastError,
      fallbackOpsCount,
      errorOpsCount,
      successOpsCount,
    };
  };

  const snapshot = (): HostFsHealthSnapshot => cachedSnapshot;

  const emit = (): void => {
    invalidate();
    const snap = cachedSnapshot;
    for (const listener of listeners) {
      try {
        listener(snap);
      } catch (err) {
        console.error('[host-fs-health] listener threw', err);
      }
    }
  };

  const setStatus = (next: HostFsStatus): void => {
    status = next;
  };

  const pruneErrorWindow = (): void => {
    const cutoff = now() - errorWindowMs;
    while (errorTimestamps.length > 0 && errorTimestamps[0] < cutoff) {
      errorTimestamps.shift();
    }
  };

  const isProbeAllowed = (): boolean => {
    if (!fetchImpl) return false;
    if (!documentImpl) return true;
    return documentImpl.visibilityState !== 'hidden';
  };

  const runProbe = async (): Promise<void> => {
    if (!fetchImpl) return;
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutHandle = controller
      ? setTimeoutImpl(() => controller.abort(), probeTimeoutMs)
      : null;
    try {
      const res = await fetchImpl(probeUrl, {
        method: 'GET',
        credentials: 'same-origin',
        signal: controller?.signal,
      });
      lastChecked = now();
      if (res.ok) {
        successOpsCount += 1;
        errorTimestamps.length = 0;
        lastError = null;
        setStatus('ok');
      } else {
        recordErrorInternal(`probe ${res.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastChecked = now();
      recordErrorInternal(message);
    } finally {
      if (timeoutHandle !== null) clearTimeoutImpl(timeoutHandle);
      emit();
    }
  };

  const scheduleProbe = (): void => {
    if (!probeStarted) return;
    probeHandle = setTimeoutImpl(() => {
      void runProbeAndReschedule();
    }, probeIntervalMs);
  };

  const runProbeAndReschedule = async (): Promise<void> => {
    if (!probeStarted) return;
    if (isProbeAllowed()) {
      await runProbe();
    }
    scheduleProbe();
  };

  const recordErrorInternal = (message: string): void => {
    errorOpsCount += 1;
    lastError = message;
    errorTimestamps.push(now());
    pruneErrorWindow();
    if (!firstErrorWarned) {
      firstErrorWarned = true;
      console.warn('[host-fs-health] first daemon FS error:', message);
    }
    if (errorTimestamps.length >= offlineErrorThreshold) {
      setStatus('offline');
    } else if (status !== 'offline') {
      setStatus('degraded');
    }
    // Caller is responsible for emit() (record + runProbe both do).
  };

  return {
    getSnapshot: snapshot,

    subscribe(listener) {
      listeners.add(listener);
      try {
        listener(snapshot());
      } catch (err) {
        console.error('[host-fs-health] subscribe listener threw', err);
      }
      return () => {
        listeners.delete(listener);
      };
    },

    record(event) {
      if (event.kind === 'success') {
        successOpsCount += 1;
        errorTimestamps.length = 0;
        lastError = null;
        setStatus('ok');
      } else if (event.kind === 'error') {
        const message =
          event.error instanceof Error
            ? event.error.message
            : String(event.error);
        recordErrorInternal(`${event.op}: ${message}`);
      } else {
        fallbackOpsCount += 1;
      }
      emit();
    },

    startProbe() {
      if (probeStarted) return;
      probeStarted = true;
      if (documentImpl && typeof documentImpl.addEventListener === 'function') {
        visibilityListener = () => {
          if (
            documentImpl.visibilityState !== 'hidden' &&
            status !== 'ok' &&
            isProbeAllowed()
          ) {
            void runProbe();
          }
        };
        documentImpl.addEventListener('visibilitychange', visibilityListener);
      }
      // Kick off an immediate probe so the chip flips on the first tick.
      void runProbeAndReschedule();
    },

    stopProbe() {
      probeStarted = false;
      if (probeHandle !== null) {
        clearTimeoutImpl(probeHandle);
        probeHandle = null;
      }
      if (
        visibilityListener &&
        documentImpl &&
        typeof documentImpl.removeEventListener === 'function'
      ) {
        documentImpl.removeEventListener('visibilitychange', visibilityListener);
        visibilityListener = null;
      }
    },
  };
}

let singleton: HostFsHealth | null = null;

/** Process-wide singleton wired by host-impl + consumed by useHostFsHealth. */
export function getHostFsHealth(): HostFsHealth {
  if (!singleton) singleton = createHostFsHealth();
  return singleton;
}

/** Test-only: reset the singleton between tests. */
export function __resetHostFsHealthForTests(): void {
  if (singleton) singleton.stopProbe();
  singleton = null;
}
