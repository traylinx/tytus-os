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

  it("getLaunchers parses populated editors as {binary, name} objects", async () => {
    // Reuters: live daemon emits each editor as {binary, name} (see
    // web_server.rs handle_launchers_list). The fixture happens to be
    // empty, so this test pins the populated shape so drift back to
    // string[] (the v1 audit prose) fails fast.
    const populated = {
      editors: [
        { binary: "code", name: "VS Code" },
        { binary: "cursor", name: "Cursor" },
      ],
      terminal_available: true,
    };
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/launchers", body: populated },
    ]);
    const r = await createDaemonClient({ fetch }).getLaunchers();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.editors[0]?.name).toBe("VS Code");
    expect(r.value.editors[1]?.binary).toBe("cursor");
  });

  it("getLaunchers rejects legacy string[] editors", async () => {
    const legacy = { editors: ["code", "cursor"], terminal_available: true };
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/launchers", body: legacy },
    ]);
    const r = await createDaemonClient({ fetch }).getLaunchers();
    expect(r.ok).toBe(false);
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

  it("postSharedFoldersPickFolder returns chosen path", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/shared-folders/pick-folder",
        body: { path: "/Users/foo/Shared" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postSharedFoldersPickFolder();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("path" in r.value && r.value.path).toBe("/Users/foo/Shared");
  });

  it("postSharedFoldersPickFolder surfaces user cancel", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/shared-folders/pick-folder",
        body: { cancelled: true },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postSharedFoldersPickFolder();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("cancelled" in r.value && r.value.cancelled).toBe(true);
  });

  it("postSharedFoldersBind sends payload + returns job_id", async () => {
    let observed: unknown = undefined;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/shared-folders/bind",
        body: { job_id: "bind-1" },
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postSharedFoldersBind({
      local_path: "/Users/foo/Shared",
      bucket: "shared",
      pods: ["02", "04"],
      auto_sync: true,
    });
    expect(r.ok).toBe(true);
    expect(observed).toEqual({
      local_path: "/Users/foo/Shared",
      bucket: "shared",
      pods: ["02", "04"],
      auto_sync: true,
    });
  });

  it("postSharedFoldersRunStreamed encodes action in query", async () => {
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/shared-folders/run-streamed?action=refresh-all",
        body: { job_id: "sync-1" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postSharedFoldersRunStreamed(
      "refresh-all",
    );
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe(
      "/api/shared-folders/run-streamed?action=refresh-all",
    );
  });

  it("postSharedFoldersOpen sends {local_path}", async () => {
    let observed: unknown = undefined;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/shared-folders/open",
        body: null,
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postSharedFoldersOpen(
      "/Users/foo/Shared",
    );
    expect(r.ok).toBe(true);
    expect(observed).toEqual({ local_path: "/Users/foo/Shared" });
  });

  it("postChannelsAdd sends {pod, channel, token} in body, not URL", async () => {
    let observedBody: unknown = undefined;
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/channels/add",
        body: null,
        expect: (init) => {
          observedBody = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postChannelsAdd(
      "02",
      "telegram",
      "secret-bot-token-7777",
    );
    expect(r.ok).toBe(true);
    expect(observedBody).toEqual({
      pod: "02",
      channel: "telegram",
      token: "secret-bot-token-7777",
    });
    // Token must NEVER appear in the URL.
    expect(calls[0]?.url).toBe("/api/channels/add");
    expect(calls[0]?.url).not.toContain("secret-bot-token-7777");
  });

  it("postChannelsRemove targets /api/channels/remove?pod=NN&name=...", async () => {
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/channels/remove?pod=02&name=telegram",
        body: null,
      },
    ]);
    const r = await createDaemonClient({ fetch }).postChannelsRemove(
      "02",
      "telegram",
    );
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe("/api/channels/remove?pod=02&name=telegram");
  });

  it("postFilesOpenDownloads targets /api/files/open-downloads?pod=NN", async () => {
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/files/open-downloads?pod=02",
        body: { ok: true, path: "/tmp/x" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postFilesOpenDownloads("02");
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe("/api/files/open-downloads?pod=02");
  });

  it("postPodRefreshCreds returns job_id", async () => {
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/pod/refresh-creds?pod=02",
        body: { job_id: "refresh-1", pod: "02" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postPodRefreshCreds("02");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.job_id).toBe("refresh-1");
    expect(calls[0]?.url).toBe("/api/pod/refresh-creds?pod=02");
  });

  it("postPodRestart targets /api/pod/restart?pod=NN", async () => {
    const { fetch, calls } = makeFakeFetch([
      { method: "POST", path: "/api/pod/restart?pod=02", body: null },
    ]);
    const r = await createDaemonClient({ fetch }).postPodRestart("02");
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe("/api/pod/restart?pod=02");
  });

  it("postPodRunStreamed posts {action} and returns job_id", async () => {
    let observed: unknown = undefined;
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/pod/02/run-streamed",
        body: { job_id: "job-restart-1" },
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postPodRunStreamed(
      "02",
      "restart",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.job_id).toBe("job-restart-1");
    expect(observed).toEqual({ action: "restart" });
    expect(calls[0]?.url).toBe("/api/pod/02/run-streamed");
  });

  it("postPodRunStreamed surfaces 400 'unknown action' as validation", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/pod/02/run-streamed",
        status: 400,
        body: { error: "unknown action bogus" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postPodRunStreamed(
      "02",
      "bogus",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("validation");
  });

  it("postPodOpen targets /api/pod/open?pod=NN", async () => {
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/pod/open?pod=02",
        body: null,
        // Body must be empty — pod_id travels in the query string,
        // matching the daemon's existing /api/pod/<action> contract.
        expect: (init) => {
          expect(init?.body).toBeUndefined();
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postPodOpen("02");
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe("/api/pod/open?pod=02");
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

  it("postInstall sends {agent_type} and returns job_id", async () => {
    let observed: unknown = undefined;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/install",
        body: { job_id: "install-1" },
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postInstall("nemoclaw");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.job_id).toBe("install-1");
    expect(observed).toEqual({ agent_type: "nemoclaw" });
  });

  it("postInstall includes pod_id when provided", async () => {
    let observed: unknown = undefined;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/install",
        body: { job_id: "install-2" },
        expect: (init) => {
          observed = init?.body ? JSON.parse(init.body as string) : null;
        },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postInstall("hermes", "03");
    expect(r.ok).toBe(true);
    expect(observed).toEqual({ agent_type: "hermes", pod_id: "03" });
  });

  it("postInstall surfaces 400 as validation", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/install",
        status: 400,
        body: { error: "invalid agent_type" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postInstall("../../etc/passwd");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("validation");
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
