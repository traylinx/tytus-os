// Shared DB types — kept here so repos and tests don't reach into
// the raw sqlite-wasm types. The `Db` interface is intentionally
// minimal: the smallest API the repos need so we can swap in the
// in-memory test impl without dragging the whole sqlite3 OO API.

export type SqlValue = string | number | null;

export interface Db {
  /** Run a SQL string with no result rows. Multi-statement OK. */
  exec(sql: string): Promise<void>;
  /**
   * Run a parameterized SQL with optional bindings, returning rows
   * as objects keyed by the SELECT column names.
   */
  query<T = Record<string, SqlValue>>(
    sql: string,
    bindings?: SqlValue[],
  ): Promise<T[]>;
  /** Run a parameterized statement that doesn't return rows. */
  run(sql: string, bindings?: SqlValue[]): Promise<void>;
  /** Run `fn` inside `BEGIN IMMEDIATE; ...; COMMIT;`. Rollbacks on throw. */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Serialise the live database into a standard SQLite file image.
   * The returned bytes are byte-identical to `cp foo.db` of the same DB
   * — `sqlite3 file.sqlite` opens it directly. Optional method so test
   * fakes can omit it.
   */
  exportBytes?(): Promise<Uint8Array>;
}
