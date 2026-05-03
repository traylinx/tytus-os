// Memo repo — atomic-note CRUD against the app_memo_memos table.
//
// Three structural notes:
//
//   1. Physical table name is the per-app prefixed `app_memo_memos`.
//      The host-api prefix guard rejects any query that touches a
//      table outside the bound app's prefix.
//
//   2. tags are exposed as `string[]` to callers; on-disk they live
//      in `tags_json` as a JSON-encoded array string. Parse/serialise
//      happens only at the repo boundary.
//
//   3. updateMemo re-parses the body and upserts links via the
//      resolver. Saves are the only place link rows mutate; the UI
//      does not call the resolver directly.

import type { AppDb } from '@tytus/host-api';
import { upsertLinks } from './linkResolver';

export interface MemoRow {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  mirrorToBrain: boolean;
  createdAt: number;
  updatedAt: number;
}

interface DBRow {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags_json: string;
  mirror_to_brain: number;
  created_at: number;
  updated_at: number;
}

const fromDb = (r: DBRow): MemoRow => {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(r.tags_json);
    if (Array.isArray(parsed)) {
      tags = parsed.filter((t): t is string => typeof t === 'string');
    }
  } catch {
    // Malformed tags_json — treat as empty rather than crash.
    tags = [];
  }
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    body: r.body,
    tags,
    mirrorToBrain: r.mirror_to_brain !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

const generateId = (): string =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface ListMemosOpts {
  /** Default unbounded; pass a positive integer to cap. */
  limit?: number;
}

export const listMemos = async (
  db: AppDb,
  opts: ListMemosOpts = {},
): Promise<MemoRow[]> => {
  const limit = typeof opts.limit === 'number' && opts.limit > 0
    ? Math.floor(opts.limit)
    : null;
  const sql = limit !== null
    ? `SELECT id, slug, title, body, tags_json, mirror_to_brain,
              created_at, updated_at
         FROM app_memo_memos
        ORDER BY updated_at DESC
        LIMIT ?`
    : `SELECT id, slug, title, body, tags_json, mirror_to_brain,
              created_at, updated_at
         FROM app_memo_memos
        ORDER BY updated_at DESC`;
  const args = limit !== null ? [limit] : [];
  const rows = await db.query<DBRow>(sql, args);
  return rows.map(fromDb);
};

export const getMemo = async (
  db: AppDb,
  id: string,
): Promise<MemoRow | null> => {
  const rows = await db.query<DBRow>(
    `SELECT id, slug, title, body, tags_json, mirror_to_brain,
            created_at, updated_at
       FROM app_memo_memos
      WHERE id = ?
      LIMIT 1`,
    [id],
  );
  return rows.length > 0 ? fromDb(rows[0]) : null;
};

export const getMemoBySlug = async (
  db: AppDb,
  slug: string,
): Promise<MemoRow | null> => {
  const rows = await db.query<DBRow>(
    `SELECT id, slug, title, body, tags_json, mirror_to_brain,
            created_at, updated_at
       FROM app_memo_memos
      WHERE slug = ?
      LIMIT 1`,
    [slug],
  );
  return rows.length > 0 ? fromDb(rows[0]) : null;
};

export interface CreateMemoInput {
  slug: string;
  title: string;
  body?: string;
  tags?: string[];
  mirrorToBrain?: boolean;
  /** Optional explicit id (tests + deterministic flows). Auto if absent. */
  id?: string;
  /** Optional explicit timestamp. Auto if absent. */
  now?: number;
}

export const createMemo = async (
  db: AppDb,
  input: CreateMemoInput,
): Promise<MemoRow> => {
  const id = input.id ?? generateId();
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const body = input.body ?? '';
  const tags = input.tags ?? [];
  const mirrorToBrain = input.mirrorToBrain ?? false;

  await db.run(
    `INSERT INTO app_memo_memos
       (id, slug, title, body, tags_json, mirror_to_brain,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.slug,
      input.title,
      body,
      JSON.stringify(tags),
      mirrorToBrain ? 1 : 0,
      now,
      now,
    ],
  );

  // First save: index any links the seed body already contains.
  await upsertLinks(db, id, body);

  return {
    id,
    slug: input.slug,
    title: input.title,
    body,
    tags,
    mirrorToBrain,
    createdAt: now,
    updatedAt: now,
  };
};

export interface UpdateMemoPatch {
  slug?: string;
  title?: string;
  body?: string;
  tags?: string[];
  mirrorToBrain?: boolean;
  /** Optional explicit timestamp for the new updated_at. */
  now?: number;
}

/**
 * Patch any subset of memo fields. Always bumps updated_at. If `body`
 * is part of the patch, re-parses it and reconciles
 * app_memo_links — even if other fields change, the link table only
 * mutates when the body itself changes.
 */
export const updateMemo = async (
  db: AppDb,
  id: string,
  patch: UpdateMemoPatch,
): Promise<void> => {
  const now = typeof patch.now === 'number' ? patch.now : Date.now();

  const sets: string[] = [];
  const args: unknown[] = [];

  if (patch.slug !== undefined) {
    sets.push('slug = ?');
    args.push(patch.slug);
  }
  if (patch.title !== undefined) {
    sets.push('title = ?');
    args.push(patch.title);
  }
  if (patch.body !== undefined) {
    sets.push('body = ?');
    args.push(patch.body);
  }
  if (patch.tags !== undefined) {
    sets.push('tags_json = ?');
    args.push(JSON.stringify(patch.tags));
  }
  if (patch.mirrorToBrain !== undefined) {
    sets.push('mirror_to_brain = ?');
    args.push(patch.mirrorToBrain ? 1 : 0);
  }

  // Always bump updated_at, even if no other field changed (treat the
  // call as a touch).
  sets.push('updated_at = ?');
  args.push(now);

  args.push(id);

  await db.run(
    `UPDATE app_memo_memos SET ${sets.join(', ')} WHERE id = ?`,
    args,
  );

  if (patch.body !== undefined) {
    await upsertLinks(db, id, patch.body);
  }
};

export const deleteMemo = async (
  db: AppDb,
  id: string,
): Promise<void> => {
  await db.run(`DELETE FROM app_memo_memos WHERE id = ?`, [id]);
  // Drop any outbound links from this memo. Inbound links (other
  // memos pointing at this one) become forward-refs naturally on
  // their next save when resolveTarget returns null.
  await db.run(`DELETE FROM app_memo_links WHERE source_id = ?`, [id]);
};

/**
 * Backlinks panel data: every memo that has an outbound link whose
 * target_id resolves to `targetId`. Returns the source MemoRow shape
 * so the UI can render slug + title without a second query.
 */
export const listBacklinks = async (
  db: AppDb,
  targetId: string,
): Promise<MemoRow[]> => {
  const rows = await db.query<DBRow>(
    `SELECT DISTINCT m.id, m.slug, m.title, m.body, m.tags_json,
            m.mirror_to_brain, m.created_at, m.updated_at
       FROM app_memo_memos m
       JOIN app_memo_links l ON l.source_id = m.id
      WHERE l.target_id = ?
      ORDER BY m.updated_at DESC`,
    [targetId],
  );
  return rows.map(fromDb);
};
