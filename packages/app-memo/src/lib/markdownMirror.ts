// ============================================================
// Memo — OS-visible Markdown mirror
// ============================================================
// Mirrors app_memo_memos rows to ~/Documents/Tytus/Memo/<slug>.md via
// host.fs. SQLite remains the query/index source; Markdown files make the
// user's notes visible in Finder/Explorer and importable after a browser
// cache reset.

import type { AppDb, FsApi, HostClient } from '@tytus/host-api';
import { createMemo, getMemoBySlug, type MemoRow } from '../repo/memoRepo';
import { slugifyTarget } from '../repo/linkResolver';

const ROOT_FOLDER = 'Tytus';
const MEMO_FOLDER = 'Memo';

function safeMarkdownName(slug: string): string {
  const safe = slugifyTarget(slug).replace(/^-+|-+$/g, '') || 'memo';
  return `${safe}.md`;
}

async function ensureChildFolder(fs: FsApi, parentId: string, name: string): Promise<string> {
  const existing = await fs.findChildByName(parentId, name);
  if (existing?.isDirectory) return existing.id;
  try {
    return await fs.createFolder(parentId, name);
  } catch {
    const after = await fs.findChildByName(parentId, name);
    if (after?.isDirectory) return after.id;
    throw new Error(`Memo Markdown mirror: cannot create ${name}`);
  }
}

export async function ensureMemoMarkdownFolder(host: HostClient): Promise<string> {
  const docs = await host.fs.ensureUserFolder('documents');
  const tytus = await ensureChildFolder(host.fs, docs, ROOT_FOLDER);
  return ensureChildFolder(host.fs, tytus, MEMO_FOLDER);
}

export function memoToMarkdown(row: MemoRow): string {
  const tags = row.tags.length > 0 ? `\nTags: ${row.tags.join(', ')}` : '';
  const body = row.body.trimEnd();
  return [
    `# ${row.title}`,
    '',
    body,
    '',
    '<!-- tytus:memo',
    `id: ${row.id}`,
    `slug: ${row.slug}`,
    `updatedAt: ${row.updatedAt}`,
    `mirrorToBrain: ${row.mirrorToBrain ? 'true' : 'false'}${tags}`,
    '-->',
    '',
  ].join('\n');
}

export function markdownToMemoDraft(name: string, markdown: string): {
  slug: string;
  title: string;
  body: string;
} {
  const withoutMeta = markdown.replace(/\n?<!--\s*tytus:memo[\s\S]*?-->\s*$/m, '').trimEnd();
  const lines = withoutMeta.split('\n');
  const first = lines[0] ?? '';
  const title = first.startsWith('# ') ? first.slice(2).trim() : name.replace(/\.md$/i, '');
  const body = first.startsWith('# ')
    ? lines.slice(1).join('\n').replace(/^\n/, '').trimEnd()
    : withoutMeta;
  const slug = slugifyTarget(name.replace(/\.md$/i, '')) || slugifyTarget(title) || `memo-${Date.now().toString(36)}`;
  return { slug, title: title || slug, body };
}

export async function mirrorMemoToMarkdown(host: HostClient, row: MemoRow): Promise<void> {
  const folder = await ensureMemoMarkdownFolder(host);
  const filename = safeMarkdownName(row.slug);
  const existing = await host.fs.findChildByName(folder, filename);
  const content = memoToMarkdown(row);
  if (existing && !existing.isDirectory) {
    await host.fs.write(existing.id, content);
  } else {
    await host.fs.createFile(folder, filename, content, { mimeType: 'text/markdown' });
  }
}

/** Import Markdown files that exist on disk but not in SQLite yet. */
export async function importMarkdownMemos(db: AppDb, host: HostClient): Promise<number> {
  const folder = await ensureMemoMarkdownFolder(host);
  const rows = await host.fs.list(folder);
  let imported = 0;
  for (const row of rows) {
    if (row.isDirectory || !row.name.toLowerCase().endsWith('.md')) continue;
    const raw = await host.fs.read(row.id);
    if (typeof raw !== 'string') continue;
    const draft = markdownToMemoDraft(row.name, raw);
    const exists = await getMemoBySlug(db, draft.slug);
    if (exists) continue;
    await createMemo(db, {
      slug: draft.slug,
      title: draft.title,
      body: draft.body,
      tags: ['markdown-import'],
      now: row.mtimeMs || Date.now(),
    });
    imported += 1;
  }
  return imported;
}
