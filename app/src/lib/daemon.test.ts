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

  it("agent.status is read through when daemon emits it (≥0.7.0)", async () => {
    // Phase 2 cont — pin the wire shape: a daemon that includes
    // `status: "ready"` (or any AgentStatus variant) on each agent
    // surfaces unchanged through the parser. Old daemons that omit
    // it still parse fine — covered implicitly by the fixture
    // (which has no `status` field).
    const stateWithStatus = {
      ...stateFixture,
      agents: stateFixture.agents.map((a, i) => ({
        ...a,
        status: i === 0 ? "ready" : "starting",
      })),
    };
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: stateWithStatus },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.agents[0].status).toBe("ready");
    expect(r.value.agents[1].status).toBe("starting");
  });

  it("agent.status absent on old-daemon fixture stays undefined (no fabrication)", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: stateFixture },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Important: parser must NOT default to "unknown" or any other
    // string. Consumers (PodInspector, Settings PodCard) branch on
    // `agent.status === undefined` to decide whether to fall back
    // to /api/pod/ready polling.
    expect(r.value.agents[0].status).toBeUndefined();
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

  // Phase 8 — pin against the captured error-401.json / error-403.json
  // fixtures. The Provider-relayed paths (per-pod logs / doctor / soon
  // env) bubble these statuses up; we want to be sure the existing
  // auth_required mapping survives a refactor.
  it("maps fixture error-401.json to auth_required", async () => {
    const fixture = (await import("@/test/fixtures/error-401.json")).default;
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/state",
        status: 401,
        body: fixture,
      },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.getState();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("auth_required");
  });

  it("maps fixture error-403.json to auth_required", async () => {
    const fixture = (await import("@/test/fixtures/error-403.json")).default;
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/install",
        status: 403,
        body: fixture,
      },
    ]);
    const client = createDaemonClient({ fetch });
    const r = await client.postInstall("nemoclaw", "02");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("auth_required");
    expect(r.error.status).toBe(403);
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

  it("getStateConditional sends If-None-Match and parses ETag from 200", async () => {
    let capturedHeader: string | undefined;
    const wrap: typeof fetch = async (input, init) => {
      capturedHeader = (init?.headers as Record<string, string>)?.[
        "If-None-Match"
      ];
      return new Response(JSON.stringify(stateFixture), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ETag: '"abc123"',
        },
      });
    };
    const client = createDaemonClient({ fetch: wrap });
    const r = await client.getStateConditional('"prev-etag"');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(capturedHeader).toBe('"prev-etag"');
    expect(r.value.notModified).toBe(false);
    expect(r.value.etag).toBe('"abc123"');
    expect(r.value.snapshot?.tier).toBe("operator");
  });

  it("getStateConditional surfaces 304 as notModified=true with no body", async () => {
    const wrap: typeof fetch = async () =>
      new Response(null, { status: 304, headers: { ETag: '"abc123"' } });
    const client = createDaemonClient({ fetch: wrap });
    const r = await client.getStateConditional('"abc123"');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.notModified).toBe(true);
    expect(r.value.snapshot).toBeNull();
    expect(r.value.etag).toBe('"abc123"');
  });

  it("getStateConditional with no prior etag omits If-None-Match", async () => {
    let capturedHeader: string | undefined = "set-by-default";
    const wrap: typeof fetch = async (_input, init) => {
      capturedHeader = (init?.headers as Record<string, string>)?.[
        "If-None-Match"
      ];
      return new Response(JSON.stringify(stateFixture), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: '"first"' },
      });
    };
    const client = createDaemonClient({ fetch: wrap });
    const r = await client.getStateConditional(null);
    expect(r.ok).toBe(true);
    expect(capturedHeader).toBeUndefined();
  });

  it("getVersion parses populated body", async () => {
    const { fetch, calls } = makeFakeFetch([
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
    const r = await createDaemonClient({ fetch }).getVersion();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.daemon_version).toBe("0.6.0");
    expect(r.value.daemon_pid).toBe(12345);
    expect(r.value.daemon_started_at).toBe(1714325847);
    expect(calls[0]?.url).toBe("/api/version");
  });

  it("getVersion rejects malformed body (numeric version, missing pid)", async () => {
    // Pin the guard so a future daemon refactor that drops a field
    // surfaces as a parser error rather than `undefined` propagation.
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/version",
        body: { daemon_version: 6, daemon_started_at: 1714325847 },
      },
    ]);
    const r = await createDaemonClient({ fetch }).getVersion();
    expect(r.ok).toBe(false);
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

  it("getPodEnv defaults to redacted (no reveal query param)", async () => {
    const body = {
      pod_num: 2,
      agent_type: "nemoclaw",
      reveal_secrets: false,
      vars: [
        { key: "TYTUS_POD_ID", value: "02", source: "runtime" },
        { key: "OPENAI_API_KEY", value: "<redacted>", source: "channels" },
      ],
    };
    const { fetch, calls } = makeFakeFetch([
      { method: "GET", path: "/api/pod/env?pod=02", body },
    ]);
    const r = await createDaemonClient({ fetch }).getPodEnv("02");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reveal_secrets).toBe(false);
    expect(r.value.vars).toHaveLength(2);
    // The reveal=secrets query param must NOT be present on the redacted call
    // — sending it would 403 for non-Operator users.
    expect(calls[0].url).not.toContain("reveal=secrets");
  });

  it("getPodEnv passes reveal=secrets when revealSecrets=true", async () => {
    const body = {
      pod_num: 2,
      agent_type: "nemoclaw",
      reveal_secrets: true,
      vars: [{ key: "OPENAI_API_KEY", value: "sk-real", source: "channels" }],
    };
    const { fetch, calls } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/pod/env?pod=02&reveal=secrets",
        body,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getPodEnv("02", true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reveal_secrets).toBe(true);
    expect(calls[0].url).toContain("reveal=secrets");
  });

  it("getPodEnv rejects malformed responses (codex review tightening)", async () => {
    // Daemon returning `agent_type: 42` used to slip past the guard
    // and crash PodEnvPane when it rendered the badge. The tightened
    // isPodEnv guard now refuses the body and surfaces a parse error.
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/pod/env?pod=02",
        body: { pod_num: 2, agent_type: 42, vars: [] },
      },
    ]);
    const r = await createDaemonClient({ fetch }).getPodEnv("02");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("daemon_unhealthy");
    expect(r.error.message).toContain("malformed /api/pod/env");
  });

  it("getPodEnv accepts a body with only the required `vars` array", async () => {
    // Forward-compat: daemon may omit the optional pod_num/agent_type/
    // reveal_secrets entirely (e.g. an older daemon). Guard must still
    // accept that envelope.
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/pod/env?pod=02",
        body: { vars: [] },
      },
    ]);
    const r = await createDaemonClient({ fetch }).getPodEnv("02");
    expect(r.ok).toBe(true);
  });

  it("getPodEnv maps daemon 403 to auth_required (Operator gate)", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/pod/env?pod=02&reveal=secrets",
        status: 403,
        body: { error: "plan_required", code: "auth_required" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).getPodEnv("02", true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("auth_required");
    expect(r.error.status).toBe(403);
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

  it("postJobCancel POSTs to /api/jobs/<id>/cancel and parses body", async () => {
    const { fetch, calls } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/jobs/job-abc/cancel",
        body: { cancelled: true, pid: 12345 },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postJobCancel("job-abc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cancelled).toBe(true);
    expect(r.value.pid).toBe(12345);
    expect(calls[0]?.url).toBe("/api/jobs/job-abc/cancel");
  });

  it("postJobCancel handles already-finished response", async () => {
    // Important UX path: the user can click Cancel after the SSE
    // already delivered an `exit` event. Daemon returns 200 with
    // cancelled:false; we surface that intact so the UI can pick a
    // friendlier toast.
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/jobs/job-abc/cancel",
        body: { cancelled: false, reason: "already finished" },
      },
    ]);
    const r = await createDaemonClient({ fetch }).postJobCancel("job-abc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cancelled).toBe(false);
    expect(r.value.reason).toBe("already finished");
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
