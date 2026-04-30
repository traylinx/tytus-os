// Re-export the daemon-contract fixtures so tests can `import { stateFixture }`.
// The fixtures live in the manifest folder under sprints/. We embed copies
// here so the build graph is hermetic — the test pinned-shape would
// otherwise break if the manifest is moved or the sprint folder pruned.
//
// Source of truth: ~/Projects/makakoo/sprints/tytus-os-product-manifest-2026-04-28/fixtures/

export const stateFixture = {
  active_jobs_per_pod: {},
  agents: [
    {
      agent_type: "nemoclaw",
      api_url: "https://njc9ctj3zgkn-p02.tytus.traylinx.com/v1",
      pod_id: "02",
      public_url: "https://njc9ctj3zgkn-p02.tytus.traylinx.com",
      ui_url: "https://njc9ctj3zgkn-p02.tytus.traylinx.com/?token=REDACTED",
      units: 1,
      user_key: "sk-tytus-user-REDACTED",
    },
    {
      agent_type: "nemoclaw",
      api_url: "https://njc9ctj3zgkn-p04.tytus.traylinx.com/v1",
      pod_id: "04",
      public_url: "https://njc9ctj3zgkn-p04.tytus.traylinx.com",
      ui_url: "https://njc9ctj3zgkn-p04.tytus.traylinx.com/?token=REDACTED",
      units: 1,
      user_key: "sk-tytus-user-REDACTED",
    },
  ],
  app_bundle_installed: true,
  connected: true,
  daemon_pid: 604,
  daemon_running: true,
  email: "REDACTED@example.com",
  forwarders: [],
  included: [
    {
      endpoint: "http://10.42.42.1:18080",
      kind: "ail",
      pod_id: "01",
      public_url: "https://njc9ctj3zgkn-p01.tytus.traylinx.com",
      user_key: "sk-tytus-user-REDACTED",
    },
  ],
  keychain_healthy: true,
  last_refresh_error: null,
  logged_in: true,
  tier: "operator",
  tunnel_active: true,
  units_limit: 4,
  units_used: 2,
  uptime_secs: 21037,
};

export const daemonStatusFixture = { pid: 604, running: true };

export const settingsFixture = {
  autostart_tray: true,
  autostart_tunnel: true,
};

export const catalogFixture = {
  version: "2026-04-18",
  agents: [
    {
      id: "nemoclaw",
      name: "OpenClaw",
      tagline:
        "Anthropic-compatible agent runtime with NemoClaw safety sandbox",
      description: "OpenClaw agent...",
      icon_url: "https://traylinx.com/assets/agents/openclaw.svg",
      units: 1,
      api_port: 3000,
      health_port: 3000,
      health_path: "/healthz",
      docs_url: "https://github.com/traylinx/tytus-cli#openclaw",
      min_plan: "explorer",
    },
  ],
};

export const channelsPod02Fixture = {
  available: [
    { label: "Discord", name: "discord" },
    { label: "Slack (Socket Mode)", name: "slack" },
    { label: "LINE", name: "line" },
  ],
  configured: [{ label: "Telegram", name: "telegram", secret_count: 1 }],
  pod_id: "02",
};

export const podReadyFixture = {
  probe_url: "https://njc9ctj3zgkn-p02.tytus.traylinx.com/v1/models",
  ready: true,
  reason: "gateway answering with 200",
  status: 200,
};

export const podReadinessFixture = {
  pod_id: "02",
  agent: "openclaw",
  overall: "ready",
  open_enabled: true,
  strict: true,
  stages: [
    { id: "allocated", label: "Pod allocated", status: "ok", detail: null },
    {
      id: "agent_ui",
      label: "Agent UI route",
      status: "ok",
      detail: "https://example.test/?token=REDACTED",
    },
    {
      id: "tytus_bootstrap",
      label: "Tytus bootstrap pack",
      status: "ok",
      detail: "Tytus bootstrap pack present",
    },
    {
      id: "shared_storage",
      label: "Shared storage",
      status: "not_configured",
      detail: "PR1 baseline",
    },
  ],
  last_checked_at: 1770000000,
};

export const launchersFixture = { editors: [], terminal_available: true };

export const sharedFoldersFixture = {
  bindings: [
    {
      auto_sync: true,
      bound_at: "2026-04-26T21:55:23Z",
      bucket: "shared",
      interval_sec: 60,
      local_path: "/Users/USER/MAKAKOO/data/shared/",
      plist_label: "com.traylinx.garagetytus.bisync.shared-shared",
      pods_provisioned: ["wannolot-02", "wannolot-04"],
      schema_version: 1,
      workdir: "/Users/USER/.cache/garagetytus/bisync/shared-shared",
    },
  ],
};

export const sseDoctorSuccess = `event: log
data: Tytus Doctor

event: log
data:

event: log
data:   [OK] state_file: /Users/USER/Library/Application Support/tytus/state.json

event: log
data:   [OK] logged_in: as REDACTED@example.com

event: exit
data: {"code":0}

`;
