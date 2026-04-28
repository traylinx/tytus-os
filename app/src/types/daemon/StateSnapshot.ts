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
}
