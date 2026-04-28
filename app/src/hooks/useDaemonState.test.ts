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

  it("populates `version` from /api/version on first poll", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: stateFixture },
      {
        method: "GET",
        path: "/api/version",
        body: {
          daemon_version: "0.6.0",
          daemon_pid: 12345,
          daemon_started_at: 1714325847,
        },
      },
    ]);
    const client = createDaemonClient({ fetch });
    const { result } = renderHook(() =>
      useDaemonState({ client, intervalMs: 60_000 }),
    );
    await waitFor(() =>
      expect(result.current.version?.daemon_started_at).toBe(1714325847),
    );
    expect(result.current.version?.daemon_version).toBe("0.6.0");
    // Both ran in parallel — state is also populated.
    expect(result.current.state?.tier).toBe("operator");
  });

  it("keeps last-known version across a transient state failure", async () => {
    // Critical invariant: a half-second blip on /api/state must NOT
    // wipe the cached version (which feeds restart detection in
    // PodInspector). If we cleared it and the next poll succeeded,
    // the consumer would see a "fresh" version and incorrectly drop
    // activeJob state every time the daemon hiccupped.
    let stateCalls = 0;
    const wrap: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.endsWith("/api/version")) {
        return new Response(
          JSON.stringify({
            daemon_version: "0.6.0",
            daemon_pid: 12345,
            daemon_started_at: 1714325847,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // /api/state — first call succeeds, second fails, third succeeds.
      stateCalls++;
      if (stateCalls === 2) throw new TypeError("transient blip");
      return new Response(JSON.stringify(stateFixture), {
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

  it("stops polling /api/version after first 404 (old-daemon forward-compat)", async () => {
    // Real-world scenario: the user's installed tray binary predates
    // the /api/version endpoint. Without this guard, every state tick
    // fires another red 404 in the browser network tab and the
    // console fills with noise. After the first 404 we treat the
    // daemon as "doesn't support it" and stop firing.
    let versionCalls = 0;
    const wrap: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.endsWith("/api/version")) {
        versionCalls++;
        return new Response("not found", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
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
    // Let several poll ticks fire.
    await new Promise((r) => setTimeout(r, 120));
    // /api/version was probed once and then suppressed. We allow up
    // to 2 calls to absorb the case where the second poll fired
    // before the first response came back, but the count must NOT
    // grow per-tick.
    expect(versionCalls).toBeLessThanOrEqual(2);
    expect(result.current.version).toBeNull();
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
