export interface PodReady {
  ready: boolean;
  status: number | string;
  reason: string;
  probe_url: string;
}
