import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useJobStream } from "@/hooks/useJobStream";
import { makeFakeEventSource, parseSseTranscript } from "@/test/fakeEventSource";
import sseDoctorFailureRaw from "@/test/fixtures/sse-doctor-failure.txt?raw";

describe("useJobStream", () => {
  it("collects log lines and resolves to success on exit code 0", async () => {
    const url = "/api/jobs/abc/stream";
    const { Ctor } = makeFakeEventSource({
      [url]: [
        { type: "log", data: "Tytus Doctor" },
        { type: "log", data: "  [OK] state_file" },
        { type: "exit", data: '{"code":0}' },
      ],
    });
    const { result } = renderHook(() =>
      useJobStream({ url, EventSourceCtor: Ctor }),
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.lines).toEqual([
      "Tytus Doctor",
      "  [OK] state_file",
    ]);
    expect(result.current.exitCode).toBe(0);
    expect(result.current.donePayload).toBeNull();
    expect(result.current.failMessage).toBeNull();
  });

  it("collects log lines and resolves to success on install done", async () => {
    const url = "/api/jobs/install/stream";
    const payload = '{"pod_id":"02","agent_type":"openclaw"}';
    const { Ctor } = makeFakeEventSource({
      [url]: [
        { type: "log", data: "Allocating pod…" },
        { type: "log", data: payload },
        { type: "done", data: payload },
      ],
    });
    const { result } = renderHook(() =>
      useJobStream({ url, EventSourceCtor: Ctor }),
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.lines).toEqual(["Allocating pod…", payload]);
    expect(result.current.exitCode).toBe(0);
    expect(result.current.donePayload).toEqual({
      pod_id: "02",
      agent_type: "openclaw",
    });
    expect(result.current.failMessage).toBeNull();
  });

  it("resolves to failed on install fail and exposes the message", async () => {
    const url = "/api/jobs/install-fail/stream";
    const { Ctor } = makeFakeEventSource({
      [url]: [
        { type: "log", data: "Allocating pod…" },
        { type: "fail", data: "tytus exited with status exit status: 1" },
      ],
    });
    const { result } = renderHook(() =>
      useJobStream({ url, EventSourceCtor: Ctor }),
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.lines).toEqual(["Allocating pod…"]);
    expect(result.current.exitCode).toBeNull();
    expect(result.current.donePayload).toBeNull();
    expect(result.current.failMessage).toBe(
      "tytus exited with status exit status: 1",
    );
  });

  it("resolves to failed on non-zero exit", async () => {
    const url = "/api/jobs/x/stream";
    const { Ctor } = makeFakeEventSource({
      [url]: [
        { type: "log", data: "boom" },
        { type: "exit", data: '{"code":2}' },
      ],
    });
    const { result } = renderHook(() =>
      useJobStream({ url, EventSourceCtor: Ctor }),
    );
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.exitCode).toBe(2);
    expect(result.current.donePayload).toBeNull();
    expect(result.current.failMessage).toBeNull();
  });

  it("ignores EventSource error after terminal done", async () => {
    const url = "/api/jobs/terminal-error/stream";
    const { Ctor, instances } = makeFakeEventSource({});
    const { result } = renderHook(() =>
      useJobStream({ url, EventSourceCtor: Ctor }),
    );

    await waitFor(() => expect(instances[0]).toBeDefined());
    instances[0].emit("done", '{"pod_id":"03"}');
    instances[0].emitError();

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.donePayload).toEqual({ pod_id: "03" });
  });

  it("A19: late subscribe (no events, never exit) resolves to lost within deadline", async () => {
    const url = "/api/jobs/dead/stream";
    const { Ctor } = makeFakeEventSource({
      // No script for this url => no events ever delivered.
    });
    const { result } = renderHook(() =>
      useJobStream({
        url,
        EventSourceCtor: Ctor,
        lateSubscribeDeadlineMs: 50,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("lost"), {
      timeout: 1000,
    });
    expect(result.current.lines).toEqual([]);
  });

  it("does nothing when url is null", () => {
    const { result } = renderHook(() => useJobStream({ url: null }));
    expect(result.current.status).toBe("subscribing");
    expect(result.current.lines).toEqual([]);
    expect(result.current.exitCode).toBeNull();
    expect(result.current.donePayload).toBeNull();
    expect(result.current.failMessage).toBeNull();
  });

  // Race fix (May 2026): if the first EventSource errors before any
  // event arrives — the POST→register→GET race where the daemon's SSE
  // handler 404s because the registry hasn't committed the job yet —
  // the hook retries the subscription once. Reproduces the screenshot
  // bug "job XXX · lost" with "Connecting to job stream…" forever.
  // Uses autoEmit:false so the test drives event timing precisely.
  it("retries once after an early error and recovers when the second connection succeeds", async () => {
    const url = "/api/jobs/race/stream";
    const { Ctor, instances } = makeFakeEventSource({}, { autoEmit: false });
    const { result } = renderHook(() =>
      useJobStream({
        url,
        EventSourceCtor: Ctor,
        reconnectDelayMs: 20,
        lateSubscribeDeadlineMs: 2000,
      }),
    );
    await waitFor(() => expect(instances.length).toBeGreaterThanOrEqual(1));
    // Force the first connection to fail before any events.
    instances[0].emitError();
    // Hook should open a second EventSource after `reconnectDelayMs`.
    await waitFor(() => expect(instances.length).toBeGreaterThanOrEqual(2), {
      timeout: 1000,
    });
    // Drive the second connection to a successful exit.
    instances[1].emit("log", "doctor starting…");
    instances[1].emit("exit", '{"code":0}');
    await waitFor(() => expect(result.current.status).toBe("success"), {
      timeout: 2000,
    });
    expect(result.current.lines).toContain("doctor starting…");
    expect(result.current.exitCode).toBe(0);
  });

  it("goes lost after a single retry attempt also fails with no events", async () => {
    const url = "/api/jobs/double-dead/stream";
    const { Ctor, instances } = makeFakeEventSource({}, { autoEmit: false });
    const { result } = renderHook(() =>
      useJobStream({
        url,
        EventSourceCtor: Ctor,
        reconnectDelayMs: 20,
        lateSubscribeDeadlineMs: 200,
      }),
    );
    await waitFor(() => expect(instances.length).toBeGreaterThanOrEqual(1));
    instances[0].emitError();
    await waitFor(() => expect(instances.length).toBeGreaterThanOrEqual(2));
    instances[1].emitError();
    await waitFor(() => expect(result.current.status).toBe("lost"), {
      timeout: 2000,
    });
  });

  // Phase 4 cont — failure-SSE transcript fixture (manifest audit 03 §3).
  // Drives the hook against a captured (synthesized to capture shape)
  // doctor-against-stopped-pod transcript. Pinning the shape catches
  // drift between the daemon's SSE emitter and the OS consumer; if the
  // wire format ever changes (new event types, multi-line data
  // semantics, etc.), this test fails before it reaches users.
  it("renders failure transcript fixture with non-zero exit visible", async () => {
    const url = "/api/jobs/doctor-failure/stream";
    const events = parseSseTranscript(sseDoctorFailureRaw);
    const { Ctor } = makeFakeEventSource({ [url]: events });
    const { result } = renderHook(() =>
      useJobStream({ url, EventSourceCtor: Ctor }),
    );
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.exitCode).toBe(1);
    // Failure banner must reach the consumer — it's the only line
    // distinguishing this from a "container running fine" success.
    expect(
      result.current.lines.some((l) => l.includes("not running")),
    ).toBe(true);
    // Header line is always first so the user sees which pod failed.
    expect(result.current.lines[0]).toBe("Pod 02 — Doctor");
  });
});
