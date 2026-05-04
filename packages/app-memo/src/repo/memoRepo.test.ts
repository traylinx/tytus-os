// Memo repo tests — exercise the SQL CRUD + link reconciliation
// against an in-memory AppDb fake. Same shape as the voiceRecordings
// repo test.

import { describe, it, expect } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  listMemos,
  getMemo,
  getMemoBySlug,
  createMemo,
  updateMemo,
  deleteMemo,
  listBacklinks,
  type MemoRow,
} from './memoRepo';

interface MemoStored {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags_json: string;
  mirror_to_brain: number;
  created_at: number;
  updated_at: number;
}

interface LinkStored {
  source_id: string;
  position: number;
  target_name: string;
  target_id: string | null;
  created_at: number;
}

class MemoryAppDb implements AppDb {
  memos: MemoStored[] = [];
  links: LinkStored[] = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    // INSERT INTO app_memo_memos
    if (/INSERT\s+INTO\s+app_memo_memos/i.test(sql)) {
      const [
        id, slug, title, body, tags_json, mirror_to_brain,
        created_at, updated_at,
      ] = args as [string, string, string, string, string, number, number, number];
      // Enforce slug uniqueness like the schema does.
      if (this.memos.some((m) => m.slug === slug)) {
        throw new Error('UNIQUE constraint failed: app_memo_memos.slug');
      }
      this.memos.push({
        id, slug, title, body, tags_json, mirror_to_brain,
        created_at, updated_at,
      });
      return { lastInsertRowid: 0, changes: 1 };
    }
    // UPDATE app_memo_memos SET <fields> WHERE id = ?
    if (/^UPDATE\s+app_memo_memos\s+SET\s/i.test(sql.trim())) {
      // Last arg is the id; preceding args are the SET values in column order.
      const id = args[args.length - 1] as string;
      const m = this.memos.find((mm) => mm.id === id);
      if (!m) return { lastInsertRowid: 0, changes: 0 };
      // Parse the SET clause to map column -> arg index.
      const setClause = sql.match(/SET\s+(.+)\s+WHERE/i)?.[1] ?? '';
      const cols = setClause
        .split(',')
        .map((s) => s.trim().split('=')[0].trim());
      cols.forEach((col, idx) => {
        const v = args[idx];
        switch (col) {
          case 'slug':            m.slug = v as string; break;
          case 'title':           m.title = v as string; break;
          case 'body':            m.body = v as string; break;
          case 'tags_json':       m.tags_json = v as string; break;
          case 'mirror_to_brain': m.mirror_to_brain = v as number; break;
          case 'updated_at':      m.updated_at = v as number; break;
        }
      });
      return { lastInsertRowid: 0, changes: 1 };
    }
    // DELETE FROM app_memo_memos WHERE id = ?
    if (/DELETE\s+FROM\s+app_memo_memos\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const before = this.memos.length;
      this.memos = this.memos.filter((m) => m.id !== id);
      return { lastInsertRowid: 0, changes: before - this.memos.length };
    }

