import type { Secret } from "./Secret";

export interface IncludedPod {
  endpoint: string;
  kind: "ail";
  pod_id: string;
  public_url: string;
  user_key: Secret;
}
