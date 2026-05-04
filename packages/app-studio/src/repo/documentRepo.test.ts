// Studio repo tests — exercise the SQL CRUD against an in-memory
// AppDb fake. Same shape as the Memo repo test, expanded for the
// document/block parent-child relationship.

import { describe, it, expect } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  listDocuments,
  createDocument,
  getDocumentWithBlocks,
  updateDocument,
  deleteDocument,
  insertBlock,
  updateBlock,
  deleteBlock,
  moveBlocks,
} from './documentRepo';

interface DocStored {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface BlockStored {
  id: string;
  document_id: string;
  kind: string;
  text: string;
  meta_json: string;
  position: number;
}

class MemoryAppDb implements AppDb {
  documents: DocStored[] = [];
  blocks: BlockStored[] = [];

  /** spy: mutated `run` calls so component tests can assert on inserts. */
  runLog: Array<{ sql: string; args: readonly unknown[] }> = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    this.runLog.push({ sql, args });

    // ---- documents
    if (/INSERT\s+INTO\s+app_studio_documents/i.test(sql)) {
      const [id, title, created_at, updated_at] = args as [
        string, string, number, number,
      ];
      if (this.documents.some((d) => d.id === id)) {
        throw new Error('UNIQUE constraint failed: app_studio_documents.id');
      }
      this.documents.push({ id, title, created_at, updated_at });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/^UPDATE\s+app_studio_documents\s+SET/i.test(sql.trim())) {
      const id = args[args.length - 1] as string;
      const doc = this.documents.find((d) => d.id === id);
      if (!doc) return { lastInsertRowid: 0, changes: 0 };
      const setClause = sql.match(/SET\s+(.+)\s+WHERE/i)?.[1] ?? '';
      const cols = setClause
        .split(',')
        .map((s) => s.trim().split('=')[0].trim());
      cols.forEach((col, idx) => {
        const v = args[idx];
        if (col === 'title') doc.title = v as string;
        if (col === 'updated_at') doc.updated_at = v as number;
      });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/DELETE\s+FROM\s+app_studio_documents\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const before = this.documents.length;
      this.documents = this.documents.filter((d) => d.id !== id);
      return { lastInsertRowid: 0, changes: before - this.documents.length };
    }

