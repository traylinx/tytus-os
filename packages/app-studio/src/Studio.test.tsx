/**
 * @tytus/app-studio — Studio smoke tests.
 *
 * Mounts the lifted multi-block document editor against an in-memory
 * AppDb fake and pins the M6.2 lift's three end-to-end behaviours:
 *
 *   1. Empty state: zero documents in storage → the left pane shows
 *      the "+ New document" affordance + the "No documents yet" hint
 *      + the empty right pane.
 *   2. Hydrate: one seeded document with one paragraph block round-trips
 *      through the loader and renders the block's text.
 *   3. Insert: clicking "+ New block" calls `db.run` with an
 *      `INSERT INTO app_studio_blocks` SQL — verifies the auto-save
 *      path actually reaches the repo.
 *   4. Shell-menu: registers exactly one ⌘K group with three items
 *      (rewrite / continue / outline) — the M6.2 stubs.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type {
  AppBootEnv,
  AppDb,
  HostClient,
  RunResult,
  ShellMenuSpec,
} from '@tytus/host-api';
import bootStudio from './index';

// ── Fakes ────────────────────────────────────────────────────────────

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
  /** Spy so tests can assert on writes without bracketing the SQL. */
  runLog: Array<{ sql: string; args: readonly unknown[] }> = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    this.runLog.push({ sql, args });

    if (/INSERT\s+INTO\s+app_studio_documents/i.test(sql)) {
      const [id, title, created_at, updated_at] = args as [
        string, string, number, number,
      ];
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
      this.documents = this.documents.filter((d) => d.id !== id);
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/INSERT\s+INTO\s+app_studio_blocks/i.test(sql)) {
      const [id, document_id, kind, text, meta_json, position] = args as [
        string, string, string, string, string, number,
      ];
      this.blocks.push({ id, document_id, kind, text, meta_json, position });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/^UPDATE\s+app_studio_blocks\s+SET/i.test(sql.trim())) {
      const reorder = /WHERE\s+id\s*=\s*\?\s+AND\s+document_id\s*=\s*\?/i.test(
        sql,
      );
      let id: string;
      let setArgs: readonly unknown[];
      if (reorder) {
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
      this.blocks = this.blocks.filter((b) => b.document_id !== docId);
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/DELETE\s+FROM\s+app_studio_blocks\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      this.blocks = this.blocks.filter((b) => b.id !== id);
      return { lastInsertRowid: 0, changes: 1 };
    }
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    if (/MAX\(position\)\s+AS\s+max_pos/i.test(sql)) {
      const [docId] = args as [string];
      const positions = this.blocks
        .filter((b) => b.document_id === docId)
        .map((b) => b.position);
      const max_pos = positions.length === 0 ? null : Math.max(...positions);
      return [{ max_pos }] as unknown as T[];
    }
    if (/SELECT\s+document_id\s+FROM\s+app_studio_blocks\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const block = this.blocks.find((b) => b.id === id);
      return (block ? [{ document_id: block.document_id }] : []) as unknown as T[];
    }
    if (/FROM\s+app_studio_blocks\s+WHERE\s+document_id/i.test(sql)) {
      const [docId] = args as [string];
      const rows = this.blocks
        .filter((b) => b.document_id === docId)
        .sort((a, b) => a.position - b.position);
      return rows as unknown as T[];
    }
    if (/FROM\s+app_studio_documents\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const doc = this.documents.find((d) => d.id === id);
      return (doc ? [doc] : []) as unknown as T[];
    }
    if (/FROM\s+app_studio_documents\s+ORDER\s+BY\s+updated_at\s+DESC/i.test(sql)) {
      const sorted = [...this.documents].sort(
        (a, b) => b.updated_at - a.updated_at,
      );
      return sorted as unknown as T[];
    }
    return [];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_studio_documents', 'app_studio_blocks', 'app_studio_ai_usage'];
  }
}

function makeFakeHost(opts: {
  db: AppDb;
  registerSpy?: (spec: ShellMenuSpec) => void;
  notifySpy?: () => void;
}): HostClient {
  const explode = (label: string) => () => {
    throw new Error(`fake host: ${label} not implemented`);
  };
  const proxy = new Proxy(
    {} as Record<string, unknown>,
    { get: (_t, prop: string) => explode(prop) },
  );
  return {
    appId: 'studio',
    fs: proxy as unknown as HostClient['fs'],
    daemon: proxy as unknown as HostClient['daemon'],
    windows: {
      current: { id: 'win-test', appId: 'studio' },
      open: () => 'open',
      openOrFocus: () => 'open',
      close: () => {},
      addDesktopIcon: () => {},
    },
    notifications: { notify: () => opts.notifySpy?.() },
    shellMenu: {
      register: (spec) => {
        opts.registerSpy?.(spec);
        return () => {};
      },
    },
    i18n: {
      locale: 'en',
      t: (k: string) => k,
      onLocaleChange: () => () => {},
    },
    storage: {
      current: () => opts.db,
      forApp: () => { throw new Error('not used'); },
      forSharedKey: () => null,
    },
    events: proxy as unknown as HostClient['events'],
    media: proxy as unknown as HostClient['media'],
    assets: proxy as unknown as HostClient['assets'],
  };
}

