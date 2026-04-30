// One-shot importer: copies pre-SQLite localStorage state into the
// new tables. Idempotent — guarded by a row in `migration_flags` so
// it runs at most once per browser. Safe to call on every API Tester
// mount; cheap exit on the SELECT.

import { getDb } from '@/lib/db';
import type { HistoryRow } from './apiHistory';
import { addHistory } from './apiHistory';
import type { HeaderRow } from './apiCollections';
import { upsertCollection, upsertItem } from './apiCollections';

const FLAG = 'apiTester_v1_localStorage_import';
const LEGACY_HISTORY_KEY = 'tytus_api_tester_history';
const LEGACY_COLLECTIONS_KEY = 'tytus_api_tester_collections';

interface LegacyHistoryRow {
  id: string;
  method: string;
  url: string;
  status: number;
  time: number;       // legacy field name; renamed to duration_ms in DB
  timestamp: number;
}

interface LegacyCollectionItem {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: HeaderRow[];
  body: string;
}
interface LegacyCollection {
  id: string;
  name: string;
  items: LegacyCollectionItem[];
}

const isLegacyHistory = (v: unknown): v is LegacyHistoryRow =>
  !!v && typeof v === 'object' &&
  typeof (v as LegacyHistoryRow).id === 'string' &&
  typeof (v as LegacyHistoryRow).method === 'string' &&
  typeof (v as LegacyHistoryRow).url === 'string' &&
  typeof (v as LegacyHistoryRow).status === 'number' &&
  typeof (v as LegacyHistoryRow).time === 'number' &&
  typeof (v as LegacyHistoryRow).timestamp === 'number';

const isLegacyCollection = (v: unknown): v is LegacyCollection =>
  !!v && typeof v === 'object' &&
  typeof (v as LegacyCollection).id === 'string' &&
  typeof (v as LegacyCollection).name === 'string' &&
  Array.isArray((v as LegacyCollection).items);

export const importLegacyApiTesterIfNeeded = async (): Promise<void> => {
  const db = getDb();
  if (!db) return;

  // Quick exit if we've already run.
  const existing = await db.query<{ key: string }>(
    'SELECT key FROM migration_flags WHERE key = ?',
    [FLAG],
  );
  if (existing.length > 0) return;

  let importedHistory = 0;
  let importedItems = 0;

  try {
    const rawH = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (rawH) {
      const parsed: unknown = JSON.parse(rawH);
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (!isLegacyHistory(r)) continue;
          const row: HistoryRow = {
            id: r.id,
            method: r.method,
            url: r.url,
            status: r.status,
            duration_ms: r.time,
            ts: r.timestamp,
          };
          await addHistory(row);
          importedHistory += 1;
        }
      }
    }
  } catch {
    // ignore — bad JSON shouldn't block migration of collections
  }

  try {
    const rawC = localStorage.getItem(LEGACY_COLLECTIONS_KEY);
    if (rawC) {
      const parsed: unknown = JSON.parse(rawC);
      if (Array.isArray(parsed)) {
        let pos = 0;
        for (const c of parsed) {
          if (!isLegacyCollection(c)) continue;
          await upsertCollection({ id: c.id, name: c.name, pos: pos++ });
          let ipos = 0;
          for (const it of c.items) {
            await upsertItem({
              id: it.id,
              collection_id: c.id,
              name: it.name,
              method: it.method,
              url: it.url,
              headers: Array.isArray(it.headers) ? it.headers : [],
              body: typeof it.body === 'string' ? it.body : '',
              pos: ipos++,
            });
            importedItems += 1;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  await db.run(
    'INSERT OR REPLACE INTO migration_flags (key, ts) VALUES (?, ?)',
    [FLAG, Date.now()],
  );
  if (importedHistory + importedItems > 0) {
    console.info(
      `[tytusos] migrated ${importedHistory} history rows + ${importedItems} collection items from localStorage`,
    );
  }
};
