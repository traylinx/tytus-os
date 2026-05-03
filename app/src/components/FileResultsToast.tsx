// ============================================================
// FileResultsToast — Phase 3.7 partial-failure summary toast
// ============================================================
//
// Renders aggregate `PerItemResult[]` from a multi-item file op
// (move / copy / delete / paste / restore). Non-blocking: dismisses
// on Esc or after `autoDismissMs`. Per-item Retry button calls back
// for the specific failed ref where the failure reason is retryable.

import { memo, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X, RefreshCw } from "lucide-react";
import {
  isRetryable,
  partitionResults,
  type PerItemResult,
} from "@/lib/files/fileOps";
import type { FileRef } from "@/lib/files/fileRef";

interface FileResultsToastProps {
  results: readonly PerItemResult[];
  /** Optional per-item retry. */
  onRetry?: (ref: FileRef) => void;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms when nothing failed. Default 4000. */
  autoDismissMs?: number;
}

const FileResultsToast = memo(function FileResultsToast({
  results,
  onRetry,
  onDismiss,
  autoDismissMs = 4000,
}: FileResultsToastProps) {
  const { ok, failed } = partitionResults(results);
  const [expanded, setExpanded] = useState(failed.length > 0);

  // Auto-dismiss on full success only — failures stay until the user
  // acks them.
  useEffect(() => {
    if (failed.length > 0) return;
    const id = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(id);
  }, [failed.length, autoDismissMs, onDismiss]);

  if (results.length === 0) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 right-6 z-[6500] w-[360px] rounded-lg p-3 space-y-2 text-xs"
      style={{
        background: "var(--bg-window)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-md)",
        color: "var(--text-primary)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {failed.length === 0 ? (
            <CheckCircle2 size={14} style={{ color: "var(--accent-success)" }} />
          ) : (
            <AlertTriangle size={14} style={{ color: "var(--accent-warning)" }} />
          )}
          <span className="font-medium">
            {failed.length === 0
              ? `${ok.length} item${ok.length === 1 ? "" : "s"} done`
              : `${ok.length} of ${results.length} succeeded`}
          </span>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <X size={14} />
        </button>
      </div>

      {failed.length > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[var(--accent-primary)] underline"
        >
          {expanded ? "Hide details" : `Show ${failed.length} failure${failed.length === 1 ? "" : "s"}`}
        </button>
      )}

      {expanded && failed.length > 0 && (
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {failed.map((f, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-2 px-1 py-1 rounded-md"
              style={{ background: "var(--bg-card)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[var(--text-primary)]">
                  {refDisplayName(f.ref)}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] truncate">
                  {f.reason}: {f.message}
                </div>
              </div>
              {onRetry && isRetryable(f.reason) && (
                <button
                  onClick={() => onRetry(f.ref)}
                  className="shrink-0 flex items-center gap-1 text-[var(--accent-primary)]"
                >
                  <RefreshCw size={11} /> Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

function refDisplayName(ref: FileRef): string {
  if (ref.source === "vfs") return ref.nodeId;
  const segs = ref.path.split("/").filter(Boolean);
  return segs[segs.length - 1] || ref.path;
}

export default FileResultsToast;
