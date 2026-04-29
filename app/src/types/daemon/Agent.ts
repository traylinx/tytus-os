import type { Secret } from "./Secret";

export type AgentType = "nemoclaw" | "hermes";

/**
 * Server-derived per-pod health status. Populated by the daemon's
 * gateway probe (`probe_agent_status` in tray/src/web_server.rs), 5s
 * TTL. New daemons (≥ 0.7.0) emit this on every `state.agents[]`;
 * old daemons omit, in which case `usePodStatus` falls back to
 * polling `/api/pod/ready` per pod.
 *
 * Wire vocabulary intentionally lowercase to match the daemon's
 * `#[serde(rename_all = "lowercase")]` enum — string compare is the
 * canonical check.
 */
export type AgentStatus =
  | "ready"
  | "starting"
  | "unhealthy"
  | "stopped"
  | "unknown";

export interface Agent {
  agent_type: AgentType;
  pod_id: string;
  api_url: string;
  public_url: string;
  ui_url: Secret;
  units: number;
  user_key: Secret;
  /** Optional for forward-compat: pre-0.7.0 daemons omit this field. */
  status?: AgentStatus;
}
