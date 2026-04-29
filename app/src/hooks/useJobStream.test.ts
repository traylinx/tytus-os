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
