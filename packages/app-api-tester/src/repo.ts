// API Tester — per-app SQLite repo. Backed by the AppDb handle returned
// from `host.storage.current()` and migrated by the shell at boot via
// `db.migrate('migrations/')`. Tables live under the `app_api_tester_*`
// prefix to satisfy the engine's per-app prefix guard.
//
// Lifted from the pre-extraction `app/src/lib/repo/{apiCollections,
// apiHistory}.ts` modules and rebound to AppDb. Same row shape, same
// CASCADE behaviour, same trim-to-cap pattern for history.

import type { AppDb } from '@tytus/host-api';

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

export interface HistoryRow {
  id: string;
  method: string;
  url: string;
  status: number;
  duration_ms: number;
  ts: number;
}

export const HISTORY_CAP = 50;

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

const safeHeaders = (raw: string): HeaderRow[] => {
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

// ─── collections ───────────────────────────────────────────────────

export async function listCollections(db: AppDb): Promise<CollectionRow[]> {
  const cols = await db.query<{ id: string; name: string; pos: number }>(
    'SELECT id, name, pos FROM app_api_tester_collections ORDER BY pos ASC, name ASC',
  );
  if (cols.length === 0) return [];
  const items = await db.query<RawItem>(
    `SELECT id, collection_id, name, method, url, headers_json, body, pos
     FROM app_api_tester_collection_items ORDER BY collection_id, pos ASC`,
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
      headers: safeHeaders(i.headers_json),
      body: i.body,
      pos: i.pos,
    });
    byColl.set(i.collection_id, arr);
  }
  return cols.map((c) => ({ ...c, items: byColl.get(c.id) ?? [] }));
}

export async function upsertCollection(
  db: AppDb,
  c: { id: string; name: string; pos?: number },
): Promise<void> {
  await db.run(
    `INSERT INTO app_api_tester_collections (id, name, pos) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, pos = excluded.pos`,
    [c.id, c.name, c.pos ?? 0],
  );
}

export async function deleteCollection(db: AppDb, id: string): Promise<void> {
  await db.run('DELETE FROM app_api_tester_collections WHERE id = ?', [id]);
}

export async function upsertItem(
  db: AppDb,
  item: Omit<CollectionItemRow, 'pos'> & { pos?: number },
): Promise<void> {
  await db.run(
    `INSERT INTO app_api_tester_collection_items
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
}

export async function deleteItem(db: AppDb, id: string): Promise<void> {
  await db.run('DELETE FROM app_api_tester_collection_items WHERE id = ?', [id]);
}

export async function renameCollection(
  db: AppDb,
  id: string,
  name: string,
): Promise<void> {
  await db.run('UPDATE app_api_tester_collections SET name = ? WHERE id = ?', [name, id]);
}

export async function renameItem(db: AppDb, id: string, name: string): Promise<void> {
  await db.run('UPDATE app_api_tester_collection_items SET name = ? WHERE id = ?', [name, id]);
}

// ─── history ───────────────────────────────────────────────────────

export async function listHistory(db: AppDb): Promise<HistoryRow[]> {
  return db.query<HistoryRow>(
    `SELECT id, method, url, status, duration_ms, ts
     FROM app_api_tester_history ORDER BY ts DESC LIMIT ${HISTORY_CAP}`,
  );
}

export async function addHistory(db: AppDb, row: HistoryRow): Promise<void> {
  // No db.tx surface on AppDb — issue the INSERT and the cap-trim back-to-back.
  // The trim is a single statement so it's atomic enough for the UI invariant
  // (newest 50 visible). A failed second statement just leaves a slightly
  // longer history until the next addHistory cleans it up.
  await db.run(
    `INSERT OR REPLACE INTO app_api_tester_history
      (id, method, url, status, duration_ms, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.id, row.method, row.url, row.status, row.duration_ms, row.ts],
  );
  await db.run(
    `DELETE FROM app_api_tester_history
      WHERE id NOT IN (
        SELECT id FROM app_api_tester_history ORDER BY ts DESC LIMIT ${HISTORY_CAP}
      )`,
  );
}

export async function clearHistory(db: AppDb): Promise<void> {
  await db.run('DELETE FROM app_api_tester_history');
}
