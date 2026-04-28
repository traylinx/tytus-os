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
