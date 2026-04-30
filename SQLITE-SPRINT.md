# Tytus OS SQLite Storage Sprint

**Owner:** Sebastian / Tytus OS  
**Drafted:** 2026-04-30  
**Status:** Proposal — review before implementation

---

## 1. Why SQLite

Today every Tytus OS app persists state via `localStorage` (window geometry, desktop icons, API Tester collections / layout / history, etc.). This is fine for kilobytes of key-value data but it caps out for:

- **Larger corpora** — request history, brain notes, file index, terminal sessions. localStorage has a 5–10MB per-origin limit and is sync-blocking.
- **Queries** — no `WHERE`, no `ORDER BY`, no joins. Every consumer hand-rolls in-memory filtering.
- **Future search/vector features** — full-text search (FTS5) and vector similarity (`sqlite-vec`) only make sense on top of a real DB.
- **Schema evolution** — localStorage has no migration story; today every consumer guards reads with type predicates.
- **Backup / sync / inspection** — a single `tytusos.db` file is exportable, importable, and viewable in any SQLite browser.

makakoo-os already ships a Rust `rusqlite` store (`makakoo-core/src/db.rs`) with WAL, FTS5, BLOB embeddings, and `PRAGMA user_version` migrations. We mirror that pattern in the browser.

---

## 2. Library choice

| Option | Size (gz) | Persistence | Vector ext | Notes |
|---|---|---|---|---|
| **`@sqlite.org/sqlite-wasm`** | ~250KB JS + ~600KB WASM | OPFS (real disk) | sqlite-vec WASM loadable | Official SQLite team build. First-class OPFS via `sqlite3.oo1.OpfsDb`. Active. **← pick this** |
| `wa-sqlite` | ~150KB JS + ~450KB WASM | OPFS | sqlite-vec loadable | Roy Hashimoto. Slightly smaller, slightly less polished docs |
| `sql.js` | ~1MB | In-memory + manual dump to OPFS | No | Easy but no native persistence |
| `@electric-sql/pglite` | ~2MB | OPFS | pg_vector | Postgres, more capable but 3× larger and overkill |

**Recommendation:** `@sqlite.org/sqlite-wasm` (official). Standard SQLite, OPFS-backed `tytusos.db`, no FFI weirdness, and the same SQL you'd write in `rusqlite`.

For vectors (Phase 3+): load `sqlite-vec` as a runtime extension. Until then, store BLOBs + cosine in JS — the makakoo-core pattern.

---

## 3. Architecture

### 3.1 Storage layer

```
src/
  lib/
    db/
      index.ts              # Public API: getDb(), withTx(), runMigrations()
      schema.ts             # SCHEMA_V1 SQL + version constant
      migrations.ts         # Idempotent runner, `PRAGMA user_version`
      opfs.ts               # OPFS sanity check + path resolution
      types.ts              # Row → TypeScript shape mappers
    repo/
      apiHistory.ts         # listHistory, addHistory, clearHistory
      apiCollections.ts     # listCollections, upsertCollection, deleteItem...
      (future: notes, fileIndex, terminalSessions, vectors)
```

The DB is a singleton initialised at app boot. All consumers go through `repo/*` modules — never raw `db.exec()` from a component.

### 3.2 Where the DB lives

**OPFS** (Origin Private File System): `tytusos.db` in the browser-managed sandbox at `tytus.<origin>/tytusos.db`. Real file, real WAL, persists across reloads, cleared only when user wipes site data.

OPFS is supported in every Chromium-based browser, Safari 17+, and Firefox 111+. Tauri (if we ever wrap) gets a real fs path with the same SQLite API — zero code change.

### 3.3 Transactions

`withTx(fn)` wraps `BEGIN IMMEDIATE; … COMMIT;` so every multi-statement write is atomic. Read-side helpers don't need it.

### 3.4 Migration model

Mirror makakoo-core: `PRAGMA user_version` + idempotent `CREATE TABLE IF NOT EXISTS` + idempotent `ALTER` heals. Schema is a single SQL string per version. **No** versioned diff scripts — additive-only changes, with an explicit `heal_legacy_drift()` for the rare cases that need it.

