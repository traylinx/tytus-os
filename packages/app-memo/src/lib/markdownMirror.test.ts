import { describe, expect, it } from 'vitest';
import type { AppDb, HostClient, RunResult } from '@tytus/host-api';
import { importMarkdownMemos, markdownToMemoDraft, memoToMarkdown, mirrorMemoToMarkdown } from './markdownMirror';
import type { MemoRow } from '../repo/memoRepo';

class MemoryFs {
  nodes: Record<string, { id: string; parentId: string | null; name: string; isDirectory: boolean; content?: string; mtimeMs: number }> = {
    'user:documents': { id: 'user:documents', parentId: null, name: 'Documents', isDirectory: true, mtimeMs: 1 },
  };
  next = 0;
  async ensureUserFolder() { return 'user:documents'; }
  async findChildByName(parentId: string, name: string) {
    return Object.values(this.nodes).find((n) => n.parentId === parentId && n.name === name) ?? null;
  }
  async createFolder(parentId: string, name: string) {
    const id = `folder:${++this.next}`;
    this.nodes[id] = { id, parentId, name, isDirectory: true, mtimeMs: Date.now() };
    return id;
  }
  async createFile(parentId: string, name: string, content: string) {
    const id = `file:${++this.next}`;
    this.nodes[id] = { id, parentId, name, isDirectory: false, content, mtimeMs: Date.now() };
    return id;
  }
  async write(id: string, content: string) { this.nodes[id].content = content; }
  async read(id: string) { return this.nodes[id].content ?? ''; }
  async list(parentId: string) { return Object.values(this.nodes).filter((n) => n.parentId === parentId); }
  async rename() {}
  async getNodeById(id: string) { return this.nodes[id] ?? null; }
  getIconForFileName() { return 'FileText'; }
  watch() { return () => {}; }
}

class MemoryDb implements AppDb {
  rows: Array<{ id: string; slug: string; title: string; body: string; tags_json: string; mirror_to_brain: number; created_at: number; updated_at: number }> = [];
  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    if (/INSERT\s+INTO\s+app_memo_memos/i.test(sql)) {
      const [id, slug, title, body, tagsJson, mirror, created, updated] = args as [string, string, string, string, string, number, number, number];
      this.rows.push({ id, slug, title, body, tags_json: tagsJson, mirror_to_brain: mirror, created_at: created, updated_at: updated });
    }
    return { changes: 1, lastInsertRowid: 0 };
  }
  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    if (/WHERE\s+slug/i.test(sql)) {
      const [slug] = args as [string];
      return this.rows.filter((r) => r.slug === slug) as unknown as T[];
    }
    return [] as T[];
  }
  async migrate() {}
  async listOwnedTables() { return []; }
}

function hostWithFs(fs: MemoryFs): HostClient {
  return {
    appId: 'memo',
    fs: fs as unknown as HostClient['fs'],
    notifications: { notify() {} },
  } as unknown as HostClient;
}

describe('Memo Markdown mirror', () => {
  it('serializes and parses memo Markdown', () => {
    const row: MemoRow = {
      id: 'm1', slug: 'hello-world', title: 'Hello World', body: 'body', tags: [], mirrorToBrain: false, createdAt: 1, updatedAt: 2,
    };
    const md = memoToMarkdown(row);
    expect(md).toContain('# Hello World');
    expect(markdownToMemoDraft('hello-world.md', md)).toEqual({
      slug: 'hello-world',
      title: 'Hello World',
      body: 'body',
    });
  });

  it('mirrors a memo to Documents/Tytus/Memo/<slug>.md', async () => {
    const fs = new MemoryFs();
    const host = hostWithFs(fs);
    await mirrorMemoToMarkdown(host, {
      id: 'm1', slug: 'hello-world', title: 'Hello World', body: 'body', tags: [], mirrorToBrain: false, createdAt: 1, updatedAt: 2,
    });
    const file = Object.values(fs.nodes).find((n) => n.name === 'hello-world.md');
    expect(file?.content).toContain('# Hello World');
  });

  it('imports disk Markdown files that are missing from SQLite', async () => {
    const fs = new MemoryFs();
    const host = hostWithFs(fs);
    const docs = await fs.ensureUserFolder();
    const tytus = await fs.createFolder(docs, 'Tytus');
    const memo = await fs.createFolder(tytus, 'Memo');
    await fs.createFile(memo, 'disk-note.md', '# Disk Note\n\nfrom finder');
    const db = new MemoryDb();
    await expect(importMarkdownMemos(db, host)).resolves.toBe(1);
    expect(db.rows[0]).toMatchObject({ slug: 'disk-note', title: 'Disk Note', body: 'from finder' });
  });
});
