export type UpdateStatusKind = "up_to_date" | "update_available" | "unknown";

export interface UpdateStatus {
  current_version: string;
  installed_version: string;
  latest_version: string | null;
  release_tag: string | null;
  release_url: string | null;
  install_url: string | null;
  install_command: string;
  can_install: boolean;
  channel: string;
  status: UpdateStatusKind;
  automatic_checks: boolean;
  last_checked_at: number | null;
  checked_at: number | null;
  detail: string;
}

export interface UpdateInstallResult {
  ok: boolean;
  command: string;
  message: string;
}
