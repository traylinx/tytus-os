// ============================================================
// File conflict resolution model
// ============================================================
//
// When a multi-item move/copy/paste/restore lands on a destination
// that already has a file with the same name, the user chooses one
// of four resolutions per item (or "apply to all" for the batch):
//
//   • replace     — overwrite the destination
//   • keep-both   — auto-rename via `nextAvailableName`
//   • skip        — leave the destination untouched, drop this item
//   • cancel-all  — abort the rest of the batch (already-completed
//                   items in the batch surface as `PerItemResult.ok=true`
//                   in the toast; no rollback is attempted at this layer)
//
// macOS HFS+ is case-insensitive so collisions are detected in a
// case-insensitive way, but the case of the existing entry is
// preserved when generating the candidate name.

export type ConflictResolution = "replace" | "keep-both" | "skip" | "cancel-all";

export const CONFLICT_RESOLUTIONS: readonly ConflictResolution[] = [
  "replace",
  "keep-both",
  "skip",
  "cancel-all",
] as const;

/**
 * Returns a name that does not collide with any of `existing`. If
 * `proposed` itself is free, returns it unchanged. Otherwise appends
 * ` (N)` before the file extension where N is the smallest integer
 * ≥ 2 that produces a free name. The check is case-insensitive
 * (matches macOS HFS+ default behaviour).
 *
 * Examples:
 *   nextAvailableName(['foo.txt'], 'foo.txt')              === 'foo (2).txt'
 *   nextAvailableName(['foo.txt', 'foo (2).txt'], 'foo.txt') === 'foo (3).txt'
 *   nextAvailableName(['Foo.txt'], 'foo.txt')              === 'foo (2).txt'
 *   nextAvailableName([], 'foo.txt')                       === 'foo.txt'
 *   nextAvailableName(['readme'], 'readme')                === 'readme (2)'
 *   nextAvailableName(['archive.tar.gz'], 'archive.tar.gz') === 'archive.tar (2).gz'
 */
export function nextAvailableName(
  existing: readonly string[],
  proposed: string,
): string {
  if (!proposed) {
    throw new Error("nextAvailableName: proposed name is required");
  }
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(proposed.toLowerCase())) {
    return proposed;
  }
  const { stem, ext } = splitExt(proposed);
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  throw new Error(
    `nextAvailableName: exhausted 10000 candidates for "${proposed}"`,
  );
}

/**
 * Split a filename at its *first* dot suffix. Hidden files starting
 * with a single leading dot are kept whole (".bashrc" → stem
 * ".bashrc", ext ""). Compound suffixes like ".tar.gz" split at the
 * last dot only — Finder's "Keep both" produces "archive.tar (2).gz"
 * and we mirror that behaviour for muscle-memory reasons.
 */
export function splitExt(name: string): { stem: string; ext: string } {
  if (!name) return { stem: "", ext: "" };
  const dot = name.lastIndexOf(".");
  // Leading-dot hidden files: ".bashrc" → no extension.
  if (dot <= 0) {
    return { stem: name, ext: "" };
  }
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Case-insensitive name collision check used by drop-target preview.
 * Returns the indices of `incoming` items whose name collides with
 * something in `destination`.
 */
export function findCollisions(
  destination: readonly string[],
  incoming: readonly string[],
): number[] {
  const taken = new Set(destination.map((n) => n.toLowerCase()));
  const out: number[] = [];
  for (let i = 0; i < incoming.length; i++) {
    if (taken.has(incoming[i].toLowerCase())) out.push(i);
  }
  return out;
}