    // ---- blocks
    if (/INSERT\s+INTO\s+app_studio_blocks/i.test(sql)) {
      const [id, document_id, kind, text, meta_json, position] = args as [
        string, string, string, string, string, number,
      ];
      this.blocks.push({ id, document_id, kind, text, meta_json, position });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/^UPDATE\s+app_studio_blocks\s+SET/i.test(sql.trim())) {
      // Two flavours: bulk reorder (`WHERE id = ? AND document_id = ?`)
      // and field patch (`WHERE id = ?`).
      const reorder = /WHERE\s+id\s*=\s*\?\s+AND\s+document_id\s*=\s*\?/i.test(
        sql,
      );
      let id: string;
      let setArgs: readonly unknown[];
      if (reorder) {
        // SET position = ? WHERE id = ? AND document_id = ?
        // args = [position, id, document_id]
        id = args[args.length - 2] as string;
        setArgs = args.slice(0, args.length - 2);
      } else {
        id = args[args.length - 1] as string;
        setArgs = args.slice(0, args.length - 1);
      }
      const block = this.blocks.find((b) => b.id === id);
      if (!block) return { lastInsertRowid: 0, changes: 0 };
      const setClause = sql.match(/SET\s+(.+)\s+WHERE/i)?.[1] ?? '';
      const cols = setClause
        .split(',')
        .map((s) => s.trim().split('=')[0].trim());
      cols.forEach((col, idx) => {
        const v = setArgs[idx];
        switch (col) {
          case 'kind':      block.kind      = v as string; break;
          case 'text':      block.text      = v as string; break;
          case 'meta_json': block.meta_json = v as string; break;
          case 'position':  block.position  = v as number; break;
        }
      });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/DELETE\s+FROM\s+app_studio_blocks\s+WHERE\s+document_id/i.test(sql)) {
      const [docId] = args as [string];
      const before = this.blocks.length;
      this.blocks = this.blocks.filter((b) => b.document_id !== docId);
      return { lastInsertRowid: 0, changes: before - this.blocks.length };
    }
    if (/DELETE\s+FROM\s+app_studio_blocks\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const before = this.blocks.length;
      this.blocks = this.blocks.filter((b) => b.id !== id);
      return { lastInsertRowid: 0, changes: before - this.blocks.length };
    }

    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    // SELECT MAX(position) AS max_pos FROM app_studio_blocks WHERE document_id = ?
    if (/MAX\(position\)\s+AS\s+max_pos/i.test(sql)) {
      const [docId] = args as [string];
      const positions = this.blocks
        .filter((b) => b.document_id === docId)
        .map((b) => b.position);
      const max_pos = positions.length === 0 ? null : Math.max(...positions);
      return [{ max_pos }] as unknown as T[];
    }
    // SELECT document_id FROM app_studio_blocks WHERE id = ? LIMIT 1
    if (/SELECT\s+document_id\s+FROM\s+app_studio_blocks\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const block = this.blocks.find((b) => b.id === id);
      return (block ? [{ document_id: block.document_id }] : []) as unknown as T[];
    }
    // SELECT ... FROM app_studio_blocks WHERE document_id = ? ORDER BY position ASC
    if (/FROM\s+app_studio_blocks\s+WHERE\s+document_id/i.test(sql)) {
      const [docId] = args as [string];
      const rows = this.blocks
        .filter((b) => b.document_id === docId)
        .sort((a, b) => a.position - b.position);
      return rows as unknown as T[];
    }
    // SELECT ... FROM app_studio_documents WHERE id = ? LIMIT 1
    if (/FROM\s+app_studio_documents\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const doc = this.documents.find((d) => d.id === id);
      return (doc ? [doc] : []) as unknown as T[];
    }
    // SELECT ... FROM app_studio_documents ORDER BY updated_at DESC
    if (/FROM\s+app_studio_documents\s+ORDER\s+BY\s+updated_at\s+DESC/i.test(sql)) {
      const sorted = [...this.documents].sort(
        (a, b) => b.updated_at - a.updated_at,
      );
      return sorted as unknown as T[];
    }
    return [] as T[];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_studio_documents', 'app_studio_blocks', 'app_studio_ai_usage'];
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('documentRepo — documents CRUD', () => {
  it('createDocument + listDocuments round-trips and orders by updated_at DESC', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd_a', title: 'Alpha', now: 100 });
    await createDocument(db, { id: 'd_b', title: 'Beta', now: 300 });
    await createDocument(db, { id: 'd_c', title: 'Gamma', now: 200 });
    const list = await listDocuments(db);
    expect(list.map((d) => d.id)).toEqual(['d_b', 'd_c', 'd_a']);
    expect(list[0].title).toBe('Beta');
  });

  it('createDocument generates an id when none is provided', async () => {
    const db = new MemoryAppDb();
    const doc = await createDocument(db, { title: 'auto-id' });
    expect(doc.id).toMatch(/^d_/);
    expect(doc.id.length).toBeGreaterThan(2);
  });

  it('createDocument defaults the title to "Untitled" when empty/absent', async () => {
    const db = new MemoryAppDb();
    const a = await createDocument(db);
    const b = await createDocument(db, { title: '' });
    expect(a.title).toBe('Untitled');
    expect(b.title).toBe('Untitled');
  });

  it('getDocumentWithBlocks returns null for a non-existent document', async () => {
    const db = new MemoryAppDb();
    const row = await getDocumentWithBlocks(db, 'does-not-exist');
    expect(row).toBeNull();
  });

  it('getDocumentWithBlocks returns blocks ordered by position ASC', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    await insertBlock(db, 'd1', { id: 'b3', kind: 'paragraph', text: 'third', position: 3000 });
    await insertBlock(db, 'd1', { id: 'b1', kind: 'paragraph', text: 'first', position: 1000 });
    await insertBlock(db, 'd1', { id: 'b2', kind: 'paragraph', text: 'second', position: 2000 });
    const result = await getDocumentWithBlocks(db, 'd1');
    expect(result).not.toBeNull();
    expect(result!.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(result!.blocks.map((b) => b.text)).toEqual(['first', 'second', 'third']);
  });

  it('updateDocument patches title + bumps updated_at', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', title: 'Old', now: 1_000 });
    await updateDocument(db, 'd1', { title: 'New', now: 2_000 });
    const result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.doc.title).toBe('New');
    expect(result?.doc.updatedAt).toBe(2_000);
    expect(result?.doc.createdAt).toBe(1_000);
  });

  it('deleteDocument cascades blocks (parent + children gone)', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    await insertBlock(db, 'd1', { id: 'b1', kind: 'paragraph', text: 'a', position: 1000 });
    await insertBlock(db, 'd1', { id: 'b2', kind: 'paragraph', text: 'b', position: 2000 });
    expect(db.blocks.filter((b) => b.document_id === 'd1')).toHaveLength(2);
    await deleteDocument(db, 'd1');
    const after = await getDocumentWithBlocks(db, 'd1');
    expect(after).toBeNull();
    expect(db.blocks.filter((b) => b.document_id === 'd1')).toHaveLength(0);
  });
});

