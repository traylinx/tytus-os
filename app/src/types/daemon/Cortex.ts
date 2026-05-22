/**
 * Local Cortex status snapshot from `GET /api/cortex/status`.
 *
 * Sprint: `services/tytus-os/development/sprints/2026-05-21-chat-with-pods-local-cortex-parity/`.
 *
 * Daemon does a cheap state.json read + a 2s probe of `/health/live` on the
 * local Cortex port. No Docker shell-out — Settings polls every 5s and the
 * daemon must stay snappy.
 */
export interface CortexStatus {
  profile: "cloud" | "local" | string;
  local_port: number;
  local_version_pinned: string | null;
  local_started_at: string | null;
  local_token_present: boolean;
  local_user_id_present: boolean;
  internal_service_token_present: boolean;
  /** `true` when `/health/live` returned 200 within 2 seconds. */
  api_reachable: boolean;
  /** Parsed `/health/live` body when reachable; `null` otherwise. */
  api_health: CortexHealthDetail | null;
}

/** Fields the live Cortex `HealthLiveResponse` exposes. Best-effort. */
export interface CortexHealthDetail {
  postgres?: string;
  redis?: string;
  llm_config?: string;
  [k: string]: unknown;
}

export interface CortexProfileSetRequest {
  profile: "cloud" | "local";
}

export interface CortexProfileSetResponse {
  ok: boolean;
  profile: "cloud" | "local";
}
