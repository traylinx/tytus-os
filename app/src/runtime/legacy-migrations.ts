// ============================================================
// Legacy data migrations — one-shot, runs in the shell shim
// ============================================================
//
// W4 of the apps-platform sprint moves Music Creator's persistent
// state from the un-prefixed monolith schema (`music_creator_tracks`,
// `music_creator_settings`) into the per-app prefixed namespace
// (`app_music_creator_tracks`, `app_music_creator_settings`).
//
// The workspace package can't read the un-prefixed legacy tables —
// the host-api prefix guard rejects any query outside the bound
// app's prefix. So the copy must run BEFORE the per-app DB binds.
// `app/src/main.tsx` calls `migrateLegacyMusicCreatorTables(db)` after
// `initDb()` and before `seedBundledAppsAtBoot(db)`.
//
// Each step is idempotent: a row in `migration_flags` (the existing
// V1 table — see lib/db/schema.ts) records that a step ran. Re-runs
// short-circuit on the flag.

import type { Db, SqlValue } from '@/lib/db/types';

// Flag keys. Each migration step records its completion under one
// of these keys in `migration_flags`. Presence = "step has run, do
// not run again". The shell schema's V1 ships the migration_flags
// table; both flags below land BEFORE this code runs because schema
// init happens during initDb().
const FLAG_TRACKS_IMPORTED = 'music_creator_tracks_imported';
const FLAG_SETTINGS_IMPORTED = 'music_creator_settings_imported';
const FLAG_YT_TO_LIBRARY = 'youtube_creator_to_library_imported';

// Test whether a SQLite table exists. Returns true iff the
// sqlite_master row is present. Using `sqlite_master` (not
// `sqlite_schema`) for max portability across the sqlite-wasm builds
// we ship.
const tableExists = async (db: Db, name: string): Promise<boolean> => {
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?",
    [name],
  );
  return Number(rows[0]?.n ?? 0) > 0;
};

const flagSet = async (db: Db, key: string): Promise<boolean> => {
  const rows = await db.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM migration_flags WHERE key = ?',
    [key],
  );
  return Number(rows[0]?.n ?? 0) > 0;
};

const recordFlag = async (db: Db, key: string): Promise<void> => {
  await db.run(
    'INSERT OR IGNORE INTO migration_flags (key, ts) VALUES (?, ?)',
    [key, Date.now()],
  );
};

// Ensure the destination per-app table exists. The shell-side
// schema.ts only creates the un-prefixed `music_creator_tracks`;
// `app_music_creator_tracks` is created lazily by the per-app DB
// migrate step in the workspace package. Since this code runs
// BEFORE per-app binds, we mirror the workspace package's
// migrations/0001_tracks.sql here as a CREATE-IF-NOT-EXISTS.
//
// The DDL must stay in sync with packages/app-music-creator/migrations/0001_tracks.sql.
const ensureAppMusicCreatorTracks = async (db: Db): Promise<void> => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_music_creator_tracks (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      style_tags      TEXT NOT NULL DEFAULT '',
      lyrics_preview  TEXT NOT NULL DEFAULT '',
      duration_ms     INTEGER NOT NULL DEFAULT 0,
      bitrate         INTEGER NOT NULL DEFAULT 0,
      sample_rate     INTEGER NOT NULL DEFAULT 0,
      size_bytes      INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      audio_data_url  TEXT NOT NULL DEFAULT '',
      specs_json      TEXT NOT NULL DEFAULT '',
      cover_data_url  TEXT NOT NULL DEFAULT '',
      theme           TEXT NOT NULL DEFAULT '',
      source          TEXT NOT NULL DEFAULT 'juli3ta',
      audio_kind      TEXT NOT NULL DEFAULT 'data_url',
      external_id     TEXT NOT NULL DEFAULT '',
      external_url    TEXT NOT NULL DEFAULT '',
      thumbnail_url   TEXT NOT NULL DEFAULT '',
      artist          TEXT NOT NULL DEFAULT '',
      album           TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_app_music_creator_tracks_created
      ON app_music_creator_tracks(created_at DESC);
  `);
};

const ensureAppMusicCreatorSettings = async (db: Db): Promise<void> => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_music_creator_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
};

// Mirror of the music-player package's 0001_library.sql — needed so
// the YouTube → library migration (cross-app concern landed here for
// boot-ordering reasons) has somewhere to write before the per-app
// DBs are bound.
const ensureAppMusicPlayerLibraryTracks = async (db: Db): Promise<void> => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_music_player_library_tracks (
      id              TEXT PRIMARY KEY,
      provider        TEXT NOT NULL,
      external_id     TEXT NOT NULL,
      title           TEXT NOT NULL,
      artist          TEXT NOT NULL DEFAULT '',
      album           TEXT NOT NULL DEFAULT '',
      duration_ms     INTEGER NOT NULL DEFAULT 0,
      thumbnail_url   TEXT NOT NULL DEFAULT '',
      external_url    TEXT NOT NULL DEFAULT '',
      added_at        INTEGER NOT NULL,
      last_played_at  INTEGER NOT NULL DEFAULT 0
    );
  `);
};

