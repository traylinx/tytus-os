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