describe('documentRepo — blocks CRUD', () => {
  it('insertBlock auto-positions at max(position) + 1024 when none given', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    const a = await insertBlock(db, 'd1', { kind: 'paragraph', text: 'a' });
    const b = await insertBlock(db, 'd1', { kind: 'paragraph', text: 'b' });
    const c = await insertBlock(db, 'd1', { kind: 'paragraph', text: 'c' });
    expect(a.position).toBe(1024);
    expect(b.position).toBe(2048);
    expect(c.position).toBe(3072);
  });

  it('insertBlock + getDocumentWithBlocks round-trips meta as a typed object', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    await insertBlock(db, 'd1', {
      id: 'bcode',
      kind: 'code',
      text: 'console.log(1)',
      meta: { language: 'ts' },
      position: 1024,
    });
    const result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.blocks).toHaveLength(1);
    const b = result!.blocks[0];
    expect(b.kind).toBe('code');
    expect(b.text).toBe('console.log(1)');
    expect(b.meta).toEqual({ language: 'ts' });
  });

  it('updateBlock supports partial patches: text only, meta only, position only', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    await insertBlock(db, 'd1', {
      id: 'b1', kind: 'paragraph', text: 'orig', position: 1024,
      meta: { hint: 'first' },
    });

    // text only
    await updateBlock(db, 'b1', { text: 'patched' });
    let result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.blocks[0].text).toBe('patched');
    expect(result?.blocks[0].meta).toEqual({ hint: 'first' });
    expect(result?.blocks[0].position).toBe(1024);

    // meta only
    await updateBlock(db, 'b1', { meta: { hint: 'second' } });
    result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.blocks[0].text).toBe('patched');
    expect(result?.blocks[0].meta).toEqual({ hint: 'second' });
    expect(result?.blocks[0].position).toBe(1024);

    // position only
    await updateBlock(db, 'b1', { position: 4096 });
    result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.blocks[0].text).toBe('patched');
    expect(result?.blocks[0].position).toBe(4096);
  });

  it('updateBlock with kind change converts a paragraph → heading-1', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    await insertBlock(db, 'd1', {
      id: 'b1', kind: 'paragraph', text: 'Heading text', position: 1024,
    });
    await updateBlock(db, 'b1', { kind: 'heading-1' });
    const result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.blocks[0].kind).toBe('heading-1');
    expect(result?.blocks[0].text).toBe('Heading text');
  });

  it('deleteBlock removes only the named block, leaves siblings intact', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    await insertBlock(db, 'd1', { id: 'b1', kind: 'paragraph', text: 'a', position: 1024 });
    await insertBlock(db, 'd1', { id: 'b2', kind: 'paragraph', text: 'b', position: 2048 });
    await insertBlock(db, 'd1', { id: 'b3', kind: 'paragraph', text: 'c', position: 3072 });
    await deleteBlock(db, 'b2');
    const result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.blocks.map((b) => b.id)).toEqual(['b1', 'b3']);
  });

  it('moveBlocks bulk reorders positions atomically', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    await insertBlock(db, 'd1', { id: 'b1', kind: 'paragraph', text: 'a', position: 1024 });
    await insertBlock(db, 'd1', { id: 'b2', kind: 'paragraph', text: 'b', position: 2048 });
    await insertBlock(db, 'd1', { id: 'b3', kind: 'paragraph', text: 'c', position: 3072 });

    // Reverse the order: b3 → 100, b2 → 200, b1 → 300
    await moveBlocks(db, 'd1', [
      { id: 'b3', position: 100 },
      { id: 'b2', position: 200 },
      { id: 'b1', position: 300 },
    ]);
    const result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.blocks.map((b) => b.id)).toEqual(['b3', 'b2', 'b1']);
    expect(result?.blocks.map((b) => b.position)).toEqual([100, 200, 300]);
  });

  it('moveBlocks with empty mappings is a no-op', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    await insertBlock(db, 'd1', { id: 'b1', kind: 'paragraph', text: 'a', position: 1024 });
    const before = JSON.stringify(db.blocks);
    await moveBlocks(db, 'd1', []);
    expect(JSON.stringify(db.blocks)).toBe(before);
  });

  it('insertBlock with malformed meta survives via {} fallback on read', async () => {
    const db = new MemoryAppDb();
    await createDocument(db, { id: 'd1', now: 100 });
    // Manually inject a row with bad meta_json — simulates a hand-edited
    // DB row or a future-tense meta shape we don't recognise.
    db.blocks.push({
      id: 'bad',
      document_id: 'd1',
      kind: 'paragraph',
      text: 'fine',
      meta_json: 'this is not json',
      position: 1024,
    });
    const result = await getDocumentWithBlocks(db, 'd1');
    expect(result?.blocks).toHaveLength(1);
    expect(result?.blocks[0].meta).toEqual({});
    expect(result?.blocks[0].text).toBe('fine');
  });
});
