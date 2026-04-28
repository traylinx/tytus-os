import { describe, expect, it } from "vitest";
import { createDaemonClient } from "@/lib/daemon";
import { revealSecret, maskSecret } from "@/lib/secrets";
import {
  catalogFixture,
  channelsPod02Fixture,
  daemonStatusFixture,
  launchersFixture,
  podReadyFixture,
  settingsFixture,
  sharedFoldersFixture,
  stateFixture,
} from "@/test/fixtures";
import { makeFakeFetch, networkErrorFetch } from "@/test/fakeFetch";

describe("daemon client — GET /api/state", () => {
  it("parses fixture and wraps secrets", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: stateFixture },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tier).toBe("operator");
    expect(r.value.units_used).toBe(2);
    expect(r.value.agents).toHaveLength(2);
    // user_key is Secret — must round-trip through revealSecret.
    expect(revealSecret(r.value.agents[0].user_key, "user_gesture")).toBe(
      "sk-tytus-user-REDACTED",
    );
    // mask gives last 4 chars.
    expect(maskSecret(r.value.agents[0].user_key)).toBe("●●●●…CTED");
  });

  it("classifies network failure as daemon_offline", async () => {
    const fetch = networkErrorFetch(new TypeError("fetch failed"));
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("daemon_offline");
  });

  it("classifies AbortError as network_timeout", async () => {
    const fetch = networkErrorFetch(
      new DOMException("aborted", "AbortError"),
    );
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("network_timeout");
  });

  it("classifies malformed body as daemon_unhealthy", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: { hello: "world" } },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("daemon_unhealthy");
  });

  it("classifies 401 as auth_required", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/state",
        status: 401,
        body: { error: "auth required" },
      },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("auth_required");
  });

  it("classifies 200 + ErrorEnvelope as logical_error", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/pod/ready?pod=",
        body: { error: "invalid pod" },
      },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.getPodReady("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("logical_error");
    expect(r.error.message).toBe("invalid pod");
  });

  it("classifies 400 as validation", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/channels?pod=",
        status: 400,
        body: { error: "missing or invalid pod id" },
      },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.getChannels("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("validation");
    expect(r.error.message).toBe("missing or invalid pod id");
  });

  it("classifies 404 as not_found", async () => {
    const { fetch } = makeFakeFetch([], { status: 404, text: "not found" });
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("not_found");
  });
});

describe("daemon client — other GETs", () => {
  it("getDaemonStatus parses fixture", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/daemon/status",
        body: daemonStatusFixture,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getDaemonStatus();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pid).toBe(604);
    expect(r.value.running).toBe(true);
  });

  it("getSettings parses fixture", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/settings", body: settingsFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getSettings();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.autostart_tray).toBe(true);
  });

  it("getCatalog parses fixture", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/catalog", body: catalogFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getCatalog();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe("2026-04-18");
  });

  it("getChannels parses fixture and includes pod query", async () => {
    let observedUrl = "";
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/channels?pod=02",
        body: channelsPod02Fixture,
        expect: (init) => {
          void init;
        },
      },
    ]);
    const wrapped: typeof fetch = async (url, init) => {
      observedUrl = typeof url === "string" ? url : (url as URL).toString();
      return fetch(url, init);
    };
    const r = await createDaemonClient({ fetch: wrapped }).getChannels("02");
    expect(r.ok).toBe(true);
    expect(observedUrl).toContain("pod=02");
  });

  it("getLaunchers parses fixture", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/launchers", body: launchersFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getLaunchers();
    expect(r.ok).toBe(true);
  });

  it("getPodReady parses fixture", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/pod/ready?pod=02", body: podReadyFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getPodReady("02");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ready).toBe(true);
  });

  it("getSharedFolders parses fixture", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/shared-folders/list",
        body: sharedFoldersFixture,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getSharedFolders();
    expect(r.ok).toBe(true);
  });
});

describe("daemon client — POSTs", () => {
  it("postLogout uses POST with empty body", async () => {
    let recordedMethod = "";
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/logout",
        body: null,
        expect: (init) => {
          recordedMethod = init?.method ?? "GET";
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postLogout();
    expect(r.ok).toBe(true);
    expect(recordedMethod).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("postDaemonStart / Stop / Restart all hit correct paths", async () => {
    const { fetch, calls } = makeFakeFetch([
      { method: "POST", path: "/api/daemon/start", body: null },
      { method: "POST", path: "/api/daemon/stop", body: null },
      { method: "POST", path: "/api/daemon/restart", body: null },
    ]);
    const c = createDaemonClient({ fetch });
    expect((await c.postDaemonStart()).ok).toBe(true);
    expect((await c.postDaemonStop()).ok).toBe(true);
    expect((await c.postDaemonRestart()).ok).toBe(true);
    expect(calls.map((c) => new URL(c.url, "http://x").pathname)).toEqual([
      "/api/daemon/start",
      "/api/daemon/stop",
      "/api/daemon/restart",
    ]);
  });

  it("postConnect / postDisconnect", async () => {
    const { fetch } = makeFakeFetch([
      { method: "POST", path: "/api/connect", body: null },
      { method: "POST", path: "/api/disconnect", body: null },
    ]);
    const c = createDaemonClient({ fetch });
    expect((await c.postConnect()).ok).toBe(true);
    expect((await c.postDisconnect()).ok).toBe(true);
  });

  it("postSettingsAutostartTunnel sends {enabled: true}", async () => {
    let observed: unknown = undefined;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/settings/autostart-tunnel",
        body: null,
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({
      fetch,
    }).postSettingsAutostartTunnel(true);
    expect(r.ok).toBe(true);
    expect(observed).toEqual({ enabled: true });
  });

  it("postSettingsAutostartTray sends {enabled: false}", async () => {
    let observed: unknown = undefined;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/settings/autostart-tray",
        body: null,
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({
      fetch,
    }).postSettingsAutostartTray(false);
    expect(r.ok).toBe(true);
    expect(observed).toEqual({ enabled: false });
  });

  it("postLaunch sends {name}", async () => {
    let observed: unknown = undefined;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/launch",
        body: null,
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postLaunch("doctor");
    expect(r.ok).toBe(true);
    expect(observed).toEqual({ name: "doctor" });
  });

  it("postOpenExternal sends {url}", async () => {
    let observed: unknown = undefined;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/open-external",
        body: null,
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postOpenExternal(
      "https://example.com",
    );
    expect(r.ok).toBe(true);
    expect(observed).toEqual({ url: "https://example.com" });
  });

  it("postTest returns job_id", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/test",
        body: { job_id: "abc-123" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postTest();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.job_id).toBe("abc-123");
  });
});

describe("daemon client — base URL + SSE URL", () => {
  it("uses provided baseUrl", async () => {
    let url = "";
    const { fetch } = makeFakeFetch(
      [
        {
          method: "GET",
          path: "/api/state",
          body: stateFixture,
        },
      ],
      { status: 404 },
    );
    const wrapped: typeof fetch = async (u, init) => {
      url = typeof u === "string" ? u : (u as URL).toString();
      return fetch(u, init);
    };
    const c = createDaemonClient({
      baseUrl: "http://localhost:49445",
      fetch: wrapped,
    });
    await c.getState();
    expect(url).toBe("http://localhost:49445/api/state");
  });

  it("jobStreamUrl encodes job id", () => {
    const c = createDaemonClient({ baseUrl: "http://localhost:49445" });
    expect(c.jobStreamUrl("abc/123")).toBe(
      "http://localhost:49445/api/jobs/abc%2F123/stream",
    );
  });
});
