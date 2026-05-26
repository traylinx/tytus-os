export interface Binding {
  auto_sync: boolean;
  bound_at: string;
  bucket: string;
  interval_sec: number;
  local_path: string;
  plist_label: string;
  pods_provisioned: string[];
  schema_version: number;
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
