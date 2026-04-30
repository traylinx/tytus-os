// API Tester: request history. Persistent table backed by SQLite.
// Cap enforced via DELETE ... WHERE rowid NOT IN (top N by ts).

import { getDb } from '@/lib/db';

export interface HistoryRow {
  id: string;
  method: string;
  url: string;
  status: number;
  duration_ms: number;
  ts: number;
}

export const HISTORY_CAP = 50;

const ORDERED = `SELECT id, method, url, status, duration_ms, ts
                 FROM api_history ORDER BY ts DESC LIMIT ${HISTORY_CAP}`;

export const listHistory = async (): Promise<HistoryRow[]> => {
  const db = getDb();
  if (!db) return [];
  return await db.query<HistoryRow>(ORDERED);
};

export const addHistory = async (row: HistoryRow): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.tx(async () => {
    await db.run(
      `INSERT OR REPLACE INTO api_history
        (id, method, url, status, duration_ms, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.method, row.url, row.status, row.duration_ms, row.ts],
    );
    // Trim to HISTORY_CAP newest. SQLite's row-trim trick: keep ids
    // appearing in the top-N-by-ts subquery.
    await db.run(
      `DELETE FROM api_history
        WHERE id NOT IN (
          SELECT id FROM api_history ORDER BY ts DESC LIMIT ${HISTORY_CAP}
        )`,
    );
  });
};

export const clearHistory = async (): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('DELETE FROM api_history');
};
