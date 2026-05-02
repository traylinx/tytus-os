// ============================================================
// Undo ring — Sprint A Phase 4.7
// ============================================================
//
// Ring buffer of the last 5 file operations. Each entry stores an
// `undo()` thunk supplied by the operation itself — that lets us
// keep the ring backend-agnostic (vfs / daemon / clipboard / drag)
// and lets P3.7 partial-failure semantics naturally fold in: an op
// that produced 7 successes + 3 failures pushes a single entry that
// undoes only the 7.

const MAX_DEPTH = 5;

export interface UndoEntry {
  /** Human-readable label for telemetry / future undo-stack UI. */
  label: string;
  /** Performs the undo. May be async. */
  undo: () => void | Promise<void>;
  /** Time the entry was pushed (unix ms). */
  pushedAt: number;
}

const ring: UndoEntry[] = [];

/** Push an undo entry. Older entries fall off when ring exceeds MAX_DEPTH. */
export function pushUndo(entry: Omit<UndoEntry, "pushedAt">): void {
  ring.push({ ...entry, pushedAt: Date.now() });
  while (ring.length > MAX_DEPTH) ring.shift();
}

/**
 * Pop and run the most recent entry. Returns the entry that was
 * popped, or null if the ring was empty.
 */
export async function undoLast(): Promise<UndoEntry | null> {
  const e = ring.pop();
  if (!e) return null;
  await e.undo();
  return e;
}

/** Read-only view for UI / tests. */
export function peekUndoRing(): readonly UndoEntry[] {
  return ring.slice();
}

/** Test helper. */
export function _resetUndoForTest(): void {
  ring.length = 0;
}
