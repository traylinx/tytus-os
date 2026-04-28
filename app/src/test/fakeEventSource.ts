import type { EventSourceCtor, EventSourceLike } from "@/hooks/useJobStream";

// Configurable test double for SSE. Each instance receives a script of
// events delivered on a microtask after construction. Tests can also
// `.emitNow()` to drive timing manually.

export interface ScriptedEvent {
  type: "log" | "exit";
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
}

export const makeFakeEventSource = (
  scripts: Record<string, ScriptedEvent[]>,
): FakeEventSourceHandle => {
  const instances: FakeEventSource[] = [];

  class FES extends FakeEventSource {
    constructor(url: string) {
      super(url);
      instances.push(this);
      const script = scripts[url];
      if (script) {
        // Deliver on a microtask so the listeners are attached first.
        queueMicrotask(() => {
          for (const ev of script) this.emit(ev.type, ev.data);
        });
      }
    }
  }

  return { Ctor: FES as unknown as EventSourceCtor, instances };
};
