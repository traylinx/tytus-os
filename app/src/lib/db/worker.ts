// ============================================================
// SQLite worker — owns the OPFS database file
// ============================================================
//
// Runs in a dedicated Web Worker (spawned by index.ts via `?worker`).
// Uses the OPFS SAH-Pool VFS so we don't need COOP/COEP headers on
// the host — which keeps tytus-cli's tray HTTP server simple.
//
// Protocol: main thread sends `{ id, op, sql?, bindings? }`, worker
// replies with `{ id, ok, rows?, error? }`. Operations:
//   init    — install OPFS pool, open `/tytusos.db`, run migrations
//   exec    — run a multi-statement SQL string (no result rows)
//   query   — run a single statement with bindings; reply rows
//   run     — like query but no rows expected
//   tx-*    — BEGIN IMMEDIATE / COMMIT / ROLLBACK
//
// If OPFS / SAH-Pool isn't available (e.g. older browser, private
// mode in some configs), we fall back to an in-memory DB and the
// reply payload signals it so the main thread can warn the user.

/// <reference lib="webworker" />

import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11, SCHEMA_V12, SCHEMA_V13, SCHEMA_V14, SCHEMA_VERSION } from './schema';

declare const self: DedicatedWorkerGlobalScope;

type WorkerMsg =
  | { id: string; op: 'init' }
  | { id: string; op: 'exec'; sql: string }
  | { id: string; op: 'query'; sql: string; bindings?: unknown[] }
  | { id: string; op: 'run'; sql: string; bindings?: unknown[] }
  | { id: string; op: 'export' };

interface InitOk { ok: true; persistent: boolean; version: number; libVersion: string; }
interface RowsOk { ok: true; rows: Array<Record<string, unknown>>; }
interface DoneOk { ok: true; }
interface ExportOk { ok: true; bytes: Uint8Array; }
interface Err { ok: false; error: string; }
type Reply = (InitOk | RowsOk | DoneOk | ExportOk | Err) & { id: string };

let sqlite3Singleton: Sqlite3Static | null = null;
let db: Database | null = null;
let persistent = false;

const reply = (msg: Reply) => self.postMessage(msg);

// Tables we expect every healthy boot to have. Used as a sanity check
// after migrations — see openDb() for the rationale.
const REQUIRED_TABLES = ['music_creator_tracks', 'installed_apps'] as const;

const tableExists = (database: Database, name: string): boolean => {
  const rows = database.exec({
    sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
    bind: [name],
    returnValue: 'resultRows',
    rowMode: 'array',
  }) as unknown as Array<unknown[]>;
  return rows.length > 0;
};

const applyPragmas = (database: Database) => {
  for (const stmt of [
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = NORMAL',
    'PRAGMA busy_timeout = 5000',
    'PRAGMA foreign_keys = ON',
  ]) {
    database.exec(stmt);
  }
};

const openInMemory = (sqlite3: Sqlite3Static): Database => {
  if (db) {
    try {
      db.close();
    } catch {
      /* connection already dead — ignore */
    }
  }
  const memDb = new sqlite3.oo1.DB(':memory:', 'ct');
  applyPragmas(memDb);
  return memDb;
};

// Round-trip probe: prove the DB can actually write AND read back data.
// installOpfsSAHPoolVfs logs handle-acquisition errors via its internal
// storeErr path but still returns a pool object whose getCapacity() can
// be non-zero — so writes against the resulting Database silently no-op.
// This is the exact failure that lets migrations "succeed" on a broken
// backing and then the first SELECT hits "no such table". The only
// reliable detection is to write and read a sentinel value: a passing
// CREATE+INSERT+SELECT means the pool is genuinely usable.
const SENTINEL_TABLE = '_tytus_pool_probe';
const probeWriteRead = (database: Database): boolean => {
  try {
    database.exec(
      `CREATE TABLE IF NOT EXISTS ${SENTINEL_TABLE} (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`,
    );
    database.exec({
      sql: `INSERT OR REPLACE INTO ${SENTINEL_TABLE} (k, v) VALUES ('probe', ?)`,
      bind: [Date.now()] as never,
    });
    const rows = database.exec({
      sql: `SELECT v FROM ${SENTINEL_TABLE} WHERE k = 'probe'`,
      returnValue: 'resultRows',
      rowMode: 'array',
    }) as unknown as Array<[number]>;
    return rows.length > 0 && typeof rows[0]?.[0] === 'number';
  } catch (err) {
    console.warn('[sqlite] DB probe failed; treating backing as broken', err);
    return false;
  }
};

