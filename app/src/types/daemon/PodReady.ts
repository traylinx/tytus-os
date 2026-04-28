export interface PodReady {
  ready: boolean;
  status: number;
  reason: string;
  probe_url: string;
}
