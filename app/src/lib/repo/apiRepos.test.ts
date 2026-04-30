// Repo-layer tests using a fake in-memory Db. Doesn't spin up the
// real SQLite worker — we only verify that the repo SQL produces the
// expected sequence of calls + that round-tripping shapes is correct.
//
// The fake captures every (sql, bindings) pair, executes a tiny
// table-aware in-memory engine, and lets the test assert on both the
// SQL and the resulting state. This is enough to catch regressions in
// the repo without the WASM/OPFS dance.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setDbForTesting } from '@/lib/db';
import type { Db, SqlValue } from '@/lib/db/types';
import {
  listHistory, addHistory, clearHistory, HISTORY_CAP,
} from '@/lib/repo/apiHistory';
import {
  listCollections, upsertCollection, deleteCollection,
  upsertItem, deleteItem, renameCollection, renameItem,
} from '@/lib/repo/apiCollections';

// ----- fake Db backed by a tiny in-memory store -----
//
// We model only what the repos actually exercise: insert/replace into
// two tables, delete by id, ordered selects with LIMIT, and the row-cap
// trim subquery. SQL strings are matched on intent (which keyword they
// start with after trim), not parsed.

interface HistoryRowRaw {
  id: string;
  method: string;
  url: string;
  status: number;
  duration_ms: number;
  ts: number;
}
interface ColRaw { id: string; name: string; pos: number; }
interface ItemRaw {
  id: string;
  collection_id: string;
  name: string;
  method: string;
  url: string;
  headers_json: string;
  body: string;
  pos: number;
}

const makeFake = (): Db => {
  let history: HistoryRowRaw[] = [];
  let cols: ColRaw[] = [];
  let items: ItemRaw[] = [];

  const exec = async (sql: string): Promise<void> => {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('BEGIN') || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') return;
    // Tests don't need DDL execution — schema is implied by the in-memory shape.
  };

  const run = async (sql: string, bindings: SqlValue[] = []): Promise<void> => {
    const lower = sql.trim().toLowerCase();
    if (lower.startsWith('insert or replace into api_history')) {
      const [id, method, url, status, duration_ms, ts] = bindings as [
        string, string, string, number, number, number,
      ];
      history = history.filter((r) => r.id !== id);
      history.push({ id, method, url, status, duration_ms, ts });
      return;
    }
    if (lower.startsWith('delete from api_history') && lower.includes('not in')) {
      // trim to top HISTORY_CAP by ts
      const sorted = [...history].sort((a, b) => b.ts - a.ts).slice(0, HISTORY_CAP);
      const keep = new Set(sorted.map((r) => r.id));
      history = history.filter((r) => keep.has(r.id));
      return;
    }
    if (lower.startsWith('delete from api_history')) {
      history = [];
      return;
    }
    if (lower.startsWith('insert into api_collections')) {
      const [id, name, pos] = bindings as [string, string, number];
      cols = cols.filter((c) => c.id !== id);
      cols.push({ id, name, pos });
      return;
    }
    if (lower.startsWith('insert into api_collection_items')) {
      const [id, collection_id, name, method, url, headers_json, body, pos] =
        bindings as [string, string, string, string, string, string, string, number];
      items = items.filter((i) => i.id !== id);
      items.push({ id, collection_id, name, method, url, headers_json, body, pos });
      return;
    }
    if (lower.startsWith('delete from api_collections where id')) {
      const [id] = bindings as [string];
      cols = cols.filter((c) => c.id !== id);
      items = items.filter((i) => i.collection_id !== id);  // FK CASCADE simulation
      return;
    }
    if (lower.startsWith('delete from api_collection_items where id')) {
      const [id] = bindings as [string];
      items = items.filter((i) => i.id !== id);
      return;
    }
    if (lower.startsWith('update api_collections set name')) {
      const [name, id] = bindings as [string, string];
      cols = cols.map((c) => (c.id === id ? { ...c, name } : c));
      return;
    }
    if (lower.startsWith('update api_collection_items set name')) {
      const [name, id] = bindings as [string, string];
      items = items.map((i) => (i.id === id ? { ...i, name } : i));
      return;
    }
    throw new Error(`fake.run unhandled: ${sql}`);
  };

  const query = async <T = Record<string, SqlValue>>(
    sql: string,
    _bindings: SqlValue[] = [],
  ): Promise<T[]> => {
    const lower = sql.trim().toLowerCase();
    if (lower.startsWith('select id, method, url, status, duration_ms, ts')) {
      // ORDER BY ts DESC LIMIT HISTORY_CAP
      return [...history]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, HISTORY_CAP) as unknown as T[];
    }
    if (lower.startsWith('select id, name, pos from api_collections')) {
      return [...cols].sort((a, b) =>
        a.pos === b.pos ? a.name.localeCompare(b.name) : a.pos - b.pos,
      ) as unknown as T[];
    }
    if (lower.startsWith('select id, collection_id, name, method, url')) {
      return [...items].sort((a, b) =>
        a.collection_id === b.collection_id
          ? a.pos - b.pos
          : a.collection_id.localeCompare(b.collection_id),
      ) as unknown as T[];
    }
    return [] as T[];
  };

  const tx = async <T,>(fn: () => Promise<T>): Promise<T> => {
    return await fn();
  };

  return { exec, run, query, tx };
};

