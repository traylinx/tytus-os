// API Tester: editable collections. Two-table layout — collections +
// items via FK CASCADE so deleting a collection also wipes its items.

import { getDb } from '@/lib/db';

export interface HeaderRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface CollectionItemRow {
  id: string;
  collection_id: string;
  name: string;
  method: string;
  url: string;
  headers: HeaderRow[];
  body: string;
  pos: number;
}

export interface CollectionRow {
  id: string;
  name: string;
  pos: number;
  items: CollectionItemRow[];
}

interface RawItem {
  id: string;
  collection_id: string;
  name: string;
  method: string;
  url: string;
  headers_json: string;
  body: string;
  pos: number;
}

const safeJson = (raw: string): HeaderRow[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (h): h is HeaderRow =>
        !!h &&
        typeof h === 'object' &&
        typeof (h as HeaderRow).key === 'string' &&
        typeof (h as HeaderRow).value === 'string',
    );
  } catch {
    return [];
  }
};

export const listCollections = async (): Promise<CollectionRow[]> => {
  const db = getDb();
  if (!db) return [];
  const cols = await db.query<{ id: string; name: string; pos: number }>(
    'SELECT id, name, pos FROM api_collections ORDER BY pos ASC, name ASC',
  );
  if (cols.length === 0) return [];
  const items = await db.query<RawItem>(
    `SELECT id, collection_id, name, method, url, headers_json, body, pos
     FROM api_collection_items ORDER BY collection_id, pos ASC`,
  );
  const byColl = new Map<string, CollectionItemRow[]>();
  for (const i of items) {
    const arr = byColl.get(i.collection_id) ?? [];
    arr.push({
      id: i.id,
      collection_id: i.collection_id,
      name: i.name,
      method: i.method,
      url: i.url,
      headers: safeJson(i.headers_json),
      body: i.body,
      pos: i.pos,
    });
    byColl.set(i.collection_id, arr);
  }
  return cols.map((c) => ({ ...c, items: byColl.get(c.id) ?? [] }));
};

export const upsertCollection = async (c: { id: string; name: string; pos?: number }): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run(
    `INSERT INTO api_collections (id, name, pos) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, pos = excluded.pos`,
    [c.id, c.name, c.pos ?? 0],
  );
};

export const deleteCollection = async (id: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  // FK CASCADE on api_collection_items handles the children.
  await db.run('DELETE FROM api_collections WHERE id = ?', [id]);
};

export const upsertItem = async (item: Omit<CollectionItemRow, 'pos'> & { pos?: number }): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run(
    `INSERT INTO api_collection_items
      (id, collection_id, name, method, url, headers_json, body, pos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         collection_id = excluded.collection_id,
         name          = excluded.name,
         method        = excluded.method,
         url           = excluded.url,
         headers_json  = excluded.headers_json,
         body          = excluded.body,
         pos           = excluded.pos`,
    [
      item.id,
      item.collection_id,
      item.name,
      item.method,
      item.url,
      JSON.stringify(item.headers),
      item.body,
      item.pos ?? 0,
    ],
  );
};

export const deleteItem = async (id: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('DELETE FROM api_collection_items WHERE id = ?', [id]);
};

export const renameCollection = async (id: string, name: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('UPDATE api_collections SET name = ? WHERE id = ?', [name, id]);
};

export const renameItem = async (id: string, name: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('UPDATE api_collection_items SET name = ? WHERE id = ?', [name, id]);
};
