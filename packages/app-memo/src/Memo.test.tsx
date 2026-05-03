/**
 * @tytus/app-memo — Memo Brain-bridge wiring smoke test.
 *
 * Mounts <Memo /> against a MemoryAppDb seeded with one memo and a
 * stub BrainBridge. Asserts:
 *
 *   1. Saving a memo whose `mirror_to_brain=true` calls
 *      `brain.appendMemo(slug, title, body)` exactly once.
 *   2. Saving a memo whose `mirror_to_brain=false` does NOT call the
 *      bridge.
 *
 * The DB fake is the same shape as memoRepo.test.ts (we re-implement
 * the minimum needed here rather than export it — the surface area is
 * tiny and the export would couple the tests).
 */

import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import type {
  AppDb,
  HostClient,
  NotifyOpts,
  RunResult,
} from '@tytus/host-api';
import { Memo } from './Memo';
import type { BrainBridge } from './lib/brainBridge';

// ── DB fake ──────────────────────────────────────────────────────────

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

class MemoryAppDb implements AppDb {
  memos: MemoStored[] = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    if (/^UPDATE\s+app_memo_memos\s+SET\s/i.test(sql.trim())) {
      const id = args[args.length - 1] as string;
      const m = this.memos.find((mm) => mm.id === id);
      if (!m) return { lastInsertRowid: 0, changes: 0 };
      const setClause = sql.match(/SET\s+(.+)\s+WHERE/i)?.[1] ?? '';
      const cols = setClause
        .split(',')
        .map((s) => s.trim().split('=')[0].trim());
      cols.forEach((col, idx) => {
        const v = args[idx];
        switch (col) {
          case 'slug': m.slug = v as string; break;
          case 'title': m.title = v as string; break;
          case 'body': m.body = v as string; break;
          case 'tags_json': m.tags_json = v as string; break;
          case 'mirror_to_brain': m.mirror_to_brain = v as number; break;
          case 'updated_at': m.updated_at = v as number; break;
        }
      });
      return { lastInsertRowid: 0, changes: 1 };
    }
    // Link table writes are a no-op for this test — we don't assert
    // on them and the resolver is exercised in linkResolver.test.ts.
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    if (/JOIN\s+app_memo_links/i.test(sql)) {
      return [] as T[];
    }
    if (/FROM\s+app_memo_memos\s+WHERE\s+slug/i.test(sql)) {
      const [slug] = args as [string];
      const m = this.memos.find((mm) => mm.slug === slug);
      return (m ? [m] : []) as unknown as T[];
    }
    if (/SELECT\s+id\s+FROM\s+app_memo_memos\s+WHERE\s+slug/i.test(sql)) {
      const [slug] = args as [string];
      const m = this.memos.find((mm) => mm.slug === slug);
      return (m ? [{ id: m.id }] : []) as unknown as T[];
    }
    if (/FROM\s+app_memo_memos\s+WHERE\s+id/i.test(sql)) {
      const [id] = args as [string];
      const m = this.memos.find((mm) => mm.id === id);
      return (m ? [m] : []) as unknown as T[];
    }
    if (/FROM\s+app_memo_memos\s+ORDER\s+BY\s+updated_at\s+DESC/i.test(sql)) {
      const sorted = [...this.memos].sort(
        (a, b) => b.updated_at - a.updated_at,
      );
      return sorted as unknown as T[];
    }
    return [] as T[];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_memo_memos', 'app_memo_links'];
  }
}

// ── Host fake ────────────────────────────────────────────────────────

