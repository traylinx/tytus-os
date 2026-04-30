export type PodReadinessOverall =
  | "provisioning"
  | "starting"
  | "ready"
  | "degraded"
  | "failed";

export type PodReadinessStageStatus =
  | "ok"
  | "starting"
  | "failed"
  | "unknown"
  | "skipped"
  | "degraded"
  | "not_configured";

export interface PodReadinessStage {
  id: string;
  label: string;
  status: PodReadinessStageStatus;
  detail: string | null;
}

export interface PodReadiness {
  pod_id: string;
  agent: string | null;
  overall: PodReadinessOverall;
  open_enabled: boolean;
  strict: boolean;
  stages: PodReadinessStage[];
  last_checked_at: number | string;
}
