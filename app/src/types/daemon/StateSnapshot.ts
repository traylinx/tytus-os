import type { Agent } from "./Agent";
import type { IncludedPod } from "./IncludedPod";
import type { Forwarder } from "./Forwarder";

export type Tier = "explorer" | "creator" | "operator";

export interface StateSnapshot {
  logged_in: boolean;
  email: string;
  tier: Tier;

  units_used: number;
  units_limit: number;

  daemon_running: boolean;
  daemon_pid: number;
  uptime_secs: number;
  app_bundle_installed: boolean;
  keychain_healthy: boolean;
  last_refresh_error: string | null;

  connected: boolean;
  tunnel_active: boolean;

  agents: Agent[];
  included: IncludedPod[];
  forwarders: Forwarder[];
  active_jobs_per_pod: Record<string, string[]>;

  /**
   * Tray binary version (`tytus-tray` CARGO_PKG_VERSION). Optional —
   * undefined when talking to a daemon that predates the
   * state-includes-version sprint. Read it for feature gates: don't
   * call a route that requires N when daemon_version < N.
   */
  daemon_version?: string;
  /**
   * Daemon boot time, Unix seconds. Stable across the daemon's
   * lifetime. Diff between polls to detect a restart and clear stale
   * activeJob state — the tray's job registry is in-memory, so every
   * job_id is invalid past a restart. Optional for the same forward-
   * compat reason as daemon_version.
   */
  daemon_started_at?: number;
}