function makeFakeHost(notifySpy?: (opts: NotifyOpts) => void): HostClient {
  const explode = (label: string) => () => {
    throw new Error(`fake host: ${label} not implemented`);
  };
  const proxy = new Proxy(
    {} as Record<string, unknown>,
    { get: (_t, prop: string) => explode(prop) },
  );
  return {
    appId: 'memo',
    fs: proxy as unknown as HostClient['fs'],
    daemon: proxy as unknown as HostClient['daemon'],
    windows: proxy as unknown as HostClient['windows'],
    notifications: {
      notify: (opts: NotifyOpts) => notifySpy?.(opts),
    },
    shellMenu: proxy as unknown as HostClient['shellMenu'],
    i18n: proxy as unknown as HostClient['i18n'],
    storage: proxy as unknown as HostClient['storage'],
    events: proxy as unknown as HostClient['events'],
    media: proxy as unknown as HostClient['media'],
    assets: proxy as unknown as HostClient['assets'],
  };
}

// ── Bridge stub ──────────────────────────────────────────────────────

function makeBridgeStub() {
  const appendMemo = vi.fn(async (..._args: unknown[]) => {
    void _args;
  });
  const searchBacklinks = vi.fn(async () => []);
  const bridge: BrainBridge = {
    appendMemo: appendMemo as unknown as BrainBridge['appendMemo'],
    searchBacklinks: searchBacklinks as unknown as BrainBridge['searchBacklinks'],
  };
  return { bridge, appendMemo, searchBacklinks };
}

// ── Helpers ──────────────────────────────────────────────────────────

function seedMemo(
  db: MemoryAppDb,
  partial: Partial<MemoStored> & { id: string; slug: string; title: string },
): void {
  db.memos.push({
    body: '',
    tags_json: '[]',
    mirror_to_brain: 0,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...partial,
  });
}

async function flush(): Promise<void> {
  // Two micro-task spins to let the chained awaits in the load-effect
  // and save-handlers resolve.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function selectMemo(
  container: HTMLElement,
  slug: string,
): Promise<void> {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  );
  const target = buttons.find((b) => b.textContent?.includes(slug));
  if (!target) {
    throw new Error(`memo button for slug "${slug}" not in left rail`);
  }
  await act(async () => {
    fireEvent.click(target);
  });
  await flush();
}

async function editBodyAndBlur(
  container: HTMLElement,
  next: string,
): Promise<void> {
  const ta = container.querySelector<HTMLTextAreaElement>('textarea');
  if (!ta) throw new Error('textarea not rendered');
  await act(async () => {
    fireEvent.change(ta, { target: { value: next } });
  });
  await act(async () => {
    fireEvent.blur(ta);
  });
  await flush();
}

// ── Tests ────────────────────────────────────────────────────────────

describe('<Memo /> Brain-bridge wiring', () => {
  it('saving a memo with mirror_to_brain=true calls brain.appendMemo', async () => {
    const db = new MemoryAppDb();
    seedMemo(db, {
      id: 'm_1',
      slug: 'shopping-list',
      title: 'Shopping list',
      body: 'eggs',
      mirror_to_brain: 1,
    });
    const host = makeFakeHost();
    const { bridge, appendMemo } = makeBridgeStub();

    const { container } = render(<Memo db={db} host={host} brain={bridge} />);
    await flush();
    await selectMemo(container, 'shopping-list');
    await editBodyAndBlur(container, 'eggs\nmilk');

    expect(appendMemo).toHaveBeenCalledTimes(1);
    expect(appendMemo).toHaveBeenCalledWith(
      'shopping-list',
      'Shopping list',
      'eggs\nmilk',
    );
  });

  it('saving a memo with mirror_to_brain=false does NOT call brain.appendMemo', async () => {
    const db = new MemoryAppDb();
    seedMemo(db, {
      id: 'm_2',
      slug: 'private-thoughts',
      title: 'Private thoughts',
      body: 'old',
      mirror_to_brain: 0,
    });
    const host = makeFakeHost();
    const { bridge, appendMemo } = makeBridgeStub();

    const { container } = render(<Memo db={db} host={host} brain={bridge} />);
    await flush();
    await selectMemo(container, 'private-thoughts');
    await editBodyAndBlur(container, 'new content');

    expect(appendMemo).not.toHaveBeenCalled();
  });
});