```ts
// schema.ts
export const SCHEMA_VERSION = 1;
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS api_history (
  id           TEXT PRIMARY KEY,
  method       TEXT NOT NULL,
  url          TEXT NOT NULL,
  status       INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  ts           INTEGER NOT NULL                  -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_api_history_ts ON api_history(ts DESC);

CREATE TABLE IF NOT EXISTS api_collections (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  pos   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_collection_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES api_collections(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  method        TEXT NOT NULL,
  url           TEXT NOT NULL,
  headers_json  TEXT NOT NULL DEFAULT '[]',     -- serialized Header[]
  body          TEXT NOT NULL DEFAULT '',
  pos           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_items_collection
  ON api_collection_items(collection_id, pos);
`;
```

### 3.5 Boot integration

`main.tsx` awaits `initDb()` before mounting `<App />`. If OPFS is unavailable (unsupported browser), fall back to localStorage with a warning toast — don't hard-fail. Provide `getDb()` returning `null` so repos can route to the legacy path.

---

## 4. Phased plan

### Phase 1 — Plumbing (1 file change set)
- Add `@sqlite.org/sqlite-wasm` dep
- Vite config: copy WASM to `public/`, set worker config for OPFS
- `src/lib/db/index.ts` + `schema.ts` + `migrations.ts` + `opfs.ts`
- Boot wiring in `main.tsx` (await init, log version)
- Smoke test: open db, run migrations, write a debug row, read it back, log
- **Deliverable:** `tytusos.db` exists in OPFS, schema v1 applied, no app behaviour change yet

### Phase 2 — API Tester migration (the user's "first items")
- `src/lib/repo/apiHistory.ts` + `apiCollections.ts`
- One-shot importer: on first boot if rows count = 0 AND legacy `localStorage['tytus_api_tester_*']` exists, copy → DB → set a marker
- Refactor `apps/ApiTester.tsx` to use the repos (drop localStorage helpers)
- **Deliverable:** History persists across reload, survives even after `localStorage.clear()`. Collections same. Existing user data migrates silently

### Phase 3 — FTS5 (optional, defer if not needed)
- Add `api_history_fts` virtual table over `url + body` for "search past requests"
- New search input above the history strip
- **Deliverable:** typeahead search across past requests

### Phase 4 — Vectors (sqlite-vec, when there's a use case)
- Load `sqlite-vec` runtime extension
- New `embeddings` table (`item_id, vec FLOAT BLOB, dim INTEGER`)
- First consumer: "find similar past requests" / brain memo similarity
- **Deliverable:** unblocks every future "semantic memory" feature without a separate vector store

### Phase 5 — Other stores (notes, terminal sessions, brain) graduate from localStorage
- One repo per consumer, same migration recipe
- Eventually: deprecate localStorage entirely except for window geometry (which is genuinely a key-value preference)

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| OPFS unavailable in user's browser | Fall back to localStorage with toast; repos route via `getDb() ?? legacyStore` |
| WASM blob bundle size (+~850KB to first load) | Lazy-load: import the SQLite WASM module on first `getDb()` call, not at app entry. Apps that don't touch the DB pay nothing |
| `BEGIN IMMEDIATE` lock contention with multiple windows | OPFS is per-origin so multiple Tytus OS windows share. Use short txns + retry on `SQLITE_BUSY`. Same pattern as makakoo-core's `busy_timeout = 5000` |
| User wipes site data → DB gone | Add an Export/Import button in System Settings (Phase 6). Until then, document that local-only data is local-only |
| Schema mistakes are forever in v1 | Land Phase 1 + Phase 2 behind a feature flag for one week of dogfooding before deleting the localStorage path |

---

## 6. Open questions

1. **Worker thread or main thread?** OPFS sync API requires a Worker. The official package ships a Worker-mode helper. Prefer Worker — keeps the UI snappy on big writes. ~10 lines of glue.
2. **One DB or per-app DBs?** One DB simplifies cross-app queries (e.g. notes referencing API requests). Stick with one `tytusos.db` until we have a real reason to split.
3. **Sync to pod?** Out of scope for this sprint. The schema doesn't preclude it — every row has a stable id. A future sync layer can reconcile via timestamp + id.
4. **Should we co-evolve with the Rust daemon?** No. Daemon owns server-side state (auth, pods, jobs). The frontend DB owns user-workspace state (history, collections, notes). Different domains, different lifetimes.

---

## 7. Acceptance criteria for Phase 1+2 (first ship)

- [ ] `npm run build` succeeds, bundle size delta documented
- [ ] App boots in dev + prod with OPFS-backed `tytusos.db`
- [ ] `PRAGMA user_version` returns 1 after fresh boot
- [ ] API Tester history persists across page reload
- [ ] API Tester collections survive `localStorage.clear()`
- [ ] One-shot migration copies pre-sprint localStorage data on first boot
- [ ] Vitest: at least 5 tests covering open / migrate / write / read / tx-rollback
- [ ] Existing 214 tests still pass

---

**Decision points for Sebastian:**
- Approve `@sqlite.org/sqlite-wasm` over `wa-sqlite` (or pick the other)?
- Phase 1+2 in one PR, or split?
- Defer vectors to its own sprint, or scope creep into Phase 4 here?
