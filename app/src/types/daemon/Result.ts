// DaemonResult<T> — discriminated error envelope for every daemon call.
// 9 categories per 09-DESIGN-ERROR-UX.md (E1..E9). Surfacing rules live in
// the UI layer; the client only classifies.

export type DaemonErrorCode =
  | "daemon_offline"      // E1: port file missing or ECONNREFUSED
  | "daemon_unhealthy"    // E2: /api/state returns malformed body
  | "auth_required"       // E3: logged_in === false
  | "not_found"           // E4: 404 plain-text "not found"
  | "validation"          // E5: 400 + ErrorEnvelope
  | "logical_error"       // E6: 200 + ErrorEnvelope
  | "job_failed"          // E7: SSE exit code !== 0
  | "network_timeout"     // E8: fetch timeout / aborted
  | "internal_error";     // E9: unexpected exception during request

export interface DaemonError {
  code: DaemonErrorCode;
  message: string;
  status?: number;
  cause?: unknown;
}

export type DaemonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DaemonError };

export const ok = <T>(value: T): DaemonResult<T> => ({ ok: true, value });

export const err = <T>(error: DaemonError): DaemonResult<T> => ({
  ok: false,
  error,
});
