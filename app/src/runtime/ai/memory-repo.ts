import type { Db, SqlValue } from '@/lib/db/types';
import type { AiMemoryHit, AiMemoryRow, AiWriteMemoryInput, Clock } from './types';
import { mapMemoryHit } from './types';

const toFtsQuery = (query: string): string => query
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .map((term) => `"${term.replace(/"/g, '""')}"`)
  .join(' ');

export const writeMemoryRow = async (
  db: Db,
  clock: Clock,
  appId: string,
  input: AiWriteMemoryInput,
): Promise<AiMemoryHit> => {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new Error('host.ai.writeMemory: title is empty');
  if (!body) throw new Error('host.ai.writeMemory: body is empty');

  const ts = clock.now();
  const id = clock.id('mem');
  const metadata = JSON.stringify(input.metadata ?? {});
  await db.run(
    `INSERT INTO ai_memories
      (id, owner_key, app_id, title, body, metadata_json, created_at, updated_at)
     VALUES (?, 'local', ?, ?, ?, ?, ?, ?)`,
    [id, appId, title, body, metadata, ts, ts],
  );
  await db.run(
    `INSERT INTO ai_memories_fts (id, app_id, title, body)
     VALUES (?, ?, ?, ?)`,
    [id, appId, title, body],
  );
  return {
    id,
    appId,
    title,
    body,
    score: 0,
    createdAt: ts,
    updatedAt: ts,
  };
};

export const searchMemoryRows = async (
  db: Db,
  appId: string,
  query: string,
  limit = 8,
): Promise<AiMemoryHit[]> => {
  const needle = toFtsQuery(query);
  if (!needle) return [];
  try {
    const rows = await db.query<AiMemoryRow & { score: number }>(
      `SELECT m.id, m.app_id, m.title, m.body, bm25(ai_memories_fts) AS score, m.created_at, m.updated_at
         FROM ai_memories_fts f
         JOIN ai_memories m ON m.id = f.id
        WHERE ai_memories_fts MATCH ? AND m.app_id = ?
        ORDER BY score ASC
        LIMIT ?`,
      [needle, appId, limit],
    );
    return rows.map(mapMemoryHit);
  } catch {
    return [];
  }
};

export const recordOutboxRow = async (
  db: Db,
  clock: Clock,
  input: {
    appId: string;
    threadId: string;
    payload: Record<string, unknown>;
    error?: string | null;
  },
): Promise<string> => {
  const ts = clock.now();
  const id = clock.id('out');
  await db.run(
    `INSERT INTO ai_outbox
      (id, app_id, thread_id, payload_json, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      id,
      input.appId,
      input.threadId,
      JSON.stringify(input.payload),
      input.error ?? null,
      ts,
      ts,
    ] satisfies SqlValue[],
  );
  return id;
};