// ── Step 1: copy music_creator_tracks → app_music_creator_tracks ──

// Read every column from the legacy table that exists in the V8 schema.
// SQLite's `INSERT INTO ... SELECT *` would also work, but using a
// named column list keeps the copy resilient to schema drift between
// the legacy and prefixed tables (column order doesn't matter).
const LEGACY_TRACK_COLUMNS = [
  'id', 'title', 'style_tags', 'lyrics_preview', 'duration_ms', 'bitrate',
  'sample_rate', 'size_bytes', 'created_at', 'audio_data_url', 'specs_json',
  'cover_data_url', 'theme', 'source', 'audio_kind', 'external_id',
  'external_url', 'thumbnail_url', 'artist', 'album',
] as const;

const importMusicCreatorTracks = async (db: Db): Promise<number> => {
  if (await flagSet(db, FLAG_TRACKS_IMPORTED)) return 0;
  if (!(await tableExists(db, 'music_creator_tracks'))) {
    // Legacy never created — first-run-on-fresh-OPFS install. Mark
    // the flag so we don't re-probe on every boot.
    await recordFlag(db, FLAG_TRACKS_IMPORTED);
    return 0;
  }
  await ensureAppMusicCreatorTracks(db);
  // Copy all rows. INSERT OR IGNORE so a re-run-without-flag (e.g.
  // someone manually deletes the flag row to retry) doesn't error
  // on PK collisions.
  const cols = LEGACY_TRACK_COLUMNS.join(', ');
  await db.exec(
    `INSERT OR IGNORE INTO app_music_creator_tracks (${cols})
       SELECT ${cols} FROM music_creator_tracks`,
  );
  // Count what we just imported. Used by the test + console.info.
  const rows = await db.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM app_music_creator_tracks',
  );
  const n = Number(rows[0]?.n ?? 0);
  // Drop the legacy table — workspace package can't see it anyway,
  // and leaving it around would confuse the next migration audit.
  await db.exec('DROP TABLE IF EXISTS music_creator_tracks');
  await recordFlag(db, FLAG_TRACKS_IMPORTED);
  return n;
};

// ── Step 2: copy music_creator_settings → app_music_creator_settings ──

const importMusicCreatorSettings = async (db: Db): Promise<number> => {
  if (await flagSet(db, FLAG_SETTINGS_IMPORTED)) return 0;
  if (!(await tableExists(db, 'music_creator_settings'))) {
    await recordFlag(db, FLAG_SETTINGS_IMPORTED);
    return 0;
  }
  await ensureAppMusicCreatorSettings(db);
  await db.exec(
    `INSERT OR IGNORE INTO app_music_creator_settings (key, value)
       SELECT key, value FROM music_creator_settings`,
  );
  const rows = await db.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM app_music_creator_settings',
  );
  const n = Number(rows[0]?.n ?? 0);
  await db.exec('DROP TABLE IF EXISTS music_creator_settings');
  await recordFlag(db, FLAG_SETTINGS_IMPORTED);
  return n;
};

