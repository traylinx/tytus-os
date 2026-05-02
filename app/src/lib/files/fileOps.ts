// ============================================================
// fileOps — backend-aware façade for file operations
// ============================================================
//
// Sprint A Phase 0 ships the *skeleton* (types + signatures + a
// not-implemented backend dispatcher). Concrete implementations land
// alongside the consumers that need them:
//
//   • Phase 3.1–3.5 — DnD-driven move/copy across vfs ↔ daemon.
//   • Phase 4.1–4.6 — trash, restore, paste, undo (clipboard +
//     conflict resolution + per-item results all flow through here).
//
// The reason this façade exists at all: every multi-item file
// operation in Sprint A produces a `PerItemResult[]`. Some succeed
// while others conflict / hit permission errors / cross an
// unsupported backend boundary. The UI then renders a single
// non-blocking results toast (Phase 3.7) showing what happened. We
// can't get that right with ad-hoc move/copy calls scattered across
// Desktop.tsx and FileManager.tsx — the partial-failure semantics
// have to live in one place.

import type { ConflictResolution } from "./conflict";
import type { FileRef } from "./fileRef";

/**
 * Per-item outcome returned from every multi-item file operation.
 * The UI renders one toast aggregating the array; failures keep
 * their original ref so the toast can offer a Retry button (where
 * the failure reason is retryable).
 */
export type PerItemResult =
  | {
      ok: true;
      ref: FileRef;
      /**
       * Where the item ended up. For a move/copy this is the new
       * location; for a rename it's the renamed ref; for a delete
       * it's the trash ref (so undo can restore).
       */
      finalRef: FileRef;
    }
  | {
      ok: false;
      ref: FileRef;
      reason: PerItemFailureReason;
      message: string;
    };

export type PerItemFailureReason =
  | "conflict"
  | "permission"
  | "not-found"
  | "cross-backend-not-supported"
  | "size-limit"
  | "network"
  | "unknown";

/**
 * Options shared by move/copy. `onConflict` is consulted *per item*;
 * if the caller resolves the dialog with "apply to all" the same
 * resolution is reused for the rest of the batch.
 */
export interface MoveOpts {
  /**
   * Called when a destination collision is detected. Return the
   * resolution for this item (or `cancel-all` to abort the rest of
   * the batch). If undefined, all conflicts surface as
   * `PerItemResult { ok: false, reason: 'conflict' }`.
   */
  onConflict?: (item: FileRef, destDir: FileRef) => Promise<ConflictResolution>;
  /** Abort signal — partial successes still appear in the result array. */
  signal?: AbortSignal;
}

export type CopyOpts = MoveOpts;

export interface DeleteOpts {
  signal?: AbortSignal;
}

/**
 * Façade signatures. Every implementation MUST:
 *
 *   1. Honour `opts.signal` and surface `network`/`unknown` failures
 *      as `PerItemResult { ok: false }` rather than throwing.
 *   2. Return one `PerItemResult` per input ref, in input order.
 *   3. Pick the vfs vs daemon path internally based on
 *      `item.source` + `destDir.source`.
 *
 * NOTE: The Phase 0 skeleton throws `not-implemented` so any caller
 * that reaches it before Phase 3 surfaces a loud failure rather
 * than silently dropping bytes.
 */
export async function moveFiles(
  items: readonly FileRef[],
  destDir: FileRef,
  opts?: MoveOpts,
): Promise<PerItemResult[]> {
  return notImplementedBatch("moveFiles", items, destDir, opts?.signal);
}

export async function copyFiles(
  items: readonly FileRef[],
  destDir: FileRef,
  opts?: CopyOpts,
): Promise<PerItemResult[]> {
  return notImplementedBatch("copyFiles", items, destDir, opts?.signal);
}

export async function deleteFiles(
  items: readonly FileRef[],
  opts?: DeleteOpts,
): Promise<PerItemResult[]> {
  return notImplementedBatch("deleteFiles", items, undefined, opts?.signal);
}

export async function renameFile(
  item: FileRef,
  newName: string,
): Promise<PerItemResult> {
  return {
    ok: false,
    ref: item,
    reason: "unknown",
    message: `renameFile(${newName}) not yet implemented (Phase 3)`,
  };
}

function notImplementedBatch(
  fnName: string,
  items: readonly FileRef[],
  _destDir: FileRef | undefined,
  signal: AbortSignal | undefined,
): PerItemResult[] {
  if (signal?.aborted) {
    return items.map((ref) => ({
      ok: false,
      ref,
      reason: "unknown",
      message: `${fnName} aborted before dispatch`,
    }));
  }
  return items.map((ref) => ({
    ok: false,
    ref,
    reason: "unknown",
    message: `${fnName} not yet implemented (Phase 3)`,
  }));
}

/**
 * Helper used by the Phase 3.7 results toast: split a
 * `PerItemResult[]` into successes and failures preserving order.
 */
export function partitionResults(results: readonly PerItemResult[]): {
  ok: Extract<PerItemResult, { ok: true }>[];
  failed: Extract<PerItemResult, { ok: false }>[];
} {
  const ok: Extract<PerItemResult, { ok: true }>[] = [];
  const failed: Extract<PerItemResult, { ok: false }>[] = [];
  for (const r of results) {
    if (r.ok) ok.push(r);
    else failed.push(r);
  }
  return { ok, failed };
}

/**
 * Whether a failure reason is worth offering a per-item Retry for.
 * `cross-backend-not-supported` is structural — retrying won't help.
 */
export function isRetryable(reason: PerItemFailureReason): boolean {
  switch (reason) {
    case "network":
    case "unknown":
    case "permission":
    case "size-limit":
    case "conflict":
      return true;
    case "cross-backend-not-supported":
    case "not-found":
      return false;
  }
}
