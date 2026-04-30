// ============================================================
// Main-thread DB facade — promises in, results out
// ============================================================
//
// Spawns the SQLite worker once, exposes a `Db` API to the rest of
// the app. `initDb()` is awaited at boot in `main.tsx` so repos can
// use `getDb()` synchronously after mount.
//
// Tests bypass the worker entirely via `setDbForTesting(memDb)` —
// see `repo/__tests__/*` for the in-memory pattern. This keeps the
// repo tests fast and deterministic without spinning a real Worker.

import type { Db, SqlValue } from './types';

interface InitMeta {
  persistent: boolean;
  version: number;
  libVersion: string;
}

let dbInstance: Db | null = null;
let initMeta: InitMeta | null = null;
let inflight: Promise<Db> | null = null;

export const getDb = (): Db | null => dbInstance;
export const getDbMeta = (): InitMeta | null => initMeta;

/** Inject a stand-in db for tests. Call before each test, clear after. */
export const setDbForTesting = (db: Db | null, meta?: InitMeta | null) => {
  dbInstance = db;
  initMeta = meta ?? null;
  inflight = null;
};

/**
 * Boot the SQLite worker, run migrations, expose the live `Db` via
 * `getDb()`. Idempotent — safe to call multiple times; concurrent
 * callers share the same in-flight promise.
 */
export const initDb = async (): Promise<Db> => {
  if (dbInstance) return dbInstance;
  if (inflight) return inflight;

  inflight = (async () => {
    // Lazy-import the worker so apps that never touch the DB don't
    // pay the WASM download on first paint.
    const Worker = (await import('./worker?worker')).default;
    const worker = new Worker();
    const promiser = makePromiser(worker);

    const init = await promiser<{ persistent: boolean; version: number; libVersion: string }>(
      'init',
    );
    initMeta = {
      persistent: init.persistent,
      version: init.version,
      libVersion: init.libVersion,
    };

    const wrapped: Db = {
      exec: (sql) => promiser<void>('exec', { sql }),
      query: <T = Record<string, SqlValue>>(sql: string, bindings: SqlValue[] = []) =>
        promiser<{ rows: T[] }>('query', { sql, bindings }).then((r) => r.rows),
      run: (sql, bindings = []) => promiser<void>('run', { sql, bindings }),
      tx: async <T,>(fn: () => Promise<T>): Promise<T> => {
        await promiser<void>('exec', { sql: 'BEGIN IMMEDIATE' });
        try {
          const out = await fn();
          await promiser<void>('exec', { sql: 'COMMIT' });
          return out;
        } catch (err) {
          await promiser<void>('exec', { sql: 'ROLLBACK' }).catch(() => undefined);
          throw err;
        }
      },
      exportBytes: () =>
        promiser<{ bytes: Uint8Array }>('export').then((r) => r.bytes),
    };
    dbInstance = wrapped;
    return wrapped;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
};

// ----- internal -----

interface PendingResolver {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const makePromiser = (worker: Worker) => {
  const pending = new Map<string, PendingResolver>();
  worker.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as {
      id: string;
      ok: boolean;
      error?: string;
      [key: string]: unknown;
    };
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) {
      // Strip the protocol envelope keys before resolving so callers
      // see the payload-shaped object.
      const { id: _id, ok: _ok, error: _err, ...payload } = msg;
      void _id; void _ok; void _err;
      p.resolve(payload);
    } else {
      p.reject(new Error(msg.error ?? 'sqlite worker error'));
    }
  });

  return <T = void>(op: string, payload?: Record<string, unknown>): Promise<T> => {
    const id = `${op}:${Math.random().toString(36).slice(2)}`;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, op, ...(payload ?? {}) });
    });
  };
};
