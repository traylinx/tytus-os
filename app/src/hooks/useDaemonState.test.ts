import { describe, expect, it } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDaemonState } from "@/hooks/useDaemonState";
import { createDaemonClient } from "@/lib/daemon";
import { makeFakeFetch, networkErrorFetch } from "@/test/fakeFetch";
import { stateFixture } from "@/test/fixtures";

describe("useDaemonState", () => {
  it("returns online when /api/state succeeds and logged_in", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: stateFixture },
    ]);
    const client = createDaemonClient({ fetch });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 60_000 }),
    );

    await waitFor(() => expect(result.current.status).toBe("online"));
    expect(result.current.state?.tier).toBe("operator");
    expect(result.current.bannerVisible).toBe(false);
  });

  it("A1a: shows banner immediately on daemon_offline", async () => {
    const fetch = networkErrorFetch(new TypeError("fetch failed"));
    const client = createDaemonClient({ fetch });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 60_000 }),
    );

    await waitFor(() => expect(result.current.status).toBe("offline"));
    expect(result.current.bannerVisible).toBe(true);
    expect(result.current.failureCount).toBe(1);
  });

  it("A1b: banner only after threshold for transient errors", async () => {
    const fetch = networkErrorFetch(
      new DOMException("aborted", "AbortError"),
    );
    const client = createDaemonClient({ fetch });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 10, bannerThreshold: 3 }),
    );

    await waitFor(() => expect(result.current.failureCount).toBeGreaterThanOrEqual(3));
    expect(result.current.status).toBe("degraded");
    expect(result.current.bannerVisible).toBe(true);
  });

  it("returns auth_required when logged_in is false", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/state",
        body: { ...stateFixture, logged_in: false },
      },
    ]);
    const client = createDaemonClient({ fetch });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 60_000 }),
    );
    await waitFor(() =>
      expect(result.current.status).toBe("auth_required"),
    );
    expect(result.current.bannerVisible).toBe(false);
  });

  it("derives `version` from state.daemon_version + daemon_started_at", async () => {
    // Architectural note: we read these fields off the existing
    // /api/state response — no separate /api/version request fires.
    // That eliminates 404 noise on consumers running against pre-
    // sprint daemons (which simply don't include the fields), and
    // saves a roundtrip per poll on new daemons.
    const stateWithVersion = {
      ...stateFixture,
      daemon_version: "0.6.0",
      daemon_started_at: 1714325847,
      daemon_pid: 12345,
    };
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: stateWithVersion },
    ]);
    const client = createDaemonClient({ fetch });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 60_000 }),
    );
    await waitFor(() =>
      expect(result.current.version?.daemon_started_at).toBe(1714325847),
    );
    expect(result.current.version?.daemon_version).toBe("0.6.0");
    expect(result.current.version?.daemon_pid).toBe(12345);
  });

  it("leaves version null when state omits the fields (old daemon)", async () => {
    // Forward-compat: pre-sprint daemons return /api/state without
    // daemon_version / daemon_started_at. We must NOT half-populate
    // a DaemonVersion in that case — restart detection needs to stay
    // fully inert (the consumer keys off `version?.daemon_started_at
    // !== last`, and we don't want any false positives).
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: stateFixture },
    ]);
    const client = createDaemonClient({ fetch });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 60_000 }),
    );
    await waitFor(() => expect(result.current.status).toBe("online"));
    expect(result.current.version).toBeNull();
  });

  it("keeps last-known version across a transient state failure", async () => {
    // Critical invariant: a half-second blip on /api/state must NOT
    // wipe the cached version (which feeds restart detection in
    // PodInspector). If we cleared it and the next poll succeeded,
    // the consumer would see a "fresh" version and incorrectly drop
    // activeJob state every time the daemon hiccupped. The hook only
    // updates `version` on stateR.ok, so this just falls out — but
    // pin the invariant so a future refactor can't break it silently.
    let stateCalls = 0;
    const stateWithVersion = {
      ...stateFixture,
      daemon_version: "0.6.0",
      daemon_started_at: 1714325847,
      daemon_pid: 12345,
    };
    const wrap: typeof fetch = async () => {
      stateCalls++;
      if (stateCalls === 2) throw new TypeError("transient blip");
      return new Response(JSON.stringify(stateWithVersion), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createDaemonClient({ fetch: wrap });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 10 }),
    );
    await waitFor(() =>
      expect(result.current.version?.daemon_started_at).toBe(1714325847),
    );
    // Force a poll where state errors. version stays.
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.version?.daemon_started_at).toBe(1714325847);
  });

  it("sends If-None-Match on the second poll using the ETag from the first", async () => {
    // End-to-end conditional GET: first poll has no ETag, daemon
    // sends one back, second poll echoes it. This is the "happy path"
    // that saves a parse + setState round on every no-change tick.
    const observed: Array<string | undefined> = [];
    let pollCount = 0;
    const wrap: typeof fetch = async (_input, init) => {
      pollCount++;
      observed.push(
        (init?.headers as Record<string, string>)?.["If-None-Match"],
      );
      // First call: 200 + ETag. Subsequent calls: 304 if matches.
      if (pollCount === 1) {
        return new Response(JSON.stringify(stateFixture), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: '"v1"' },
        });
      }
      // 304 path
      return new Response(null, {
        status: 304,
        headers: { ETag: '"v1"' },
      });
    };
    const client = createDaemonClient({ fetch: wrap });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 10 }),
    );
    await waitFor(() => expect(result.current.status).toBe("online"));
    // Let one or two more ticks fire so we observe the second header.
    await new Promise((r) => setTimeout(r, 80));
    expect(observed[0]).toBeUndefined(); // first poll has no etag yet
    expect(observed.slice(1).every((h) => h === '"v1"')).toBe(true);
  });

  it("304 keeps the cached snapshot (no setState on no-change)", async () => {
    // Critical invariant: when the daemon returns 304, the hook must
    // hold its previously-set state and *not* regress to null. A
    // regression here would cause a flicker every poll tick.
    let pollCount = 0;
    const wrap: typeof fetch = async () => {
      pollCount++;
      if (pollCount === 1) {
        return new Response(JSON.stringify(stateFixture), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: '"v1"' },
        });
      }
      return new Response(null, {
        status: 304,
        headers: { ETag: '"v1"' },
      });
    };
    const client = createDaemonClient({ fetch: wrap });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 10 }),
    );
    await waitFor(() => expect(result.current.state?.tier).toBe("operator"));
    // After several 304s, state must still be populated.
    await new Promise((r) => setTimeout(r, 80));
    expect(result.current.state?.tier).toBe("operator");
    expect(result.current.status).toBe("online");
    expect(pollCount).toBeGreaterThan(2); // confirm we actually polled
  });

  it("never fires /api/version (piggyback architecture invariant)", async () => {
    // Pin the architecture: useDaemonState reads version off
    // /api/state and must never fire a separate /api/version request.
    // Regression guard against accidentally re-introducing the
    // parallel fetch and the 404 spam it caused on old daemons.
    let versionCalls = 0;
    const wrap: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.endsWith("/api/version")) {
        versionCalls++;
      }
      return new Response(JSON.stringify(stateFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createDaemonClient({ fetch: wrap });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 10 }),
    );
    await waitFor(() => expect(result.current.status).toBe("online"));
    await new Promise((r) => setTimeout(r, 80));
    expect(versionCalls).toBe(0);
  });

  it("refresh() triggers a new poll", async () => {
    let callCount = 0;
    const wrap: typeof fetch = async () => {
      callCount++;
      return new Response(JSON.stringify(stateFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createDaemonClient({ fetch: wrap });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 60_000 }),
    );
    await waitFor(() => expect(result.current.status).toBe("online"));
    const before = callCount;
    act(() => result.current.refresh());
    await waitFor(() => expect(callCount).toBeGreaterThan(before));
  });
});
