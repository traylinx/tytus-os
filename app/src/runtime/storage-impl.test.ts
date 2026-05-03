import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppDb, extractTableNames } from './storage-impl';
import { PermissionDeniedError } from '@tytus/host-api';
import type { Db, SqlValue } from '@/lib/db/types';

class MemoryDb implements Db {
  private tables = new Map<string, Array<Record<string, SqlValue>>>();
  /** Track every executed SQL string for assertions. */
  log: string[] = [];

  async exec(sql: string): Promise<void> {
    this.log.push(sql);
    // CREATE TABLE IF NOT EXISTS "name" (...)  — register an empty
    // table so subsequent listOwnedTables sees it via sqlite_master.
    const m = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-zA-Z_][\w]*)"?/i.exec(sql);
    if (m) {
      if (!this.tables.has(m[1])) this.tables.set(m[1], []);
    }
  }

  async query<T>(sql: string, bindings: SqlValue[] = []): Promise<T[]> {
    this.log.push(sql);
    // Minimal sqlite_master support so listOwnedTables can be tested.
    if (/FROM\s+sqlite_master/i.test(sql)) {
      const likePattern = String(bindings[0] ?? '').toLowerCase();
      const exact = String(bindings[1] ?? '').toLowerCase();
      const escaped = likePattern.replaceAll('\\_', '_');
      const prefix = escaped.endsWith('%') ? escaped.slice(0, -1) : escaped;
      const out: Array<{ name: string }> = [];
      for (const name of this.tables.keys()) {
        const lower = name.toLowerCase();
        if (lower === exact || (prefix && lower.startsWith(prefix))) {
          out.push({ name });
        }
      }
      return out as unknown as T[];
    }
    return [] as T[];
  }

  async run(sql: string, bindings: SqlValue[] = []): Promise<void> {
    void bindings;
    this.log.push(sql);
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

let db: MemoryDb;

beforeEach(() => {
  db = new MemoryDb();
});

afterEach(() => {
  db.log = [];
});

describe('extractTableNames', () => {
  it('finds tables in SELECT FROM / JOIN', () => {
    expect(
      extractTableNames(
        'SELECT * FROM app_sheet_workbooks JOIN app_sheet_cells ON …',
      ).sort(),
    ).toEqual(['app_sheet_cells', 'app_sheet_workbooks']);
  });

  it('finds tables in INSERT INTO / UPDATE / DELETE-ish', () => {
    expect(
      extractTableNames("INSERT INTO app_memo_body (id) VALUES ('x')").sort(),
    ).toEqual(['app_memo_body']);
    expect(
      extractTableNames('UPDATE app_memo_body SET title=?').sort(),
    ).toEqual(['app_memo_body']);
  });

  it('finds tables in CREATE TABLE / DROP TABLE / ALTER TABLE', () => {
    expect(extractTableNames('CREATE TABLE app_memo_body (id TEXT)')).toEqual([
      'app_memo_body',
    ]);
    expect(
      extractTableNames(
        'CREATE TABLE IF NOT EXISTS app_memo_body (id TEXT)',
      ),
    ).toEqual(['app_memo_body']);
    expect(extractTableNames('DROP TABLE app_memo_body')).toEqual([
      'app_memo_body',
    ]);
    expect(extractTableNames('ALTER TABLE app_memo_body ADD COLUMN x TEXT')).toEqual(
      ['app_memo_body'],
    );
  });

  it('strips block + line comments before scanning', () => {
    expect(
      extractTableNames(
        '/* FROM other_app_secret */ SELECT 1; -- FROM another_secret\nSELECT * FROM app_sheet_ok',
      ),
    ).toEqual(['app_sheet_ok']);
  });
});

describe('createAppDb — prefix guard', () => {
  it('allows queries against own-prefix tables', async () => {
    const appDb = createAppDb({ db, appId: 'sheet' });
    await appDb.run('INSERT INTO app_sheet_workbooks (id) VALUES (?)', ['w1']);
    await appDb.query('SELECT * FROM app_sheet_workbooks');
    expect(db.log.length).toBeGreaterThan(0);
  });

  it('rejects queries against another app\'s tables (PermissionDeniedError)', async () => {
    const appDb = createAppDb({ db, appId: 'sheet' });
    await expect(
      appDb.query('SELECT * FROM app_memo_body'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('rejects writes against another app\'s tables', async () => {
    const appDb = createAppDb({ db, appId: 'sheet' });
    await expect(
      appDb.run('INSERT INTO app_memo_body (id) VALUES (?)', ['x']),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('rejects unprefixed legacy tables', async () => {
    const appDb = createAppDb({ db, appId: 'sheet' });
    await expect(
      appDb.query('SELECT * FROM api_history'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('honors hyphenated app ids by snake-casing the prefix', async () => {
    const appDb = createAppDb({ db, appId: 'music-creator' });
    await appDb.query('SELECT * FROM app_music_creator_tracks');
    await expect(
      appDb.query('SELECT * FROM app_music-creator_tracks'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('allows reading the app\'s own __migrations bookkeeping table', async () => {
    const appDb = createAppDb({ db, appId: 'sheet' });
    await appDb.query('SELECT * FROM app_sheet__migrations');
  });

  it('allows the declared shared-table allow-list (cross-app reads)', async () => {
    const appDb = createAppDb({
      db,
      appId: 'music-creator',
      sharedTableNames: ['app_voice_recorder_recordings'],
    });
    await appDb.query(
      'SELECT * FROM app_voice_recorder_recordings WHERE id = ?',
      ['x'],
    );
  });

  it('rejects shared tables NOT on the allow-list even when looking similar', async () => {
    const appDb = createAppDb({
      db,
      appId: 'music-creator',
      sharedTableNames: ['app_voice_recorder_recordings'],
    });
    await expect(
      appDb.query('SELECT * FROM app_voice_recorder_settings'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('createAppDb — listOwnedTables', () => {
  it('returns own-prefix + __migrations tables', async () => {
    const appDb = createAppDb({ db, appId: 'sheet' });
    await db.exec('CREATE TABLE app_sheet_workbooks (id TEXT)');
    await db.exec('CREATE TABLE app_sheet_cells (id TEXT)');
    await db.exec('CREATE TABLE app_sheet__migrations (name TEXT)');
    await db.exec('CREATE TABLE app_memo_body (id TEXT)'); // sibling app
    const owned = await appDb.listOwnedTables();
    expect(owned.sort()).toEqual([
      'app_sheet__migrations',
      'app_sheet_cells',
      'app_sheet_workbooks',
    ]);
  });
});

describe('createAppDb — migrate creates the bookkeeping table', () => {
  it('creates app_<id>__migrations on first migrate call (idempotent)', async () => {
    const appDb = createAppDb({ db, appId: 'sheet' });
    await appDb.migrate('migrations/');
    const tables = await appDb.listOwnedTables();
    expect(tables).toContain('app_sheet__migrations');
    // Calling again is idempotent — no throw, no duplicate logs.
    await appDb.migrate('migrations/');
  });
});
