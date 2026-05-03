// Memo — link resolver tests. Exercise parseLinks (pure), resolveTarget
// (slug lookup), and upsertLinks (parse + reconcile) against an
// in-memory AppDb fake.

import { describe, it, expect } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  parseLinks,
  resolveTarget,
  slugifyTarget,
  upsertLinks,
} from './linkResolver';

interface MemoStored {
  id: string;
  slug: string;
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
    // ---- INSERT OR REPLACE INTO app_memo_links ------------------
    if (/INSERT\s+OR\s+REPLACE\s+INTO\s+app_memo_links/i.test(sql)) {
      const [source_id, position, target_name, target_id, created_at] =
        args as [string, number, string, string | null, number];
      const idx = this.links.findIndex(
        (l) => l.source_id === source_id && l.position === position,
      );
      const row: LinkStored = {
        source_id,
        position,
        target_name,
        target_id,
        created_at,
      };
      if (idx >= 0) this.links[idx] = row;
      else this.links.push(row);
      return { lastInsertRowid: 0, changes: 1 };
    }

    // ---- DELETE FROM app_memo_links WHERE source_id = ? AND position NOT IN (...) ----
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

    // ---- DELETE FROM app_memo_links WHERE source_id = ? ----------
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
    // ---- SELECT id FROM app_memo_memos WHERE slug = ? ------------
    if (/SELECT\s+id\s+FROM\s+app_memo_memos\s+WHERE\s+slug/i.test(sql)) {
      const [slug] = args as [string];
      const m = this.memos.find((mm) => mm.slug === slug);
      return m ? ([{ id: m.id }] as unknown as T[]) : ([] as T[]);
    }
    return [] as T[];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_memo_memos', 'app_memo_links'];
  }
}

describe('linkResolver — parseLinks', () => {
  it('extracts two links with correct positions', () => {
    const body = '[[A]] some text [[B]]';
    const out = parseLinks(body);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ position: 0, targetName: 'A' });
    // `[[B]]` starts at index 16 — `[[A]] some text ` is 16 chars.
    expect(out[1]).toEqual({ position: 16, targetName: 'B' });
  });

  it('handles dash-separated and space-bearing target names', () => {
    const body = 'see [[a-b-c]] and [[Title With Spaces]] thanks';
    const out = parseLinks(body);
    expect(out).toHaveLength(2);
    expect(out[0].targetName).toBe('a-b-c');
    expect(out[1].targetName).toBe('Title With Spaces');
    // Position points at the opening `[`.
    expect(body.slice(out[0].position, out[0].position + 2)).toBe('[[');
    expect(body.slice(out[1].position, out[1].position + 2)).toBe('[[');
  });

  it('returns [] for an empty body', () => {
    expect(parseLinks('')).toEqual([]);
  });

  it('allows the same target name at multiple positions', () => {
    const body = '[[X]] then [[X]] again';
    const out = parseLinks(body);
    expect(out.map((l) => l.targetName)).toEqual(['X', 'X']);
    expect(out[0].position).not.toBe(out[1].position);
  });

  it('skips empty / whitespace-only [[ ]] forms', () => {
    const body = 'noise [[ ]] more [[ok]] tail';
    const out = parseLinks(body);
    expect(out).toHaveLength(1);
    expect(out[0].targetName).toBe('ok');
  });
});

describe('linkResolver — slugifyTarget', () => {
  it('lowercases + dashes spaces', () => {
    expect(slugifyTarget('Title With Spaces')).toBe('title-with-spaces');
  });

  it('passes already-dashed slugs through cleanly', () => {
    expect(slugifyTarget('a-b-c')).toBe('a-b-c');
  });
});

describe('linkResolver — resolveTarget', () => {
  it('returns memo.id for an existing memo', async () => {
    const db = new MemoryAppDb();
    db.memos.push({ id: 'm1', slug: 'hello-world' });
    const id = await resolveTarget(db, 'Hello World');
    expect(id).toBe('m1');
  });

  it('returns null for a non-existent target (forward-ref)', async () => {
    const db = new MemoryAppDb();
    const id = await resolveTarget(db, 'Nope');
    expect(id).toBeNull();
  });
});

describe('linkResolver — upsertLinks', () => {
  it('parses + writes a row per link with resolved target_id', async () => {
    const db = new MemoryAppDb();
    db.memos.push({ id: 'mA', slug: 'a' });
    db.memos.push({ id: 'mB', slug: 'b' });
    await upsertLinks(db, 'src1', '[[A]] xx [[B]]');
    expect(db.links).toHaveLength(2);
    expect(db.links.every((l) => l.source_id === 'src1')).toBe(true);
    const byName = new Map(db.links.map((l) => [l.target_name, l]));
    expect(byName.get('A')?.target_id).toBe('mA');
    expect(byName.get('B')?.target_id).toBe('mB');
  });

  it('is idempotent — running twice on the same body yields the same rows', async () => {
    const db = new MemoryAppDb();
    db.memos.push({ id: 'mA', slug: 'a' });
    const body = '[[A]] noise [[A]]';
    await upsertLinks(db, 'src1', body);
    const first = JSON.stringify(
      db.links.map((l) => ({ p: l.position, t: l.target_name })).sort(
        (a, b) => a.p - b.p,
      ),
    );
    await upsertLinks(db, 'src1', body);
    const second = JSON.stringify(
      db.links.map((l) => ({ p: l.position, t: l.target_name })).sort(
        (a, b) => a.p - b.p,
      ),
    );
    expect(second).toBe(first);
    expect(db.links).toHaveLength(2);
  });

  it('removes orphan rows when a link disappears from the body', async () => {
    const db = new MemoryAppDb();
    db.memos.push({ id: 'mA', slug: 'a' });
    db.memos.push({ id: 'mB', slug: 'b' });
    await upsertLinks(db, 'src1', '[[A]] noise [[B]]');
    expect(db.links).toHaveLength(2);
    // Drop the [[B]] link.
    await upsertLinks(db, 'src1', '[[A]] noise');
    expect(db.links).toHaveLength(1);
    expect(db.links[0].target_name).toBe('A');
  });

  it('clears all rows for the source when the body has no links', async () => {
    const db = new MemoryAppDb();
    db.memos.push({ id: 'mA', slug: 'a' });
    await upsertLinks(db, 'src1', '[[A]]');
    expect(db.links).toHaveLength(1);
    await upsertLinks(db, 'src1', 'no links here');
    expect(db.links).toHaveLength(0);
  });

  it('records forward-refs with target_id = null', async () => {
    const db = new MemoryAppDb();
    // Note: no matching memo for "ghost".
    await upsertLinks(db, 'src1', 'see [[ghost]]');
    expect(db.links).toHaveLength(1);
    expect(db.links[0].target_id).toBeNull();
    expect(db.links[0].target_name).toBe('ghost');
  });

  it('only touches rows belonging to the source_id passed in', async () => {
    const db = new MemoryAppDb();
    db.memos.push({ id: 'mA', slug: 'a' });
    // Pre-seed an unrelated row from a DIFFERENT source.
    db.links.push({
      source_id: 'other',
      position: 0,
      target_name: 'A',
      target_id: 'mA',
      created_at: 1,
    });
    await upsertLinks(db, 'src1', '[[A]]');
    // Both rows present: src1's new one + the untouched 'other' row.
    expect(db.links).toHaveLength(2);
    // Now save src1 with NO links — the 'other' row must survive.
    await upsertLinks(db, 'src1', 'nothing here');
    expect(db.links).toHaveLength(1);
    expect(db.links[0].source_id).toBe('other');
  });
});
