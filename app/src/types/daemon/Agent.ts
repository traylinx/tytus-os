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
  /** Stable local identity. Prefer route_id because pod_id can repeat across droplets. */
  id?: string;
  pod_id: string;
  /** Globally unique Provider route id. pod_id can repeat across droplets. */
  route_id?: string;
  /** Stable selected-agent identity. Same agent across Tytus OS, Atomek, and web chat. */
  agent_identity_id?: string | null;
  /** User-facing label. Prefer display_name; fall back to "Pod NN". */
  display_label?: string;
  /** Optional user-defined friendly label. Real identity remains id/route_id. */
  display_name?: string;
  api_url: string;
  public_url: string;
  ui_url: Secret;
  units: number;
  user_key: Secret;
  /** Optional for forward-compat: pre-0.7.0 daemons omit this field. */
  status?: AgentStatus;
}
