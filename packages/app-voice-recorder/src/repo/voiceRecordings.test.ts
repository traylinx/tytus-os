// Voice Recorder repo tests — exercise the SQL CRUD against an
// in-memory AppDb fake. Mirrors the seed-bundled-apps memory-db
// pattern (no real SQLite, just a deterministic row store).
//
// Two things this guards:
//   1. Behaviour parity with the in-tree repo (insert/list/update/delete).
//   2. Every SQL string actually targets the per-app prefixed
//      `app_voice_recorder_recordings` table — if a future edit
//      drops the prefix the prefix guard would reject the query at
//      runtime, but here we catch it at test time.

import { describe, it, expect } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  listRecordings,
  insertRecording,
  updateRecordingName,
  deleteRecording,
  type VoiceRecordingRow,
} from './voiceRecordings';

interface SqlCall {
  sql: string;
  args: readonly unknown[];
}

interface StoredRow {
  id: string;
  name: string;
  duration_ms: number;
  created_at: number;
  mime_type: string;
  audio_data_url: string;
}

class MemoryAppDb implements AppDb {
  rows: StoredRow[] = [];
  runCalls: SqlCall[] = [];
  queryCalls: SqlCall[] = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    this.runCalls.push({ sql, args });
    if (/INSERT\s+OR\s+REPLACE\s+INTO\s+app_voice_recorder_recordings/i.test(sql)) {
      const [id, name, duration_ms, created_at, mime_type, audio_data_url] = args as [
        string, string, number, number, string, string,
      ];
      const idx = this.rows.findIndex((r) => r.id === id);
      const row: StoredRow = { id, name, duration_ms, created_at, mime_type, audio_data_url };
      if (idx >= 0) this.rows[idx] = row;
      else this.rows.push(row);
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/UPDATE\s+app_voice_recorder_recordings\s+SET\s+name/i.test(sql)) {
      const [name, id] = args as [string, string];
      const r = this.rows.find((row) => row.id === id);
      if (r) r.name = name;
      return { lastInsertRowid: 0, changes: r ? 1 : 0 };
    }
    if (/DELETE\s+FROM\s+app_voice_recorder_recordings/i.test(sql)) {
      const [id] = args as [string];
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => row.id !== id);
      return { lastInsertRowid: 0, changes: before - this.rows.length };
    }
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    this.queryCalls.push({ sql, args });
    if (/SELECT[\s\S]+FROM\s+app_voice_recorder_recordings/i.test(sql)) {
      // Mimic the ORDER BY created_at DESC clause.
      return [...this.rows]
        .sort((a, b) => b.created_at - a.created_at) as unknown as T[];
    }
    return [];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_voice_recorder_recordings'];
  }
}

const sampleRow = (overrides: Partial<VoiceRecordingRow> = {}): VoiceRecordingRow => ({
  id: 'r_1',
  name: 'Recording 1',
  durationMs: 1234,
  createdAt: 1700000000000,
  mimeType: 'audio/webm',
  audioDataUrl: 'data:audio/webm;base64,xxx',
  ...overrides,
});

describe('voiceRecordings repo', () => {
  it('insertRecording → listRecordings round-trips the row', async () => {
    const db = new MemoryAppDb();
    const rec = sampleRow();
    await insertRecording(db, rec);
    const rows = await listRecordings(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(rec);
  });

  it('listRecordings orders by created_at DESC', async () => {
    const db = new MemoryAppDb();
    await insertRecording(db, sampleRow({ id: 'a', createdAt: 100 }));
    await insertRecording(db, sampleRow({ id: 'b', createdAt: 300 }));
    await insertRecording(db, sampleRow({ id: 'c', createdAt: 200 }));
    const rows = await listRecordings(db);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('deleteRecording removes the row', async () => {
    const db = new MemoryAppDb();
    await insertRecording(db, sampleRow({ id: 'r_1' }));
    await insertRecording(db, sampleRow({ id: 'r_2' }));
    await deleteRecording(db, 'r_1');
    const rows = await listRecordings(db);
    expect(rows.map((r) => r.id)).toEqual(['r_2']);
  });

  it('updateRecordingName updates the name', async () => {
    const db = new MemoryAppDb();
    await insertRecording(db, sampleRow({ id: 'r_1', name: 'old' }));
    await updateRecordingName(db, 'r_1', 'new name');
    const rows = await listRecordings(db);
    expect(rows[0].name).toBe('new name');
  });

  it('every CRUD verb targets the prefixed app_voice_recorder_recordings table', async () => {
    const db = new MemoryAppDb();
    const rec = sampleRow();
    await insertRecording(db, rec);
    await updateRecordingName(db, rec.id, 'renamed');
    await deleteRecording(db, rec.id);
    await listRecordings(db);

    // No SQL string may reference the legacy un-prefixed `voice_recordings`
    // identifier — the host-api prefix guard would reject those queries.
    const allSql = [
      ...db.runCalls.map((c) => c.sql),
      ...db.queryCalls.map((c) => c.sql),
    ];
    for (const sql of allSql) {
      expect(sql).toContain('app_voice_recorder_recordings');
      // Match the legacy identifier as a whole word, not as a prefix-substring.
      expect(sql).not.toMatch(/\bvoice_recordings\b/);
    }
  });
});
