/**
 * Daemon identity + boot timestamp. Returned by `GET /api/version`.
 *
 * `daemon_started_at` is the daemon's boot time (Unix seconds, set
 * once via OnceLock in tray::web_server). UI consumers persist the
 * last-seen value and detect a daemon restart when it changes — a
 * restart invalidates every in-flight `job_id` since the registry
 * is in-memory only.
 *
 * `daemon_version` is the `tytus-tray` crate version. Future TytusOS
 * builds compare it against a min-required value to surface "your
 * tray is too old" instead of failing with an opaque 404 on a route
 * that hasn't shipped yet.
 */
export interface DaemonVersion {
  daemon_version: string;
  daemon_pid: number;
  daemon_started_at: number;
}
