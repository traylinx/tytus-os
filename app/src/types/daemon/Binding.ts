export interface Binding {
  auto_sync: boolean;
  bound_at: string;
  bucket: string;
  folder_id?: string;
  interval_sec: number;
  local_path: string;
  plist_label: string;
  pods_provisioned: string[];
  /** Route-aware provision selectors, e.g. Lisa/Claus/Hermie route ids. */
  routes_provisioned?: string[];
  runtime_status?: Record<
    string,
    {
      state?: string;
      workspace_path?: string;
      object_count?: number;
      helper_mode?: string;
      last_materialized_at?: string;
      last_error?: string | null;
    }
  >;
  schema_version: number;
  slug?: string;
  sync_layout?: string;
  targets?: Array<{
    runtime_id: string;
    route_id?: string;
    provision_selector?: string;
    kind?: string;
    labels?: string[];
    target_id?: string;
    enabled?: boolean;
  }>;
  workdir: string;
}

export interface SharedFoldersList {
  bindings: Binding[];
}

export interface SharingDefaults {
  schema_version: number;
  sharing_globally_enabled: boolean;
  default_auto_sync: boolean;
  default_bucket: string;
  default_local_root: string;
}

export interface SharedFolderProvisionPodRequest {
  pod: string;
  buckets?: string[];
  no_restart?: boolean;
}

export interface SharedFolderTargetUpdate {
  target_id: string;
  pod_id: string;
  route_id?: string;
  provision_selector?: string;
  label: string;
  kind: "agent" | "included";
  enabled: boolean;
}

export interface SharedFolderUpdateTargetsRequest {
  bucket: string;
  local_path: string;
  pods: string[];
  targets: SharedFolderTargetUpdate[];
}

export interface SharedFolderUpdateAliasRequest {
  bucket: string;
  local_path: string;
  slug: string;
}

export interface SharedFolderRemoveRequest {
  bucket: string;
  local_path: string;
}

export interface GaragetytusHelperStatus {
  name: string;
  found: boolean;
  path: string | null;
}

export interface GaragetytusStatus {
  available: boolean;
  running: boolean | null;
  state: string;
  status_text: string;
  version: string | null;
  port: number;
  garage_endpoint?: string;
  garage_endpoint_reachable?: boolean;
  binary_path: string | null;
  cache_path: string | null;
  cache_exists: boolean;
  bindings_count: number;
  provisioned_pods: string[];
  helpers: GaragetytusHelperStatus[];
  missing_helpers: string[];
  lifecycle_control_available: boolean;
  lifecycle_control_reason: string;
  warnings: string[];
}
