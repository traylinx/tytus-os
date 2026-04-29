import type { Secret } from "./Secret";

export type AgentType = "nemoclaw" | "hermes";

export interface Agent {
  agent_type: AgentType;
  pod_id: string;
  api_url: string;
  public_url: string;
  ui_url: Secret;
  units: number;
  user_key: Secret;
}
