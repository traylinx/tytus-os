/**
 * Per-pod env-var source classification.
 *
 * - `runtime` — injected by the daemon-deploy step (e.g. `TYTUS_POD_ID`,
 *   `AIL_API_KEY`). Reflects what DAM put on the container at start-up.
 * - `agent_default` — comes from the agent image's Dockerfile or
 *   agent-type-specific deploy block (e.g. `OPENCLAW_PORT`,
 *   `HERMES_HOME`). Includes generic image keys like `PATH`.
 * - `channels` — merged in via `tytus channels add` writing
 *   `channels.json` (e.g. `TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN`).
 * - `operator_override` — reserved for future per-pod operator-tier
 *   custom env. The OS should render unknown values as a passthrough
 *   string rather than asserting on this enum.
 */
export type EnvVarSource =
  | "runtime"
  | "agent_default"
  | "channels"
  | "operator_override";

export interface PodEnvVar {
  key: string;
  value: string;
  source?: EnvVarSource | string;
}

export interface PodEnv {
  pod_num?: number;
  agent_type?: string;
  /** True if Provider returned raw values (Operator tier + ?reveal=secrets). */
  reveal_secrets?: boolean;
  vars: PodEnvVar[];
}
