// Memo — bidirectional [[wikilink]] resolver.
//
// Three primitives:
//
//   1. parseLinks(body) — pure string → list of {position, targetName}
//      pairs. Used at save time AND in tests, so it's deliberately
//      side-effect-free.
//
//   2. resolveTarget(db, targetName) — slug-derived lookup against
//      app_memo_memos. Returns memo.id or null. Null = forward-ref;
//      the link row stays with target_id = NULL until a memo with the
//      matching slug is created.
//
//   3. upsertLinks(db, sourceId, body) — re-parse + reconcile.
//      Algorithm:
//        a. parse the body
//        b. INSERT OR REPLACE every (sourceId, position) pair
//        c. delete any rows for sourceId whose position is no longer
//           in the new parse (the body shrank or links were removed)
//      Idempotent: running twice on the same body produces the same
//      rows.
//
// The (source_id, position) PRIMARY KEY in 0002_links.sql is the
// load-bearing invariant: we use position as the natural key per
// source_id, which lets us upsert in place rather than wipe + reinsert
// (preserves created_at for stable links).

import type { AppDb } from '@tytus/host-api';

/** One parsed [[wikilink]] occurrence. */
export interface ParsedLink {
  /** Character offset of the opening `[` (i.e. of the FIRST `[`). */
  position: number;
  /** Raw target as written between the brackets. NOT slugified. */
  targetName: string;
}

// Match `[[...]]` where the inner content is non-greedy and must NOT
// contain `]` or `[` (so adjacent links `[[A]][[B]]` parse as two,
// not one giant match).
const LINK_RE = /\[\[([^\[\]]+?)\]\]/g;

/**
 * Extract every [[name]] occurrence from `body`. Position is the char
 * offset of the opening `[`. Multiple links allowed; same target name
 * allowed at different positions.
 */
export function parseLinks(body: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  if (!body) return out;
  // Reset lastIndex defensively — module-level regex would otherwise
  // carry state across calls if /g were misused via .exec elsewhere.
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(body)) !== null) {
    const inner = match[1].trim();
    if (inner.length === 0) continue;
    out.push({ position: match.index, targetName: inner });
  }
  return out;
}

/**
 * Slugify a wikilink target name. Lowercase, dash-separated, alnum +
 * dashes only. Mirrors the slug generator the create flow uses so
 * `[[Title With Spaces]]` resolves to a memo created with slug
 * `title-with-spaces`.
 */
export function slugifyTarget(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve a wikilink target name to a memo id, or null if no memo
 * with the derived slug exists yet (forward-ref). The lookup is by
 * slug, NOT by title — title may drift after creation.
 */
export async function resolveTarget(
  db: AppDb,
  targetName: string,
): Promise<string | null> {
  const slug = slugifyTarget(targetName);
  if (slug.length === 0) return null;
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM app_memo_memos WHERE slug = ? LIMIT 1`,
    [slug],
  );
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Re-parse `body` and reconcile `app_memo_links` rows for `sourceId`:
 *   - upsert every parsed (position, targetName, target_id) row
 *   - delete any existing row for sourceId whose position is no
 *     longer in the new parse
 *
 * Idempotent. Safe to call from any save path.
 */
export async function upsertLinks(
  db: AppDb,
  sourceId: string,
  body: string,
): Promise<void> {
  const parsed = parseLinks(body);
  const now = Date.now();

  // 1. upsert every parsed link
  for (const link of parsed) {
    const targetId = await resolveTarget(db, link.targetName);
    await db.run(
      `INSERT OR REPLACE INTO app_memo_links
         (source_id, position, target_name, target_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [sourceId, link.position, link.targetName, targetId, now],
    );
  }

  // 2. delete orphans — rows whose position is NOT in the new parse.
  //    SQLite has no array-bind, so we render the IN-list inline. The
  //    positions are integers we just produced, so injection is not a
  //    concern; we still cast through Number() to be defensive.
  const keepPositions = parsed.map((p) => Number(p.position));
  if (keepPositions.length === 0) {
    await db.run(
      `DELETE FROM app_memo_links WHERE source_id = ?`,
      [sourceId],
    );
  } else {
    const placeholders = keepPositions.map(() => '?').join(',');
    await db.run(
      `DELETE FROM app_memo_links
        WHERE source_id = ?
          AND position NOT IN (${placeholders})`,
      [sourceId, ...keepPositions],
    );
  }
}
