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
      return;
    }
    setStatus("subscribing");
    setLines([]);
    setExitCode(null);
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
    let exited = false;

    const onLog = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      setStatus("streaming");
      const data = (e as { data: string }).data ?? "";
      setLines((prev) => [...prev, data]);
    };

    const onExit = (e: MessageEvent | { data: string }) => {
      receivedAny = true;
      exited = true;
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

    const onError = () => {
      // Connection died. If we'd already exited, ignore — close fired naturally.
      if (exited) return;
      // If we never got any event AND the deadline has passed, treat as
      // late-subscribe race per A19.
      setStatus(receivedAny ? "lost" : "lost");
    };

    src.addEventListener("log", onLog);
    src.addEventListener("exit", onExit);
    src.onerror = onError;

    // A19: if no events arrive within the deadline AND no exit, surface as
    // `lost`. The daemon-side fix (Q14 retain log) is still pending.
    const lateTimer = setTimeout(() => {
      if (!receivedAny && !exited) {
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

  return { status, lines, exitCode };
};