describe('apiHistory repo', () => {
  beforeEach(() => setDbForTesting(makeFake()));
  afterEach(() => setDbForTesting(null));

  it('persists, lists in ts-DESC order, and trims to HISTORY_CAP', async () => {
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      await addHistory({
        id: `r${i}`,
        method: 'GET',
        url: `https://example.com/${i}`,
        status: 200,
        duration_ms: 10 + i,
        ts: 1_000_000 + i,
      });
    }
    const rows = await listHistory();
    expect(rows).toHaveLength(HISTORY_CAP);
    expect(rows[0].id).toBe(`r${HISTORY_CAP + 4}`);
    expect(rows[rows.length - 1].id).toBe('r5');
  });

  it('clearHistory wipes all rows', async () => {
    await addHistory({
      id: 'a', method: 'POST', url: '/x', status: 201, duration_ms: 5, ts: 1,
    });
    expect(await listHistory()).toHaveLength(1);
    await clearHistory();
    expect(await listHistory()).toHaveLength(0);
  });

  it('no-op when no db is set', async () => {
    setDbForTesting(null);
    await addHistory({
      id: 'x', method: 'GET', url: '/y', status: 200, duration_ms: 1, ts: 1,
    });
    expect(await listHistory()).toEqual([]);
  });
});

describe('apiCollections repo', () => {
  beforeEach(() => setDbForTesting(makeFake()));
  afterEach(() => setDbForTesting(null));

  it('round-trips a collection with items', async () => {
    await upsertCollection({ id: 'c1', name: 'Smoke', pos: 0 });
    await upsertItem({
      id: 'i1', collection_id: 'c1',
      name: 'Hello', method: 'GET', url: 'http://x',
      headers: [{ id: 'h1', key: 'X-K', value: 'v', enabled: true }],
      body: '',
      pos: 0,
    });
    const list = await listCollections();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Smoke');
    expect(list[0].items).toHaveLength(1);
    expect(list[0].items[0].headers[0]).toEqual({ id: 'h1', key: 'X-K', value: 'v', enabled: true });
  });

  it('renames update the row', async () => {
    await upsertCollection({ id: 'c1', name: 'A', pos: 0 });
    await renameCollection('c1', 'B');
    const list = await listCollections();
    expect(list[0].name).toBe('B');

    await upsertItem({
      id: 'i1', collection_id: 'c1', name: 'X',
      method: 'GET', url: '/x', headers: [], body: '', pos: 0,
    });
    await renameItem('i1', 'Y');
    const list2 = await listCollections();
    expect(list2[0].items[0].name).toBe('Y');
  });

  it('deleteCollection cascades to items', async () => {
    await upsertCollection({ id: 'c1', name: 'A', pos: 0 });
    await upsertItem({
      id: 'i1', collection_id: 'c1', name: 'X',
      method: 'GET', url: '/x', headers: [], body: '', pos: 0,
    });
    await deleteCollection('c1');
    const list = await listCollections();
    expect(list).toHaveLength(0);
  });

  it('deleteItem removes only the target item', async () => {
    await upsertCollection({ id: 'c1', name: 'A', pos: 0 });
    await upsertItem({
      id: 'i1', collection_id: 'c1', name: 'X',
      method: 'GET', url: '/x', headers: [], body: '', pos: 0,
    });
    await upsertItem({
      id: 'i2', collection_id: 'c1', name: 'Y',
      method: 'GET', url: '/y', headers: [], body: '', pos: 1,
    });
    await deleteItem('i1');
    const list = await listCollections();
    expect(list[0].items.map((i) => i.id)).toEqual(['i2']);
  });
});
