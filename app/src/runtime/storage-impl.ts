/**
 * Per-app SQLite implementation of `AppDb` from @tytus/host-api.
 *
 * Wraps the shared `Db` (live SQLite worker behind the OPFS DB) with
 * a prefix guard: every SQL statement is scanned for table names; any
 * table not prefixed `app_<sqlAppId>_` (or `app_<sqlAppId>__migrations`
 * for the bookkeeping table) throws `PermissionDeniedError`. Apps
 * write physical names directly — there is NO magic prefixing.
 *
 * Shared-key reads (cross-app reads of a table OWNED by another app)
 * are wired in the SharedDb path, NOT here. This implementation is
 * the AppDb the bound app sees through `host.storage.current()`.
 *
 * Per spec §"host.storage" / 02-ai-engine.md.
 *
 * Enforcement scope per spec:
 *   - M3 (initial): regex-based table-name extraction. Catches the
 *     common 90% (SELECT FROM, INSERT INTO, UPDATE, CREATE TABLE,
 *     DROP TABLE, JOIN). Misses table aliases referencing other apps
 *     and embedded EXEC. Acceptable for v1 — apps are first-party.
 *   - Future (post-v1, when third-party apps land): swap to a real
 *     SQLite parser.
 */

import type { AppDb, RunResult } from '@tytus/host-api';
import { PermissionDeniedError, sqlAppId } from '@tytus/host-api';
import type { Db, SqlValue } from '@/lib/db/types';

/** Regex pulling table identifiers out of the common SQL surfaces.
 *  Catches FROM, JOIN, UPDATE, INSERT INTO, CREATE TABLE, DROP TABLE,
 *  ALTER TABLE. Missed cases (table aliases pointing at other apps)
 *  are handled in M-future when a real parser lands. */
const TABLE_REF_RE =
  /\b(?:FROM|JOIN|UPDATE|INTO|CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|ALTER\s+TABLE)\s+([a-zA-Z_][\w]*)/gi;

/** Strip block + line comments before scanning so commented-out table
 *  references don't trip the guard. Strings are scanned as-is — the
 *  guard accepts more than it should rather than less, but raw strings
 *  in app SQL are fine because they don't reference table identifiers
 *  syntactically. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block
    .replace(/--[^\n]*/g, ' '); // line
}

/** Extract every table name referenced by an SQL statement (uppercased
 *  for case-insensitive comparison). Best-effort regex per spec. */
export function extractTableNames(sql: string): string[] {
  const cleaned = stripSqlComments(sql);
  const names: string[] = [];
  let m: RegExpExecArray | null;
  TABLE_REF_RE.lastIndex = 0;
  while ((m = TABLE_REF_RE.exec(cleaned)) !== null) {
    names.push(m[1]);
  }
  return names;
}

export interface AppDbDeps {
  db: Db;
  appId: string;
  /** Optional: shared-table allow-list. The reading app's
   *  `storage.shared.<key>` permission resolves to a physical table
   *  name (e.g. `app_voice_recorder_recordings`); those names are
   *  added to the allow-list at install time. M3 PR2+ wires this. */
  sharedTableNames?: string[];
}

export function createAppDb(deps: AppDbDeps): AppDb {
  const { db, appId } = deps;
  const sqlPrefix = `app_${sqlAppId(appId)}_`;
  const migrationsTableName = `app_${sqlAppId(appId)}__migrations`;
  const shared = new Set((deps.sharedTableNames ?? []).map((n) => n.toLowerCase()));

  const isOwnedTable = (name: string): boolean => {
    const lower = name.toLowerCase();
    if (lower === migrationsTableName) return true;
    if (lower.startsWith(sqlPrefix)) return true;
    if (shared.has(lower)) return true;
    // sqlite_master is read-only and used by listOwnedTables; the guard
    // accepts it for queries (writes never reference it).
    if (lower === 'sqlite_master') return true;
    return false;
  };

  const enforcePrefix = (sql: string): void => {
    for (const t of extractTableNames(sql)) {
      if (!isOwnedTable(t)) {
        throw new PermissionDeniedError({
          permission: 'storage.app',
          appId,
          message: `App "${appId}" cannot reference table "${t}" — must start with "${sqlPrefix}" or be a declared shared key.`,
        });
      }
    }
  };

  const ensureMigrationsTable = async (): Promise<void> => {
    await db.exec(
      `CREATE TABLE IF NOT EXISTS "${migrationsTableName}" (` +
        `name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    );
  };

  return {
    async run(sql, args) {
      enforcePrefix(sql);
      const bindings = (args ?? []) as SqlValue[];
      await db.run(sql, bindings);
      // The shared `Db` doesn't surface lastInsertRowid/changes today.
      // M3 PR2+ extends Db.run to thread these through; until then we
      // return zeros so callers compile.
      return { lastInsertRowid: 0, changes: 0 } satisfies RunResult;
    },

    async query<T>(sql: string, args?: readonly unknown[]): Promise<T[]> {
      enforcePrefix(sql);
      const bindings = (args ?? []) as SqlValue[];
      return db.query<T>(sql, bindings);
    },

    async migrate(migrationsDir: string): Promise<void> {
      // The `migrationsDir` argument names a path relative to the app
      // bundle; the shell resolves this to a list of (name, sql) pairs
      // in M3 PR2+ (host.assets-backed glob). Today we no-op — apps
      // don't have migrations files to run yet. listOwnedTables() and
      // run/query work against any tables the app creates ad-hoc.
      void migrationsDir;
      await ensureMigrationsTable();
    },

    async listOwnedTables(): Promise<string[]> {
      const rows = await db.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE ? OR name = ?) ESCAPE '\\\\' AND name NOT LIKE 'sqlite\\\\_%' ESCAPE '\\\\'`,
        [
          // SQLite LIKE escapes underscores when the ESCAPE char is set.
          sqlPrefix.replace(/_/g, '\\_') + '%',
          migrationsTableName,
        ],
      );
      return rows.map((r) => r.name).sort();
    },
  };
}
