import type { EventSourceCtor, EventSourceLike } from "@/hooks/useJobStream";

// Configurable test double for SSE. Each instance receives a script of
// events delivered on a microtask after construction. Tests can also
// `.emitNow()` to drive timing manually.

export interface ScriptedEvent {
  type: "log" | "done" | "fail" | "exit";
  data: string;
}

export interface FakeEventSourceHandle {
  Ctor: EventSourceCtor;
  // every instance constructed during the test (last is current)
  instances: FakeEventSource[];
}

export class FakeEventSource implements EventSourceLike {
  url: string;
  closed = false;
  private listeners: Map<
    string,
    Array<(e: { data: string }) => void>
  > = new Map();
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(
    type: string,
    listener: (e: { data: string }) => void,
  ): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    if (this.closed) return;
    for (const l of this.listeners.get(type) ?? []) l({ data });
  }

  emitError(): void {
    if (this.onerror) this.onerror(new Event("error"));
  }

  emitOpen(): void {
    if (this.onopen) this.onopen(new Event("open"));
  }
}

/**
 * Parse a raw SSE wire-format transcript (as produced by the daemon's
 * /api/jobs/<id>/stream and captured into a fixture file) into the
 * ScriptedEvent[] shape this fake EventSource consumes. Phase 4 cont
 * uses this to drive useJobStream against a real-shape failure
 * transcript captured from `tytus doctor` against a stopped pod.
 *
 * Format expected:
 *   event: <type>
 *   data: <line>
 *   data: <line>      <-- multi-line continuation joined with "\n"
 *   <blank>           <-- terminates the event
 *   event: <type>
 *   ...
 *
 * Lines starting with `:` are SSE comments and are ignored. Unknown
 * event types throw — we don't want a typo in a fixture to silently
 * disappear into the void.
 */
export const parseSseTranscript = (raw: string): ScriptedEvent[] => {
  const out: ScriptedEvent[] = [];
  let type: string | null = null;
  const dataLines: string[] = [];
  const flush = () => {
    if (type === null && dataLines.length === 0) return;
    if (
      type !== "log" &&
      type !== "done" &&
      type !== "fail" &&
      type !== "exit"
    ) {
      throw new Error(
        `unknown SSE event type ${JSON.stringify(type)} in fixture`,
      );
    }
    out.push({ type, data: dataLines.join("\n") });
    type = null;
    dataLines.length = 0;
  };
  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine === "") {
      flush();
      continue;
    }
    if (rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    if (colon < 0) continue;
    const field = rawLine.slice(0, colon);
    let value = rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") type = value;
    else if (field === "data") dataLines.push(value);
  }
  flush();
  return out;
};

export interface FakeEventSourceOptions {
  /**
   * If false, the fake does NOT auto-emit script events on construction.
   * Tests that need to drive timing precisely (e.g. error-before-events
   * race repros) call `instance.emit(...)` themselves. Default true.
   */
  autoEmit?: boolean;
}

export const makeFakeEventSource = (
  scripts: Record<string, ScriptedEvent[]>,
  options: FakeEventSourceOptions = {},
): FakeEventSourceHandle => {
  const instances: FakeEventSource[] = [];
  const autoEmit = options.autoEmit ?? true;

  class FES extends FakeEventSource {
    constructor(url: string) {
      super(url);
      instances.push(this);
      const script = scripts[url];
      if (script && autoEmit) {
        // Deliver on a microtask so the listeners are attached first.
        queueMicrotask(() => {
          for (const ev of script) this.emit(ev.type, ev.data);
        });
      }
    }
  }

  return { Ctor: FES as unknown as EventSourceCtor, instances };
};
