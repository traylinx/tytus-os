// Studio repo — document + block CRUD against the per-app prefixed
// `app_studio_documents` / `app_studio_blocks` tables.
//
// Design notes:
//
//   1. Block `meta` is exposed as a typed object to callers; on disk it
//      lives in `meta_json` as a JSON-encoded string. The
//      serialise/parse pair happens only at the repo boundary — callers
//      never see the JSON string form.
//
//   2. Block `position` is a sparse integer sort key (we step by 1024
//      on insert when no explicit position is given). `moveBlocks`
//      writes a batch of (id, position) updates atomically — the UI
//      uses it for drag-reorder. When the engine ships in M6.x, the
//      Patch.studio.moveBlocks variant maps 1:1.
//
//   3. Document deletes cascade to blocks via the FK + ON DELETE
//      CASCADE clause. We don't issue a manual DELETE FROM blocks first.
//
//   4. The Memo repo is the structural sibling here — same id-generator
//      pattern, same `now` injection for deterministic tests, same
//      "always bump updated_at" rule on update.

import type { AppDb } from '@tytus/host-api';

// ---- Block kind union ------------------------------------------------
//
// Pinned to the M6.2 spec. New kinds get added by amending this union
// + the migration's accepted values + the Studio.tsx renderer. The
// engine's patch algebra branches on this union too (M6.x).
export type BlockKind =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'paragraph'
  | 'bullet'
  | 'code'
  | 'image'
  | 'embed'
  | 'separator';

const ALL_BLOCK_KINDS: readonly BlockKind[] = [
  'heading-1',
  'heading-2',
  'heading-3',
  'paragraph',
  'bullet',
  'code',
  'image',
  'embed',
  'separator',
] as const;

export const isBlockKind = (s: unknown): s is BlockKind =>
  typeof s === 'string' && (ALL_BLOCK_KINDS as readonly string[]).includes(s);

// ---- Public row shapes -----------------------------------------------

export interface DocumentRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface BlockRow {
  id: string;
  documentId: string;
  kind: BlockKind;
  text: string;
  meta: Record<string, unknown>;
  position: number;
}

// ---- DB shapes (raw column names; never leak past the repo) ----------

interface DocumentDbRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface BlockDbRow {
  id: string;
  document_id: string;
  kind: string;
  text: string;
  meta_json: string;
  position: number;
}

