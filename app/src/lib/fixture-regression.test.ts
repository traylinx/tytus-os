import { describe, expect, it } from "vitest";
import { createDaemonClient } from "@/lib/daemon";
import { makeFakeFetch } from "@/test/fakeFetch";
import { revealSecret } from "@/lib/secrets";

import catalogFixture from "@/test/fixtures/catalog.json";
import channelsPod02Fixture from "@/test/fixtures/channels-pod02.json";
import daemonStatusFixture from "@/test/fixtures/daemon-status.json";
import launchersFixture from "@/test/fixtures/launchers.json";
import logsFixture from "@/test/fixtures/logs.json";
import logsStartupFixture from "@/test/fixtures/logs-startup.json";
import podReadyFixture from "@/test/fixtures/pod-ready-pod02.json";
import settingsFixture from "@/test/fixtures/settings.json";
import sharedFoldersFixture from "@/test/fixtures/shared-folders-list.json";
import stateFixture from "@/test/fixtures/state.json";
import error401 from "@/test/fixtures/error-401.json";
import error403 from "@/test/fixtures/error-403.json";

// ============================================================
// Phase 5 — fixture-based regression suite
// ============================================================
//
// Fixtures are byte-equal copies of the manifest captures (modulo
// REDACTED tokens) so the type guards in `daemon.ts` round-trip the
// real wire shape. A regression here would catch any drift between:
//   - daemon serialization (web_server.rs `Serialize` derives)
//   - typegard predicates (`isStateLike`, `isCatalog`, …)
//   - field-level expectations the OS components depend on
//
// Convention: each `describe` block targets one Section A.exist
// endpoint. Refresh fixtures from a live daemon via
// `services/tytus-cli/dev/refresh-fixtures.sh` (NOT run in CI —
// humans run before commit).
//
// Source of truth for the captures (currently):
//   ~/Projects/makakoo/sprints/tytus-os-product-manifest-2026-04-28/fixtures/

describe("fixture-regression: GET /api/state", () => {
  it("parses every published field on the live state.json", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/state", body: stateFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getState();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.value.logged_in).toBe("boolean");
    expect(typeof r.value.email).toBe("string");
    expect(typeof r.value.tier).toBe("string");
    expect(Array.isArray(r.value.agents)).toBe(true);
    expect(Array.isArray(r.value.included)).toBe(true);
    // user_key is wrapped as a Secret — round-trip via revealSecret.
    if (r.value.agents.length > 0) {
      const k = revealSecret(r.value.agents[0].user_key, "user_gesture");
      expect(typeof k).toBe("string");
      expect(k.length).toBeGreaterThan(0);
    }
  });
});

describe("fixture-regression: GET /api/catalog", () => {
  it("parses agents[] with full per-agent shape", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/catalog", body: catalogFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getCatalog();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.agents.length).toBeGreaterThan(0);
    for (const a of r.value.agents) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.name).toBe("string");
      expect(typeof a.units).toBe("number");
      expect(typeof a.min_plan).toBe("string");
    }
  });
});

describe("fixture-regression: GET /api/channels", () => {
  it("parses available + configured arrays + pod_id", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/channels?pod=02",
        body: channelsPod02Fixture,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getChannels("02");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pod_id).toBe("02");
    expect(Array.isArray(r.value.available)).toBe(true);
    expect(Array.isArray(r.value.configured)).toBe(true);
    for (const c of r.value.available) {
      expect(typeof c.name).toBe("string");
      expect(typeof c.label).toBe("string");
    }
  });
});

describe("fixture-regression: GET /api/daemon/status", () => {
  it("parses pid + running booleans", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/daemon/status", body: daemonStatusFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getDaemonStatus();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.value.pid).toBe("number");
    expect(typeof r.value.running).toBe("boolean");
  });
});

describe("fixture-regression: GET /api/launchers", () => {
  it("parses editors[] (objects) + terminal_available", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/launchers", body: launchersFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getLaunchers();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.value.editors)).toBe(true);
    expect(typeof r.value.terminal_available).toBe("boolean");
    // Each editor MUST be {binary, name} — Browser.tsx crashed when
    // we treated this as string[] (caught 2026-04-28).
    for (const e of r.value.editors) {
      expect(typeof e.binary).toBe("string");
      expect(typeof e.name).toBe("string");
    }
  });
});

describe("fixture-regression: GET /api/logs", () => {
  it("parses LogChunk shape (daemon + startup)", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/logs?name=daemon&offset=0",
        body: logsFixture,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getLogs("daemon", 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.value.name).toBe("string");
    expect(typeof r.value.chunk).toBe("string");
    expect(typeof r.value.offset).toBe("number");
    expect(typeof r.value.size).toBe("number");
    expect(typeof r.value.truncated).toBe("boolean");
    expect(typeof r.value.missing).toBe("boolean");
  });

  it("startup variant has the same shape", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/logs?name=startup&offset=0",
        body: logsStartupFixture,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getLogs("startup", 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("startup");
  });
});

describe("fixture-regression: GET /api/pod/ready", () => {
  it("parses ready + status + reason + probe_url", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/pod/ready?pod=02",
        body: podReadyFixture,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getPodReady("02");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.value.ready).toBe("boolean");
    expect(typeof r.value.status).toBe("number");
    expect(typeof r.value.reason).toBe("string");
    expect(typeof r.value.probe_url).toBe("string");
  });
});

describe("fixture-regression: GET /api/settings", () => {
  it("parses autostart_tray + autostart_tunnel booleans", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/settings", body: settingsFixture },
    ]);
    const r = await createDaemonClient({ fetch }).getSettings();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.value.autostart_tray).toBe("boolean");
    expect(typeof r.value.autostart_tunnel).toBe("boolean");
  });
});

describe("fixture-regression: GET /api/shared-folders/list", () => {
  it("parses bindings[] with required fields", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/shared-folders/list",
        body: sharedFoldersFixture,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getSharedFolders();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.value.bindings)).toBe(true);
    for (const b of r.value.bindings) {
      expect(typeof b.local_path).toBe("string");
      expect(typeof b.bucket).toBe("string");
    }
  });
});

describe("fixture-regression: error envelopes", () => {
  it("error-401.json maps to auth_required", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "GET",
        path: "/api/state",
        status: 401,
        body: error401,
      },
    ]);
    const r = await createDaemonClient({ fetch }).getState();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("auth_required");
  });

  it("error-403.json maps to auth_required (403 status)", async () => {
    const { fetch } = makeFakeFetch([
      {
        method: "POST",
        path: "/api/install",
        status: 403,
        body: error403,
      },
    ]);
    const r = await createDaemonClient({ fetch }).postInstall("nemoclaw", "02");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("auth_required");
    expect(r.error.status).toBe(403);
  });
});