    // ---- Link table operations (mirror linkResolver test fake) ----
    if (/INSERT\s+OR\s+REPLACE\s+INTO\s+app_memo_links/i.test(sql)) {
      const [source_id, position, target_name, target_id, created_at] =
        args as [string, number, string, string | null, number];
      const idx = this.links.findIndex(
        (l) => l.source_id === source_id && l.position === position,
      );
      const row: LinkStored = {
        source_id, position, target_name, target_id, created_at,
      };
      if (idx >= 0) this.links[idx] = row;
      else this.links.push(row);
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (
      /DELETE\s+FROM\s+app_memo_links\s+WHERE\s+source_id\s*=\s*\?\s+AND\s+position\s+NOT\s+IN/i.test(
        sql,
      )
    ) {
      const [sourceId, ...keepArr] = args as [string, ...number[]];
      const keep = new Set(keepArr.map((n) => Number(n)));
      const before = this.links.length;
      this.links = this.links.filter(
        (l) => l.source_id !== sourceId || keep.has(l.position),
      );
      return { lastInsertRowid: 0, changes: before - this.links.length };
    }
    if (
      /DELETE\s+FROM\s+app_memo_links\s+WHERE\s+source_id\s*=\s*\?\s*$/i.test(
        sql.trim(),
      )
    ) {
      const [sourceId] = args as [string];
      const before = this.links.length;
      this.links = this.links.filter((l) => l.source_id !== sourceId);
      return { lastInsertRowid: 0, changes: before - this.links.length };
    }

    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    // listBacklinks JOIN
    if (/JOIN\s+app_memo_links/i.test(sql)) {
      const [targetId] = args as [string];
      const sourceIds = new Set(
        this.links
          .filter((l) => l.target_id === targetId)
          .map((l) => l.source_id),
      );
      const rows = this.memos
        .filter((m) => sourceIds.has(m.id))
        .sort((a, b) => b.updated_at - a.updated_at);
      return rows as unknown as T[];
    }
    // SELECT ... FROM app_memo_memos WHERE slug = ?
    if (/FROM\s+app_memo_memos\s+WHERE\s+slug/i.test(sql)) {
      const [slug] = args as [string];
      const m = this.memos.find((mm) => mm.slug === slug);
      return (m ? [m] : []) as unknown as T[];
    }
    // SELECT id FROM app_memo_memos WHERE slug = ? — used by resolveTarget
    if (/SELECT\s+id\s+FROM\s+app_memo_memos\s+WHERE\s+slug/i.test(sql)) {
      const [slug] = args as [string];
      const m = this.memos.find((mm) => mm.slug === slug);
      return (m ? [{ id: m.id }] : []) as unknown as T[];
    }
    // SELECT ... FROM app_memo_memos WHERE id = ?
    if (/FROM\s+app_memo_memos\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const m = this.memos.find((mm) => mm.id === id);
      return (m ? [m] : []) as unknown as T[];
    }
    // SELECT ... FROM app_memo_memos ORDER BY updated_at DESC [LIMIT ?]
    if (/FROM\s+app_memo_memos\s+ORDER\s+BY\s+updated_at\s+DESC/i.test(sql)) {
      const sorted = [...this.memos].sort(
        (a, b) => b.updated_at - a.updated_at,
      );
      if (/LIMIT\s+\?/i.test(sql) && args.length > 0) {
        const limit = args[0] as number;
        return sorted.slice(0, limit) as unknown as T[];
      }
      return sorted as unknown as T[];
    }
    return [] as T[];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_memo_memos', 'app_memo_links', 'app_memo_ai_usage'];
  }
}

type SampleInput = Partial<{
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  mirrorToBrain: boolean;
  now: number;
}>;

const sample = (
  overrides: SampleInput = {},
): Parameters<typeof createMemo>[1] => ({
  id: overrides.id ?? 'm_1',
  slug: overrides.slug ?? 'first',
  title: overrides.title ?? 'First memo',
  body: overrides.body ?? '',
  tags: overrides.tags ?? [],
  mirrorToBrain: overrides.mirrorToBrain ?? false,
  now: overrides.now ?? 1_700_000_000_000,
});