const fromDocumentDb = (r: DocumentDbRow): DocumentRow => ({
  id: r.id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const fromBlockDb = (r: BlockDbRow): BlockRow => {
  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(r.meta_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed meta_json — degrade to {} rather than throw. Means a
    // hand-edited row can't crash the document load path.
    meta = {};
  }
  // Defensive: normalise the kind. If a bad row sneaks in we render it
  // as a paragraph rather than crashing the renderer.
  const kind: BlockKind = isBlockKind(r.kind) ? r.kind : 'paragraph';
  return {
    id: r.id,
    documentId: r.document_id,
    kind,
    text: r.text,
    meta,
    position: r.position,
  };
};

const generateId = (prefix: 'd' | 'b'): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ---- Document CRUD ---------------------------------------------------

export const listDocuments = async (db: AppDb): Promise<DocumentRow[]> => {
  const rows = await db.query<DocumentDbRow>(
    `SELECT id, title, created_at, updated_at
       FROM app_studio_documents
      ORDER BY updated_at DESC`,
  );
  return rows.map(fromDocumentDb);
};

export interface CreateDocumentInput {
  title?: string;
  /** Optional explicit id (tests + deterministic flows). */
  id?: string;
  /** Optional explicit timestamp. */
  now?: number;
}

export const createDocument = async (
  db: AppDb,
  input: CreateDocumentInput = {},
): Promise<DocumentRow> => {
  const id = input.id ?? generateId('d');
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const title = input.title && input.title.length > 0 ? input.title : 'Untitled';
  await db.run(
    `INSERT INTO app_studio_documents (id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [id, title, now, now],
  );
  return { id, title, createdAt: now, updatedAt: now };
};

export const getDocument = async (
  db: AppDb,
  docId: string,
): Promise<DocumentRow | null> => {
  const rows = await db.query<DocumentDbRow>(
    `SELECT id, title, created_at, updated_at
       FROM app_studio_documents
      WHERE id = ?
      LIMIT 1`,
    [docId],
  );
  return rows.length > 0 ? fromDocumentDb(rows[0]) : null;
};

export const getDocumentWithBlocks = async (
  db: AppDb,
  docId: string,
): Promise<{ doc: DocumentRow; blocks: BlockRow[] } | null> => {
  const doc = await getDocument(db, docId);
  if (!doc) return null;
  const blockRows = await db.query<BlockDbRow>(
    `SELECT id, document_id, kind, text, meta_json, position
       FROM app_studio_blocks
      WHERE document_id = ?
      ORDER BY position ASC`,
    [docId],
  );
  return { doc, blocks: blockRows.map(fromBlockDb) };
};

export interface UpdateDocumentPatch {
  title?: string;
  /** Optional explicit timestamp for the new updated_at. */
  now?: number;
}

export const updateDocument = async (
  db: AppDb,
  docId: string,
  patch: UpdateDocumentPatch,
): Promise<void> => {
  const now = typeof patch.now === 'number' ? patch.now : Date.now();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    args.push(patch.title);
  }
  // Always bump updated_at — same convention as Memo.
  sets.push('updated_at = ?');
  args.push(now);
  args.push(docId);
  await db.run(
    `UPDATE app_studio_documents SET ${sets.join(', ')} WHERE id = ?`,
    args,
  );
};

export const deleteDocument = async (
  db: AppDb,
  docId: string,
): Promise<void> => {
  // FK ON DELETE CASCADE drops the blocks. We still issue an explicit
  // DELETE FROM blocks first so in-memory test fakes (which don't
  // implement FK cascades) match the live SQLite behaviour. The live
  // engine sees this as a no-op redundancy.
  await db.run(
    `DELETE FROM app_studio_blocks WHERE document_id = ?`,
    [docId],
  );
  await db.run(
    `DELETE FROM app_studio_documents WHERE id = ?`,
    [docId],
  );
};

// ---- Block CRUD ------------------------------------------------------

export interface InsertBlockInput {
  /** Optional explicit id. */
  id?: string;
  kind: BlockKind;
  text?: string;
  meta?: Record<string, unknown>;
  /** Sort key. If absent we use (max(position) + 1024) so inserts land
   *  at the bottom by default. */
  position?: number;
  /** Optional explicit timestamp for the parent document's updated_at. */
  now?: number;
}

export const insertBlock = async (
  db: AppDb,
  docId: string,
  input: InsertBlockInput,
): Promise<BlockRow> => {
  const id = input.id ?? generateId('b');
  const text = input.text ?? '';
  const meta = input.meta ?? {};
  const now = typeof input.now === 'number' ? input.now : Date.now();

  let position = input.position;
  if (typeof position !== 'number') {
    const tail = await db.query<{ max_pos: number | null }>(
      `SELECT MAX(position) AS max_pos
         FROM app_studio_blocks
        WHERE document_id = ?`,
      [docId],
    );
    const max = tail.length > 0 && typeof tail[0].max_pos === 'number'
      ? tail[0].max_pos
      : 0;
    position = max + 1024;
  }

  await db.run(
    `INSERT INTO app_studio_blocks
       (id, document_id, kind, text, meta_json, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, docId, input.kind, text, JSON.stringify(meta), position],
  );

  // Touch the parent document so listDocuments resorts.
  await db.run(
    `UPDATE app_studio_documents SET updated_at = ? WHERE id = ?`,
    [now, docId],
  );

  return {
    id,
    documentId: docId,
    kind: input.kind,
    text,
    meta,
    position,
  };
};

export interface UpdateBlockPatch {
  kind?: BlockKind;
  text?: string;
  meta?: Record<string, unknown>;
  position?: number;
  /** Optional explicit timestamp for the parent document's updated_at. */
  now?: number;
}

/**
 * Patch any subset of block fields. Always bumps the parent
 * document's updated_at — even an isolated block edit should resort
 * the document list (most-recently-edited bubbles up).
 */
export const updateBlock = async (
  db: AppDb,
  blockId: string,
  patch: UpdateBlockPatch,
): Promise<void> => {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.kind !== undefined) {
    sets.push('kind = ?');
    args.push(patch.kind);
  }
  if (patch.text !== undefined) {
    sets.push('text = ?');
    args.push(patch.text);
  }
  if (patch.meta !== undefined) {
    sets.push('meta_json = ?');
    args.push(JSON.stringify(patch.meta));
  }
  if (patch.position !== undefined) {
    sets.push('position = ?');
    args.push(patch.position);
  }
  if (sets.length === 0) {
    // Nothing to do, but still touch the document so callers can use
    // updateBlock as a "touch" without crafting a no-op patch.
    const blockRows = await db.query<{ document_id: string }>(
      `SELECT document_id FROM app_studio_blocks WHERE id = ? LIMIT 1`,
      [blockId],
    );
    if (blockRows.length > 0) {
      const now = typeof patch.now === 'number' ? patch.now : Date.now();
      await db.run(
        `UPDATE app_studio_documents SET updated_at = ? WHERE id = ?`,
        [now, blockRows[0].document_id],
      );
    }
    return;
  }
  args.push(blockId);
  await db.run(
    `UPDATE app_studio_blocks SET ${sets.join(', ')} WHERE id = ?`,
    args,
  );

  // Bump the parent document's updated_at so the doc list resorts.
  const blockRows = await db.query<{ document_id: string }>(
    `SELECT document_id FROM app_studio_blocks WHERE id = ? LIMIT 1`,
    [blockId],
  );
  if (blockRows.length > 0) {
    const now = typeof patch.now === 'number' ? patch.now : Date.now();
    await db.run(
      `UPDATE app_studio_documents SET updated_at = ? WHERE id = ?`,
      [now, blockRows[0].document_id],
    );
  }
};

export const deleteBlock = async (
  db: AppDb,
  blockId: string,
): Promise<void> => {
  // Resolve the parent doc id BEFORE we delete the block so we can
  // still touch the document afterward.
  const blockRows = await db.query<{ document_id: string }>(
    `SELECT document_id FROM app_studio_blocks WHERE id = ? LIMIT 1`,
    [blockId],
  );
  await db.run(
    `DELETE FROM app_studio_blocks WHERE id = ?`,
    [blockId],
  );
  if (blockRows.length > 0) {
    await db.run(
      `UPDATE app_studio_documents SET updated_at = ? WHERE id = ?`,
      [Date.now(), blockRows[0].document_id],
    );
  }
};

export interface BlockMoveMapping {
  id: string;
  position: number;
}

/**
 * Bulk position update — used by drag-reorder. We issue one UPDATE per
 * mapping; the underlying AppDb runs them within the same transaction
 * scope (the host's storage-impl wraps `run` calls in implicit txns).
 *
 * NOTE: callers should pass mappings in the new order; we don't
 * validate that the new positions are unique. The
 * idx_app_studio_blocks_document_position index doesn't enforce
 * uniqueness, but two equal positions just sort by insertion order on
 * the next read.
 */
export const moveBlocks = async (
  db: AppDb,
  docId: string,
  mappings: readonly BlockMoveMapping[],
): Promise<void> => {
  if (mappings.length === 0) return;
  for (const m of mappings) {
    await db.run(
      `UPDATE app_studio_blocks
          SET position = ?
        WHERE id = ? AND document_id = ?`,
      [m.position, m.id, docId],
    );
  }
  await db.run(
    `UPDATE app_studio_documents SET updated_at = ? WHERE id = ?`,
    [Date.now(), docId],
  );
};