// Returns true on a confirmed-healthy OPFS pool, false on any failure
// path (refusal to install, zero-capacity install, write/read probe
// fails, exception). When false, the caller must open an in-memory DB
// instead.
const tryOpenPersistent = async (sqlite3: Sqlite3Static): Promise<boolean> => {
  let pool: Awaited<ReturnType<typeof sqlite3.installOpfsSAHPoolVfs>> | null = null;
  try {
    pool = await sqlite3.installOpfsSAHPoolVfs({
      name: 'tytus-opfs-pool',
      initialCapacity: 4,
      clearOnInit: false,
    });
    const capacity =
      typeof pool.getCapacity === 'function' ? pool.getCapacity() : 0;
    if (capacity === 0) {
      console.warn(
        '[sqlite] OPFS SAH pool installed with capacity=0 (handles held by another tab/worker); falling back to in-memory DB',
      );
      try {
        await pool.removeVfs?.();
      } catch {
        /* the lib has likely already tried and failed — non-fatal */
      }
      return false;
    }
    const candidate = new pool.OpfsSAHPoolDb('/tytusos.db');
    if (!probeWriteRead(candidate)) {
      console.warn(
        '[sqlite] OPFS SAH pool write/read probe failed (likely zombie handles from another tab/worker); falling back to in-memory DB',
      );
      try {
        candidate.close();
      } catch {
        /* connection already dead */
      }
      try {
        await pool.removeVfs?.();
      } catch {
        /* non-fatal */
      }
      return false;
    }
    db = candidate;
    persistent = true;
    return true;
  } catch (err) {
    console.warn('[sqlite] OPFS SAH pool unavailable, falling back to in-memory DB', err);
    return false;
  }
};

const openDb = async (): Promise<{ persistent: boolean; libVersion: string }> => {
  const sqlite3: Sqlite3Static = await sqlite3InitModule();
  sqlite3Singleton = sqlite3;

  // SAH-Pool first — works without COOP/COEP and doesn't require
  // SharedArrayBuffer. Falls back to a transient in-memory DB if the
  // browser refuses (Safari < 17, private windows in some browsers,
  // or a sibling tab/HMR worker still holding handles).
  if (!(await tryOpenPersistent(sqlite3))) {
    db = openInMemory(sqlite3);
    persistent = false;
  } else {
    applyPragmas(db!);
  }

  runMigrations(db!);

  // Last-line defense: if migrations ran against a backing that didn't
  // actually persist DDL (broken OPFS pool we failed to detect), the
  // required tables won't exist. Switch to in-memory and re-run.
  if (persistent && !REQUIRED_TABLES.every((t) => tableExists(db!, t))) {
    console.warn(
      '[sqlite] Persistent DB missing required tables after migration; recovering with in-memory DB',
    );
    db = openInMemory(sqlite3);
    persistent = false;
    runMigrations(db);
  }

  return { persistent, libVersion: sqlite3.version.libVersion };
};

