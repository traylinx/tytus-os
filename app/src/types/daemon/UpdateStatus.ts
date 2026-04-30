export type UpdateStatusKind = "up_to_date" | "update_available" | "unknown";

export interface UpdateStatus {
  current_version: string;
  installed_version: string;
  latest_version: string | null;
  channel: string;
  status: UpdateStatusKind;
  automatic_checks: boolean;
  last_checked_at: number | null;
  checked_at: number | null;
  detail: string;
}
