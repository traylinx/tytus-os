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
  target_status?: SharedFolderTargetStatus[];
  sync_status?: SharedFolderSyncStatus;
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

/**
 * Verified Mac-side endpoint health (mac-sync-health-v1), produced by
 * `garagetytus sync health` and attached per-binding by the tytus-cli daemon.
 * Shared across bindings (one rclone endpoint). The UI prefers this over the
 * local bisync-baseline heuristic: a green "synced" derived only from baseline
 * files is a lie when the endpoint is unreachable. All fields optional so an
 * older daemon (no endpoint_health) degrades gracefully to "unknown".
 */
export interface SharedFolderEndpointHealth {
  schema_version?: string;
  state?: "ok" | "degraded" | "failed" | "unknown" | string;
  reachable?: boolean | null;
  consecutive_failures?: number;
  last_success_ts?: string | null;
  last_error?: string | null;
  endpoint_checked?: string;
  updated_at?: string;
  stale_after_seconds?: number;
  /** True when the daemon found the health file older than stale_after_seconds. */
  stale?: boolean;
  /** dependency/control upload-exclude counts by reason (e.g. {dependency: 124}). */
  excluded?: Record<string, number>;
}

export interface SharedFolderSyncStatus {
  state: "pending" | "syncing" | "synced" | "attention";
  phase?:
    | "initial_resync"
    | "incremental"
    | "idle"
    | "stale_lock"
    | "endpoint_unreachable"
    | string;
  active?: boolean;
  baseline_ready?: boolean;
  checked_at?: number | string;
  workdir?: string;
  lock_file?: string;
  lock_pid?: number;
  lock_active?: boolean;
  lock_expires?: string;
  /** Verified endpoint health overlaid by the daemon (Phase 4). */
  endpoint_health?: SharedFolderEndpointHealth;
}

export interface SharedFolderTargetStatus {
  runtime_id: string;
  route_id?: string;
  provision_selector?: string;
  target_id?: string;
  label?: string;
  selected: boolean;
  grant_verified: boolean;
  state: "verified" | "grant_missing" | "verification_error" | "unselected";
  error?: string | null;
  checked_at?: number;
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
  all_buckets?: boolean;
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

export interface SharedFolderSyncNowRequest {
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
