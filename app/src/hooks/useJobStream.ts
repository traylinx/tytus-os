import { useEffect, useRef, useState } from "react";

// Minimal EventSource shape — happy-dom and the browser implement this.
// We accept a custom constructor for tests.
export interface EventSourceLike {
  addEventListener(
    type: string,
    listener: (e: MessageEvent | { data: string }) => void,
  ): void;
  close(): void;
  readyState?: number;
  onerror?: ((e: Event) => void) | null;
}

export type EventSourceCtor = new (url: string) => EventSourceLike;

export type JobStatus =
  | "subscribing"
  | "streaming"
  | "success"
  | "failed"
  | "lost";

export interface UseJobStreamResult {
  status: JobStatus;
  lines: string[];
  exitCode: number | null;
  donePayload: unknown | null;
  failMessage: string | null;
}

export interface UseJobStreamOptions {
  url: string | null;
  /** Override for tests. Defaults to global EventSource. */
  EventSourceCtor?: EventSourceCtor;
  /** Late-subscribe deadline per A19. After this many ms with no events
   *  AND no `exit`, treat the stream as already-finished and resolve with
   *  empty lines + status `lost`. Default 8000ms — long enough to cover
   *  Rust-subprocess spawn time for `tytus doctor` and `tytus test`,
   *  short enough that a genuinely dead daemon still surfaces. The old
   *  1000ms default was too aggressive: doctor on a cold daemon takes
   *  ~2-3s before the first log line and consistently went `lost`. */
  lateSubscribeDeadlineMs?: number;
  /** When the connection errors before any event arrives, retry the
   *  subscription once after this delay. Covers the POST→register→GET
   *  race where the SSE handler 404s because the registry hasn't
   *  committed the job yet. Default 500ms. Set to 0 to disable. */
  reconnectDelayMs?: number;
  /** Native EventSource fires `error` both for real disconnects and for
   *  transient reconnect cycles. After logs have already arrived, give the
   *  browser a short grace window to reconnect and receive the terminal
   *  `exit`/`done`/`fail` event before surfacing "lost" to the UI. */
  streamDropGraceMs?: number;
}

export const useJobStream = (
  options: UseJobStreamOptions,
): UseJobStreamResult => {
  const {
    url,
    lateSubscribeDeadlineMs = 8000,
    reconnectDelayMs = 500,
    streamDropGraceMs = 5000,
  } = options;
  const [status, setStatus] = useState<JobStatus>("subscribing");
  const [lines, setLines] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [donePayload, setDonePayload] = useState<unknown | null>(null);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const sourceRef = useRef<EventSourceLike | null>(null);

  useEffect(() => {
    // Reset on url change. The lint rule warns about setState-in-effect,
    // but this is a deliberate sync of derived per-url state — there's no
    // external system to subscribe to until we know the url.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!url) {
      setStatus("subscribing");
      setLines([]);
      setExitCode(null);
      setDonePayload(null);
      setFailMessage(null);
      return;
    }
    setStatus("subscribing");
    setLines([]);
    setExitCode(null);
    setDonePayload(null);
    setFailMessage(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    const Ctor =
      options.EventSourceCtor ??
      (globalThis as unknown as { EventSource: EventSourceCtor }).EventSource;
    if (!Ctor) {
      setStatus("lost");
      return;
    }

    let receivedAny = false;
    let terminal = false;
    let attempt = 0;
    let lateTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let streamDropTimer: ReturnType<typeof setTimeout> | null = null;

    const clearStreamDropTimer = () => {
      if (streamDropTimer) {
        clearTimeout(streamDropTimer);
        streamDropTimer = null;
      }
    };

    const onLog = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      clearStreamDropTimer();
      setStatus("streaming");
      const data = (e as { data: string }).data ?? "";
      setLines((prev) => [...prev, data]);
    };

    const onExit = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      terminal = true;
      clearStreamDropTimer();
      const raw = (e as { data: string }).data ?? "";
      let code: number | null = null;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.code === "number") code = parsed.code;
      } catch {
        // best-effort; treat as failure if unparseable
      }
      setExitCode(code);
      setStatus(code === 0 ? "success" : "failed");
      sourceRef.current?.close();
    };

    const onDone = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      terminal = true;
      clearStreamDropTimer();
      const data = (e as { data: string }).data ?? "";
      let payload: unknown = data;
      try {
        payload = JSON.parse(data);
      } catch {
        // Install jobs normally emit JSON, but keep the raw terminal payload
        // visible if an older daemon or failing CLI sends plain text.
      }
      setDonePayload(payload);
      setExitCode(0);
      setStatus("success");
      sourceRef.current?.close();
    };

    const onFail = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      terminal = true;
      clearStreamDropTimer();
      const data = (e as { data: string }).data ?? "";
      setFailMessage(data);
      setExitCode(null);
      setStatus("failed");
      sourceRef.current?.close();
    };

    // Connection died. If we'd already seen a terminal event, ignore — close
    // fired naturally after done/fail/exit. Otherwise:
    //   - If we'd received non-terminal events, the stream really dropped → lost.
    //   - If we'd received nothing at all and this is the first attempt,
    //     retry once after `reconnectDelayMs`. Handles the POST→register→GET
    //     race where the daemon's SSE handler 404s because the registry
    //     hasn't committed the job yet.
    const onError = () => {
      if (terminal) return;
      if (receivedAny) {
        if (!streamDropTimer) {
          streamDropTimer = setTimeout(() => {
            if (!terminal) setStatus("lost");
          }, streamDropGraceMs);
        }
        return;
      }
      if (attempt < 1 && reconnectDelayMs > 0) {
        attempt += 1;
        sourceRef.current?.close();
        sourceRef.current = null;
        reconnectTimer = setTimeout(() => {
          if (terminal) return;
          openSource();
        }, reconnectDelayMs);
        return;
      }
      setStatus("lost");
    };

    const openSource = () => {
      const src = new Ctor(url);
      sourceRef.current = src;
      src.addEventListener("log", onLog);
      src.addEventListener("done", onDone);
      src.addEventListener("fail", onFail);
      src.addEventListener("exit", onExit);
      src.onerror = onError;
    };

    openSource();

    // Late-subscribe deadline: if no events arrive within this window AND
    // no terminal event has fired, surface as `lost` so the UI doesn't
    // spin forever. Reset by any incoming event via `receivedAny`.
    lateTimer = setTimeout(() => {
      if (!receivedAny && !terminal) {
        setStatus("lost");
        sourceRef.current?.close();
      }
    }, lateSubscribeDeadlineMs);

    return () => {
      if (lateTimer) clearTimeout(lateTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearStreamDropTimer();
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [
    url,
    options.EventSourceCtor,
    lateSubscribeDeadlineMs,
    reconnectDelayMs,
    streamDropGraceMs,
  ]);

  return { status, lines, exitCode, donePayload, failMessage };
};