const runMigrations = (database: Database): void => {
  // V1-V4 are idempotent (CREATE IF NOT EXISTS), so apply unconditionally.
  // V5+ uses ALTER TABLE which is NOT idempotent — gate on the actual
  // table schema (PRAGMA table_info) rather than user_version. We hit
  // a case in dev where user_version was bumped to 5 but the ALTER had
  // never landed (HMR-driven worker restart mid-init), leaving rows
  // unreadable because every repo SELECT referenced specs_json. Reading
  // table_info is bulletproof: if the column is missing for any reason,
  // we add it now.
  database.exec(SCHEMA_V1);
  database.exec(SCHEMA_V2);
  database.exec(SCHEMA_V3);
  database.exec(SCHEMA_V4);
  database.exec(SCHEMA_V9);  // CREATE TABLE IF NOT EXISTS — idempotent, safe to run alongside V1-V4.
  database.exec(SCHEMA_V10); // Provider-backed JULI3TA Player library/playlists/favorites.
  database.exec(SCHEMA_V11); // Sprint A Phase 4 — trash_items metadata index.
  database.exec(SCHEMA_V12); // Apps Platform M1 — installed_apps registry table.
  database.exec(SCHEMA_V14); // Host-owned AI/Cortex conversation substrate.

  // Reusable column-presence ALTER. Each ALTER is gated on the actual
  // schema rather than user_version, so a stuck migration in a previous
  // run (HMR-driven worker restart, parallel init, etc.) self-heals on
  // the next boot. Add new V*+1 migrations by appending another call.
  const ensureColumnOn = (
    table: string,
    column: string,
    ddl: string,
    label: string,
  ) => {
    const cols = database.exec({
      sql: `PRAGMA table_info(${table})`,
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as unknown as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) return;
    try {
      database.exec(ddl);
    } catch (e) {
      const after = database.exec({
        sql: `PRAGMA table_info(${table})`,
        returnValue: 'resultRows',
        rowMode: 'object',
      }) as unknown as Array<{ name: string }>;
      if (!after.some((c) => c.name === column)) {
        console.error(`[sqlite] ${label} ALTER failed and column still missing`, e);
      }
    }
  };

  // Back-compat alias — the music_creator_tracks ALTERs grew up before
  // we needed a generic column ensurer. Keep the old name as a thin
  // shim so the migration list below reads identically to before V13.
  const ensureColumn = (column: string, ddl: string, label: string) =>
    ensureColumnOn('music_creator_tracks', column, ddl, label);

  ensureColumn('specs_json', SCHEMA_V5, 'SCHEMA_V5');
  ensureColumn('cover_data_url', SCHEMA_V6, 'SCHEMA_V6');
  ensureColumn('theme', SCHEMA_V7, 'SCHEMA_V7');
  ensureColumn('source', "ALTER TABLE music_creator_tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'juli3ta';", 'SCHEMA_V8_source');
  ensureColumn('audio_kind', "ALTER TABLE music_creator_tracks ADD COLUMN audio_kind TEXT NOT NULL DEFAULT 'data_url';", 'SCHEMA_V8_audio_kind');
  ensureColumn('external_id', "ALTER TABLE music_creator_tracks ADD COLUMN external_id TEXT NOT NULL DEFAULT '';", 'SCHEMA_V8_external_id');
  ensureColumn('external_url', "ALTER TABLE music_creator_tracks ADD COLUMN external_url TEXT NOT NULL DEFAULT '';", 'SCHEMA_V8_external_url');
  ensureColumn('thumbnail_url', "ALTER TABLE music_creator_tracks ADD COLUMN thumbnail_url TEXT NOT NULL DEFAULT '';", 'SCHEMA_V8_thumbnail_url');
  ensureColumn('artist', "ALTER TABLE music_creator_tracks ADD COLUMN artist TEXT NOT NULL DEFAULT '';", 'SCHEMA_V8_artist');
  ensureColumn('album', "ALTER TABLE music_creator_tracks ADD COLUMN album TEXT NOT NULL DEFAULT '';", 'SCHEMA_V8_album');

  // V13: nullable manifest_url on installed_apps so the App Store can
  // remember where it fetched a third-party app's tytus-app.json from
  // and offer "Reinstall" without re-prompting the user for the URL.
  ensureColumnOn('installed_apps', 'manifest_url', SCHEMA_V13, 'SCHEMA_V13');

  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
};

const runQuery = (
  sql: string,
  bindings: unknown[] = [],
): Array<Record<string, unknown>> => {
  if (!db) throw new Error('db not initialized');
  // `exec` with `returnValue: 'resultRows'` + `rowMode: 'object'` gives
  // us the array-of-objects shape every repo wants.
  const rows = db.exec({
    sql,
    bind: bindings as never,
    returnValue: 'resultRows',
    rowMode: 'object',
  });
  return rows as Array<Record<string, unknown>>;
};

self.addEventListener('message', async (e: MessageEvent<WorkerMsg>) => {
  const msg = e.data;
  try {
    switch (msg.op) {
      case 'init': {
        const { persistent: p, libVersion } = await openDb();
        reply({ id: msg.id, ok: true, persistent: p, version: SCHEMA_VERSION, libVersion });
        return;
      }
      case 'exec': {
        if (!db) throw new Error('db not initialized');
        db.exec(msg.sql);
        reply({ id: msg.id, ok: true });
        return;
      }
      case 'query': {
        const rows = runQuery(msg.sql, msg.bindings);
        reply({ id: msg.id, ok: true, rows });
        return;
      }
      case 'run': {
        runQuery(msg.sql, msg.bindings);
        reply({ id: msg.id, ok: true });
        return;
      }
      case 'export': {
        if (!db || !sqlite3Singleton) throw new Error('db not initialized');
        // sqlite3_js_db_export serialises the live database into a
        // standard SQLite file image — the same bytes a `cp foo.db`
        // would produce. Works regardless of VFS (SAH-Pool, OPFS,
        // in-memory). The Uint8Array is transferred — main thread
        // wraps it in a Blob and triggers the download.
        const bytes = sqlite3Singleton.capi.sqlite3_js_db_export(
          (db as unknown as { pointer: number }).pointer,
        );
        // Postmessage with a transferable so we don't pay a clone.
        const reply: ExportOk & { id: string } = {
          id: msg.id, ok: true, bytes,
        };
        self.postMessage(reply, [bytes.buffer as ArrayBuffer]);
        return;
      }
    }
  } catch (err) {
    reply({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
