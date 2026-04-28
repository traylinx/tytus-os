export interface JobResponse {
  job_id: string;
}

export interface JobCancelResult {
  cancelled: boolean;
  reason?: string;
  pid?: number;
}