describe('memoRepo — CRUD', () => {
  it('createMemo + getMemo round-trips the row with parsed tags', async () => {
    const db = new MemoryAppDb();
    const row = await createMemo(db, sample({ tags: ['x', 'y'] }));
    expect(row.id).toBe('m_1');
    expect(row.slug).toBe('first');
    expect(row.tags).toEqual(['x', 'y']);
    expect(row.mirrorToBrain).toBe(false);
    const fetched = await getMemo(db, 'm_1');
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe('First memo');
    expect(fetched!.tags).toEqual(['x', 'y']);
  });

  it('listMemos orders by updated_at DESC', async () => {
    const db = new MemoryAppDb();
    await createMemo(db, sample({ id: 'a', slug: 'a', now: 100 }));
    await createMemo(db, sample({ id: 'b', slug: 'b', now: 300 }));
    await createMemo(db, sample({ id: 'c', slug: 'c', now: 200 }));
    const rows = await listMemos(db);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('listMemos honours an explicit limit', async () => {
    const db = new MemoryAppDb();
    await createMemo(db, sample({ id: 'a', slug: 'a', now: 100 }));
    await createMemo(db, sample({ id: 'b', slug: 'b', now: 300 }));
    await createMemo(db, sample({ id: 'c', slug: 'c', now: 200 }));
    const rows = await listMemos(db, { limit: 2 });
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('getMemoBySlug returns the matching row', async () => {
    const db = new MemoryAppDb();
    await createMemo(db, sample({ slug: 'unique-slug' }));
    const row = await getMemoBySlug(db, 'unique-slug');
    expect(row?.id).toBe('m_1');
    const missing = await getMemoBySlug(db, 'nope');
    expect(missing).toBeNull();
  });

  it('updateMemo patches title + body + mirrorToBrain + bumps updated_at', async () => {
    const db = new MemoryAppDb();
    await createMemo(db, sample({ now: 1_000 }));
    await updateMemo(db, 'm_1', {
      title: 'New title',
      body: 'new body',
      mirrorToBrain: true,
      now: 2_000,
    });
    const after = await getMemo(db, 'm_1');
    expect(after?.title).toBe('New title');
    expect(after?.body).toBe('new body');
    expect(after?.mirrorToBrain).toBe(true);
    expect(after?.updatedAt).toBe(2_000);
    expect(after?.createdAt).toBe(1_000);
  });

  it('updateMemo with body re-runs the link resolver', async () => {
    const db = new MemoryAppDb();
    // Seed a target for [[Other]] to resolve to.
    await createMemo(db, {
      id: 'mO', slug: 'other', title: 'Other', now: 100,
    });
    await createMemo(db, sample({ id: 'm_1', slug: 'first', now: 500 }));
    await updateMemo(db, 'm_1', {
      body: 'see [[Other]]',
      now: 600,
    });
    const linkRows = db.links.filter((l) => l.source_id === 'm_1');
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].target_id).toBe('mO');
    expect(linkRows[0].target_name).toBe('Other');
  });

  it('deleteMemo removes the row AND its outbound links', async () => {
    const db = new MemoryAppDb();
    await createMemo(db, { id: 'mO', slug: 'other', title: 'O', now: 100 });
    await createMemo(db, {
      id: 'm_1', slug: 'first', title: 'First', body: '[[Other]]', now: 200,
    });
    expect(db.links.filter((l) => l.source_id === 'm_1')).toHaveLength(1);
    await deleteMemo(db, 'm_1');
    const after = await getMemo(db, 'm_1');
    expect(after).toBeNull();
    expect(db.links.filter((l) => l.source_id === 'm_1')).toHaveLength(0);
  });

  it('createMemo enforces slug uniqueness', async () => {
    const db = new MemoryAppDb();
    await createMemo(db, sample({ slug: 'shared' }));
    await expect(
      createMemo(db, { id: 'm_2', slug: 'shared', title: 't', now: 1 }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('listBacklinks returns sources whose links resolve to the given target', async () => {
    const db = new MemoryAppDb();
    await createMemo(db, {
      id: 'target', slug: 'target-memo', title: 'Target', now: 100,
    });
    await createMemo(db, {
      id: 'src1', slug: 'src-1', title: 'Src 1',
      body: 'see [[Target Memo]]', now: 200,
    });
    await createMemo(db, {
      id: 'src2', slug: 'src-2', title: 'Src 2',
      body: 'also [[Target Memo]] here', now: 300,
    });
    await createMemo(db, {
      id: 'unrelated', slug: 'unrelated', title: 'U',
      body: 'no link', now: 50,
    });
    const back = await listBacklinks(db, 'target');
    expect(back.map((r) => r.id).sort()).toEqual(['src1', 'src2']);
  });
});