// ── Step 3: cross-app — YouTube creator rows → music-player library ──
//
// Originally `migrateCreatorYoutubeRowsToLibrary` in
// app/src/lib/repo/musicLibrary.ts. After the per-app prefixing both
// SOURCE and DEST table names change AND the migration crosses a
// package boundary, so it lands here in the shell shim where it can
// see both prefixes.
//
// Idempotent: a flag in `migration_flags` records that we've run
// once. Subsequent boots short-circuit.

const importYoutubeCreatorRowsToLibrary = async (db: Db): Promise<number> => {
  if (await flagSet(db, FLAG_YT_TO_LIBRARY)) return 0;
  // Source table is the per-app one created by step 1. If step 1
  // didn't run (no legacy data) the table may still not exist —
  // `tableExists` short-circuits cleanly.
  if (!(await tableExists(db, 'app_music_creator_tracks'))) {
    await recordFlag(db, FLAG_YT_TO_LIBRARY);
    return 0;
  }
  // Destination table comes from the music-player package's per-app
  // migrate. If the music-player package hasn't been seeded yet
  // (manifest landed but its migrations haven't run) we ensure the
  // table exists so this step doesn't have a bind-order dependency.
  await ensureAppMusicPlayerLibraryTracks(db);
  const rows = await db.query<{
    id: string;
    title: string;
    duration_ms: number;
    created_at: number;
    external_id: string;
    external_url: string;
    thumbnail_url: string;
    artist: string;
    album: string;
  }>(
    `SELECT id, title, duration_ms, created_at, external_id, external_url,
            thumbnail_url, artist, album
       FROM app_music_creator_tracks
      WHERE source = 'youtube' AND external_id <> ''`,
  );
  for (const row of rows) {
    await db.run(
      `INSERT OR IGNORE INTO app_music_player_library_tracks
         (id, provider, external_id, title, artist, album, duration_ms,
          thumbnail_url, external_url, added_at, last_played_at)
       VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        row.id,
        row.external_id,
        row.title,
        row.artist,
        row.album,
        row.duration_ms,
        row.thumbnail_url,
        row.external_url,
        row.created_at,
      ] satisfies SqlValue[],
    );
  }
  await recordFlag(db, FLAG_YT_TO_LIBRARY);
  return rows.length;
};

// ── Public entrypoint ────────────────────────────────────────

export interface LegacyMigrationResult {
  /** Track rows copied from `music_creator_tracks` (0 if no legacy). */
  tracksImported: number;
  /** Settings rows copied from `music_creator_settings` (0 if no legacy). */
  settingsImported: number;
  /** YouTube rows promoted into the music-player library (0 if none). */
  youtubeToLibraryImported: number;
}

/**
 * Run every legacy-data migration step, in order. Idempotent: each
 * step records a flag in `migration_flags` so re-runs are no-ops.
 *
 * Call this from the shell's boot path AFTER `initDb()` and BEFORE
 * any per-app DB binds (i.e. before `seedBundledAppsAtBoot`).
 *
 * Failure of any single step is non-fatal at the call site — the
 * function throws but `main.tsx` catches and logs, mirroring the
 * existing seed failure-mode.
 */
export async function migrateLegacyMusicCreatorTables(
  db: Db,
): Promise<LegacyMigrationResult> {
  const tracksImported = await importMusicCreatorTracks(db);
  const settingsImported = await importMusicCreatorSettings(db);
  const youtubeToLibraryImported = await importYoutubeCreatorRowsToLibrary(db);
  return {
    tracksImported,
    settingsImported,
    youtubeToLibraryImported,
  };
}