function makeBootEnv(opts: {
  db: AppDb;
  registerSpy?: (spec: ShellMenuSpec) => void;
  notifySpy?: () => void;
}): AppBootEnv {
  return {
    host: makeFakeHost(opts),
    createSession: undefined as unknown as AppBootEnv['createSession'],
  };
}

async function flushAsync() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('bootStudio (M6.2 lift)', () => {
  it('mounts with an empty db: shows the empty list + "+ New document" affordance', async () => {
    const db = new MemoryAppDb();
    const env = makeBootEnv({ db });
    const App = bootStudio(env);

    render(<App />);
    await flushAsync();

    // The "+ New document" button is in the left pane header.
    expect(screen.getByText('New document')).toBeTruthy();
    // Empty hint surfaces when no docs are seeded.
    expect(screen.getByText(/No documents yet/i)).toBeTruthy();
    // No docs in storage either way.
    expect(db.documents).toHaveLength(0);
  });

  it('hydrates a seeded document + paragraph block end-to-end', async () => {
    const db = new MemoryAppDb();
    db.documents.push({
      id: 'd_seed',
      title: 'Seeded doc',
      created_at: 100,
      updated_at: 100,
    });
    db.blocks.push({
      id: 'b_seed',
      document_id: 'd_seed',
      kind: 'paragraph',
      text: 'hello world',
      meta_json: '{}',
      position: 1024,
    });

    const env = makeBootEnv({ db });
    const App = bootStudio(env);

    render(<App />);
    await flushAsync();

    // Left pane lists the seeded doc by title.
    expect(screen.getByText('Seeded doc')).toBeTruthy();

    // Click the doc to open it. The first-block summary lives in the
    // list, but we want to assert the title input AND the paragraph
    // body show in the right pane.
    fireEvent.click(screen.getByText('Seeded doc'));
    await flushAsync();

    // Title input renders the seeded title.
    const titleInput = screen.getByLabelText('Document title') as HTMLInputElement;
    expect(titleInput.value).toBe('Seeded doc');

    // Paragraph body renders the seeded text.
    expect(screen.getByDisplayValue('hello world')).toBeTruthy();
  });

  it('clicking "+ New block" issues an INSERT INTO app_studio_blocks', async () => {
    const db = new MemoryAppDb();
    db.documents.push({
      id: 'd_seed',
      title: 'Seeded doc',
      created_at: 100,
      updated_at: 100,
    });
    db.blocks.push({
      id: 'b_seed',
      document_id: 'd_seed',
      kind: 'paragraph',
      text: 'first',
      meta_json: '{}',
      position: 1024,
    });

    const env = makeBootEnv({ db });
    const App = bootStudio(env);

    render(<App />);
    await flushAsync();

    fireEvent.click(screen.getByText('Seeded doc'));
    await flushAsync();

    // Snapshot the run log size BEFORE the click so we count only the
    // new INSERTs. (Hydration may issue a few writes — we don't care.)
    const before = db.runLog.length;

    // The "+ New block" button is at the bottom of the doc.
    fireEvent.click(screen.getByText('New block'));
    await flushAsync();

    const after = db.runLog.slice(before);
    const blockInserts = after.filter((entry) =>
      /INSERT\s+INTO\s+app_studio_blocks/i.test(entry.sql),
    );
    expect(blockInserts.length).toBeGreaterThanOrEqual(1);
    // And the in-memory block array reflects the insert.
    const blocksForDoc = db.blocks.filter((b) => b.document_id === 'd_seed');
    expect(blocksForDoc.length).toBe(2);
  });

  it('registers the ⌘K composition stubs (rewrite + continue + outline)', async () => {
    const db = new MemoryAppDb();
    const registerSpy = vi.fn();
    const env = makeBootEnv({ db, registerSpy });
    const App = bootStudio(env);

    render(<App />);
    await flushAsync();

    expect(registerSpy).toHaveBeenCalledTimes(1);
    const spec = registerSpy.mock.calls[0][0] as ShellMenuSpec;
    expect(spec.appId).toBe('studio');

    const allItems = spec.groups.flatMap((g) => g.items);
    const ids = allItems.map((it) => it.id);
    expect(ids).toContain('studio.rewrite-selection');
    expect(ids).toContain('studio.continue');
    expect(ids).toContain('studio.outline');

    const rewrite = allItems.find((it) => it.id === 'studio.rewrite-selection');
    expect(rewrite?.label).toBe('Rewrite selection');
    expect(rewrite?.shortcut).toBe('⌘K');
  });
});
