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
   *  empty lines + status `lost`. Default 1000. */
  lateSubscribeDeadlineMs?: number;
}

export const useJobStream = (
  options: UseJobStreamOptions,
): UseJobStreamResult => {
  const { url, lateSubscribeDeadlineMs = 1000 } = options;
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

    const src = new Ctor(url);
    sourceRef.current = src;
    let receivedAny = false;
    let terminal = false;

    const onLog = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      setStatus("streaming");
      const data = (e as { data: string }).data ?? "";
      setLines((prev) => [...prev, data]);
    };

    const onExit = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      terminal = true;
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
      src.close();
    };

    const onDone = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      terminal = true;
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
      src.close();
    };

    const onFail = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      terminal = true;
      const data = (e as { data: string }).data ?? "";
      setFailMessage(data);
      setExitCode(null);
      setStatus("failed");
      src.close();
    };

    const onError = () => {
      // Connection died. If we'd already seen a terminal event, ignore — close
      // fired naturally after done/fail/exit.
      if (terminal) return;
      // If we never got any event AND the deadline has passed, treat as
      // late-subscribe race per A19.
      setStatus(receivedAny ? "lost" : "lost");
    };

    src.addEventListener("log", onLog);
    src.addEventListener("done", onDone);
    src.addEventListener("fail", onFail);
    src.addEventListener("exit", onExit);
    src.onerror = onError;

    // A19: if no events arrive within the deadline AND no exit, surface as
    // `lost`. The daemon-side fix (Q14 retain log) is still pending.
    const lateTimer = setTimeout(() => {
      if (!receivedAny && !terminal) {
        setStatus("lost");
        src.close();
      }
    }, lateSubscribeDeadlineMs);

    return () => {
      clearTimeout(lateTimer);
      src.close();
      sourceRef.current = null;
    };
  }, [url, options.EventSourceCtor, lateSubscribeDeadlineMs]);

  return { status, lines, exitCode, donePayload, failMessage };
};
