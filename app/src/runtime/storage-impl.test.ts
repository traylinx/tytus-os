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
    // Minimal SELECT handler: SELECT name FROM "table" [ORDER BY name].
    // Used by migrate() to read back applied rows. We don't parse a full
    // SQL grammar; the regex pulls the table identifier out and returns
    // the row's `name` column (the only column the migrations bookkeeping
    // SELECT touches).
    const selectMatch = /FROM\s+"?([a-zA-Z_][\w]*)"?/i.exec(sql);
    if (selectMatch) {
      const tableName = selectMatch[1];
      const rows = this.tables.get(tableName) ?? [];
      // If ORDER BY name, sort.
      if (/ORDER\s+BY\s+name/i.test(sql)) {
        return [...rows].sort((a, b) =>
          String(a.name).localeCompare(String(b.name)),
        ) as unknown as T[];
      }
      return rows as unknown as T[];
    }
    return [] as T[];
  }

  async run(sql: string, bindings: SqlValue[] = []): Promise<void> {
    this.log.push(sql);
    // Minimal INSERT handler: INSERT INTO "table" (name, applied_at)
    // VALUES (?, ?) — used by migrate() to record applied migrations.
    const insertMatch =
      /INSERT\s+INTO\s+"?([a-zA-Z_][\w]*)"?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(sql);
    if (insertMatch) {
      const tableName = insertMatch[1];
      const cols = insertMatch[2].split(',').map((c) => c.trim());
      const placeholders = insertMatch[3].split(',').map((p) => p.trim());
      const row: Record<string, SqlValue> = {};
      for (let i = 0; i < cols.length; i += 1) {
        if (placeholders[i] === '?') {
          row[cols[i]] = bindings[i] ?? null;
        }
      }
      const rows = this.tables.get(tableName);
      if (rows) rows.push(row);
      else this.tables.set(tableName, [row]);
    }
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

describe('createAppDb — migrate replay', () => {
  it('runs every declared migration in name order', async () => {
    const appDb = createAppDb({
      db,
      appId: 'sheet',
      migrations: [
        {
          name: '0002_add_cells.sql',
          sql: 'CREATE TABLE app_sheet_cells (id TEXT)',
        },
        {
          name: '0001_workbooks.sql',
          sql: 'CREATE TABLE app_sheet_workbooks (id TEXT)',
        },
      ],
    });
    await appDb.migrate('migrations/');
    const tables = await appDb.listOwnedTables();
    expect(tables).toEqual(
      expect.arrayContaining([
        'app_sheet__migrations',
        'app_sheet_cells',
        'app_sheet_workbooks',
      ]),
    );
    // Both names recorded as applied.
    const recorded = await db.query<{ name: string }>(
      'SELECT name FROM "app_sheet__migrations" ORDER BY name',
    );
    expect(recorded.map((r) => r.name)).toEqual([
      '0001_workbooks.sql',
      '0002_add_cells.sql',
    ]);
  });

  it('skips migrations already recorded in __migrations', async () => {
    const appDb1 = createAppDb({
      db,
      appId: 'sheet',
      migrations: [
        {
          name: '0001_workbooks.sql',
          sql: 'CREATE TABLE app_sheet_workbooks (id TEXT)',
        },
      ],
    });
    await appDb1.migrate('migrations/');

    // Build a new appDb instance with the SAME migration name and an
    // SQL body that would error on a second run (DROP first to prove
    // it didn't execute again).
    const appDb2 = createAppDb({
      db,
      appId: 'sheet',
      migrations: [
        {
          name: '0001_workbooks.sql',
          sql: 'INVALID SQL THAT WOULD THROW',
        },
      ],
    });
    // Should NOT throw — the migration was already applied.
    await appDb2.migrate('migrations/');
  });

  it('runs a fresh pending migration on top of previously-applied ones', async () => {
    const m1 = {
      name: '0001_workbooks.sql',
      sql: 'CREATE TABLE app_sheet_workbooks (id TEXT)',
    };
    const appDb1 = createAppDb({ db, appId: 'sheet', migrations: [m1] });
    await appDb1.migrate('migrations/');

    const m2 = {
      name: '0002_add_cells.sql',
      sql: 'CREATE TABLE app_sheet_cells (id TEXT)',
    };
    const appDb2 = createAppDb({
      db,
      appId: 'sheet',
      migrations: [m1, m2],
    });
    await appDb2.migrate('migrations/');

    const tables = await appDb2.listOwnedTables();
    expect(tables).toEqual(
      expect.arrayContaining(['app_sheet_workbooks', 'app_sheet_cells']),
    );
    const recorded = await db.query<{ name: string }>(
      'SELECT name FROM "app_sheet__migrations" ORDER BY name',
    );
    expect(recorded.map((r) => r.name)).toEqual([
      '0001_workbooks.sql',
      '0002_add_cells.sql',
    ]);
  });

  it('rolls back the bookkeeping insert if the migration SQL throws', async () => {
    // Build a Db that throws on the migration's exec but the test
    // exposes a flag so we can verify INSERT did NOT run after the
    // throw — i.e. nothing got recorded for the failed migration.
    class ThrowingDb extends MemoryDb {
      private throwOnNextExec = false;
      armThrow() {
        this.throwOnNextExec = true;
      }
      override async exec(sql: string): Promise<void> {
        if (this.throwOnNextExec) {
          this.throwOnNextExec = false;
          throw new Error('boom');
        }
        await super.exec(sql);
      }
    }
    const tdb = new ThrowingDb();
    // Pre-create the migrations bookkeeping table normally.
    const appDb = createAppDb({
      db: tdb,
      appId: 'sheet',
      migrations: [
        {
          name: '0001_break.sql',
          sql: 'CREATE TABLE app_sheet_break (id TEXT)',
        },
      ],
    });
    // Arm the throw so the migration body fails.
    // We need to consume two exec calls before arming: the
    // ensureMigrationsTable + the explicit BEGIN... since our test
    // MemoryDb.tx is a no-op around fn(), only the SQL inside the body
    // throws. Arm just before migrate() runs the migration body.
    // Easiest: subclass Db so the very first exec inside migrate
    // throws — meaning ensureMigrationsTable goes through, but the
    // first migration body fails. Arm right after ensureMigrationsTable.
    await tdb.exec('SELECT 1'); // warm-up
    tdb.armThrow();
    await expect(appDb.migrate('migrations/')).rejects.toThrow(/boom/);
    // No row was recorded in __migrations.
    const recorded = await tdb.query<{ name: string }>(
      'SELECT name FROM "app_sheet__migrations"',
    );
    expect(recorded).toEqual([]);
  });
});
