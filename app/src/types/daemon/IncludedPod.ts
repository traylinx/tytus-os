import type { Secret } from "./Secret";

export interface IncludedPod {
  endpoint: string;
  kind: "ail";
  /** Stable local identity. Prefer route_id because pod_id can repeat across droplets. */
  id?: string;
  pod_id: string;
  /** Globally unique Provider route id when known. */
  route_id?: string;
  /** User-facing label. Prefer display_name; fall back to "Pod NN". */
  display_label?: string;
  public_url: string;
  user_key: Secret;
}
