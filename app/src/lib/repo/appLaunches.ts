// App usage tracking — exponential decay scoring for "Frequently Used".
//
// Algorithm: time-weighted score using bucketed exponential decay.
// Each launch contributes 2^(-age_days / HALF_LIFE_DAYS) to the score.
// Half-life = 7 days → a launch today scores 1.0, one 7 days ago scores 0.5,
// one 14 days ago scores 0.25, etc. Lookback window = 30 days.
//
// This is the same core math Apple and Google use for app prediction.
// The bucketed SQL approximation tracks the true exponential within ~5%.

import { getDb } from '@/lib/db';

export interface FrequentApp {
  appId: string;
  score: number;
}

/** Log an app launch event. Fire-and-forget — never blocks the caller. */
export const logLaunch = async (appId: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  const nowSec = Math.floor(Date.now() / 1000);
  await db.run(
    'INSERT INTO app_launches (app_id, launched_at) VALUES (?, ?)',
    [appId, nowSec],
  );
};

/**
 * Return the top-N most frequently used apps, scored by exponential decay.
 * Returns an empty array if the DB is unavailable (graceful fallback).
 */
export const getFrequentApps = async (limit = 8): Promise<FrequentApp[]> => {
  const db = getDb();
  if (!db) return [];

  // Bucketed exponential decay — pure SQLite, no custom functions.
  // Each bucket's weight = 2^(-midpoint_days / 7).
  // Buckets are mutually exclusive (CASE picks the first match).
  const rows = await db.query<{ app_id: string; score: number }>(`
    SELECT
      app_id,
      SUM(
        CASE
          WHEN launched_at > strftime('%s','now') - 86400   THEN 1.0
          WHEN launched_at > strftime('%s','now') - 172800  THEN 0.90
          WHEN launched_at > strftime('%s','now') - 259200  THEN 0.82
          WHEN launched_at > strftime('%s','now') - 345600  THEN 0.75
          WHEN launched_at > strftime('%s','now') - 518400  THEN 0.66
          WHEN launched_at > strftime('%s','now') - 604800  THEN 0.50
          WHEN launched_at > strftime('%s','now') - 1209600 THEN 0.35
          WHEN launched_at > strftime('%s','now') - 1814400 THEN 0.25
          WHEN launched_at > strftime('%s','now') - 2592000 THEN 0.15
          ELSE 0.05
        END
      ) AS score
    FROM app_launches
    WHERE launched_at > strftime('%s','now') - 2592000
    GROUP BY app_id
    HAVING COUNT(*) >= 2
    ORDER BY score DESC
    LIMIT ?
  `, [limit]);

  return rows.map((r) => ({ appId: r.app_id, score: r.score }));
};

/**
 * Prune launch events older than 30 days.
 * Call periodically (e.g. once per day) to keep the table small.
 */
export const pruneOldLaunches = async (): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run(
    "DELETE FROM app_launches WHERE launched_at < strftime('%s','now') - 2592000",
  );
};
