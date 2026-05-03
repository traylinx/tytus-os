// Tests for the one-shot legacy-data migration that lifts
// music_creator_* rows into the per-app prefixed namespace before
// the per-app DB binds.
//
// We can't run the real sqlite-wasm worker in vitest (no OPFS in
// happy-dom), but the migration code is pure SQL against the shared
// `Db` interface — so we use a minimal in-memory fake that
// implements just enough SQL to exercise the migration path:
//
//   - `CREATE TABLE`, `DROP TABLE`, `CREATE INDEX` (parsed loosely)
//   - `INSERT INTO ... SELECT ...` cross-table copy
//   - `INSERT OR IGNORE INTO ... VALUES (...)`
//   - Parameterised SELECT against `sqlite_master`,
//     `migration_flags`, `app_music_creator_tracks`,
//     `app_music_player_library_tracks`
//
// The fake is intentionally narrow: only the SQL shapes the
// migration emits are recognised. Anything else is a no-op so we
// fail loudly if the migration grows new SQL we haven't taught the
// fake to handle.

import { describe, expect, it } from 'vitest';
import { migrateLegacyMusicCreatorTables } from './legacy-migrations';
import type { Db, SqlValue } from '@/lib/db/types';

interface Row {
  [col: string]: SqlValue;
}

class MemoryDb implements Db {
  private tables = new Map<string, Row[]>();

  // Test helpers — present rows + tables before the migration runs.
  seedTable(name: string): void {
    if (!this.tables.has(name)) this.tables.set(name, []);
  }
  seedRow(name: string, row: Row): void {
    this.seedTable(name);
    this.tables.get(name)!.push({ ...row });
  }
  rowsOf(name: string): Row[] {
    return this.tables.get(name) ?? [];
  }
  hasTable(name: string): boolean {
    return this.tables.has(name);
  }

  async exec(sql: string): Promise<void> {
    // Trim out comments + collapse whitespace so our regex matches
    // multi-statement strings reliably.
    const stmts = sql
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of stmts) {
      await this.execOne(stmt);
    }
  }

  private async execOne(stmt: string): Promise<void> {
    let m: RegExpExecArray | null;
    if ((m = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i.exec(stmt))) {
      this.seedTable(m[1]);
      return;
    }
    if ((m = /^DROP\s+TABLE\s+IF\s+EXISTS\s+(\w+)/i.exec(stmt))) {
      this.tables.delete(m[1]);
      return;
    }
    if (/^CREATE\s+INDEX/i.test(stmt)) return; // ignored in fake
    // INSERT OR IGNORE INTO dest (cols...) SELECT cols... FROM src
    if (
      (m = /^INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s+SELECT\s+([^F]+?)\s+FROM\s+(\w+)\s*$/i.exec(stmt))
    ) {
      const [, dest, destColsStr, srcColsStr, src] = m;
      const destCols = destColsStr.split(',').map((s) => s.trim());
      const srcCols = srcColsStr.split(',').map((s) => s.trim());
      this.seedTable(dest);
      const destRows = this.tables.get(dest)!;
      const seenIds = new Set<SqlValue>(destRows.map((r) => r.id));
      for (const row of this.rowsOf(src)) {
        const newRow: Row = {};
        for (let i = 0; i < destCols.length; i++) {
          newRow[destCols[i]] = row[srcCols[i]] ?? null;
        }
        if (newRow.id !== undefined && seenIds.has(newRow.id)) continue;
        destRows.push(newRow);
        if (newRow.id !== undefined) seenIds.add(newRow.id);
      }
      return;
    }
    // Other DDL/DML strings are not expected here.
    throw new Error(`MemoryDb.exec: unsupported statement: ${stmt}`);
  }

  async query<T>(sql: string, bindings: SqlValue[] = []): Promise<T[]> {
    let m: RegExpExecArray | null;
    if (
      /SELECT\s+COUNT\s*\(\s*\*\s*\)\s+AS\s+n\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*\?/i.test(sql)
    ) {
      const [name] = bindings as [string];
      return [{ n: this.hasTable(name) ? 1 : 0 }] as unknown as T[];
    }
    if (
      /SELECT\s+COUNT\s*\(\s*\*\s*\)\s+AS\s+n\s+FROM\s+migration_flags\s+WHERE\s+key\s*=\s*\?/i.test(sql)
    ) {
      const [key] = bindings as [string];
      const n = this.rowsOf('migration_flags').filter((r) => r.key === key).length;
      return [{ n }] as unknown as T[];
    }
    if (
      (m = /SELECT\s+COUNT\s*\(\s*\*\s*\)\s+AS\s+n\s+FROM\s+(\w+)\s*$/i.exec(sql))
    ) {
      return [{ n: this.rowsOf(m[1]).length }] as unknown as T[];
    }
    if (
      /SELECT\s+id,\s+title,\s+duration_ms[\s\S]+FROM\s+app_music_creator_tracks[\s\S]+WHERE\s+source\s*=\s*'youtube'/i.test(sql)
    ) {
      return this.rowsOf('app_music_creator_tracks').filter(
        (r) => r.source === 'youtube' && r.external_id !== '',
      ) as unknown as T[];
    }
    return [];
  }

  async run(sql: string, bindings: SqlValue[] = []): Promise<void> {
    let m: RegExpExecArray | null;
    if (
      (m = /^INSERT\s+OR\s+IGNORE\s+INTO\s+migration_flags\s*\(key,\s*ts\)\s+VALUES\s*\(\?,\s*\?\)/i.exec(sql))
    ) {
      void m;
      const [key, ts] = bindings as [string, number];
      this.seedTable('migration_flags');
      const rows = this.tables.get('migration_flags')!;
      if (!rows.some((r) => r.key === key)) {
        rows.push({ key, ts });
      }
      return;
    }
    if (
      (m = /^INSERT\s+OR\s+IGNORE\s+INTO\s+app_music_player_library_tracks\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i.exec(sql))
    ) {
      const cols = m[1].split(',').map((s) => s.trim());
      const placeholders = m[2].split(',').map((s) => s.trim());
      this.seedTable('app_music_player_library_tracks');
      const rows = this.tables.get('app_music_player_library_tracks')!;
      const newRow: Row = {};
      let bindingIdx = 0;
      for (let i = 0; i < cols.length; i++) {
        const ph = placeholders[i];
        if (ph === '?') {
          newRow[cols[i]] = bindings[bindingIdx++] ?? null;
        } else {
          // Literal in the SQL — strip surrounding quotes (string)
          // or parse as number for bare numeric literals.
          const stripped = ph.replace(/^'|'$/g, '');
          newRow[cols[i]] = ph.startsWith("'")
            ? stripped
            : /^-?\d+(?:\.\d+)?$/.test(stripped) ? Number(stripped) : stripped;
        }
      }
      if (newRow.id !== undefined && rows.some((r) => r.id === newRow.id)) return;
      rows.push(newRow);
      return;
    }
    throw new Error(`MemoryDb.run: unsupported statement: ${sql}`);
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

const seedV1Tables = (db: MemoryDb): void => {
  db.seedTable('migration_flags');
};

const sampleTrackRow = (overrides: Partial<Row> = {}): Row => ({
  id: 't_1',
  title: 'Track 1',
  style_tags: 'pop',
  lyrics_preview: 'la la',
  duration_ms: 180_000,
  bitrate: 192,
  sample_rate: 44_100,
  size_bytes: 4_000_000,
  created_at: 1_700_000_000_000,
  audio_data_url: 'data:audio/mp3;base64,xxx',
  specs_json: '',
  cover_data_url: '',
  theme: '',
  source: 'juli3ta',
  audio_kind: 'data_url',
  external_id: '',
  external_url: '',
  thumbnail_url: '',
  artist: '',
  album: '',
  ...overrides,
});

describe('migrateLegacyMusicCreatorTables', () => {
  it('is a no-op when no legacy tables exist', async () => {
    const db = new MemoryDb();
    seedV1Tables(db);
    const result = await migrateLegacyMusicCreatorTables(db);
    expect(result).toEqual({
      tracksImported: 0,
      settingsImported: 0,
      youtubeToLibraryImported: 0,
    });
    // Both flags are recorded so subsequent boots skip the probe.
    const flags = db.rowsOf('migration_flags').map((r) => r.key);
    expect(flags).toContain('music_creator_tracks_imported');
    expect(flags).toContain('music_creator_settings_imported');
    expect(flags).toContain('youtube_creator_to_library_imported');
  });

  it('copies legacy tracks + settings into the prefixed tables and drops the originals', async () => {
    const db = new MemoryDb();
    seedV1Tables(db);
    db.seedRow('music_creator_tracks', sampleTrackRow({ id: 't_a', title: 'A' }));
    db.seedRow('music_creator_tracks', sampleTrackRow({ id: 't_b', title: 'B' }));
    db.seedRow('music_creator_settings', { key: 'music_creator_settings', value: '{"preferredPodId":"pod-1","overridesByEndpoint":{}}' });

    const result = await migrateLegacyMusicCreatorTables(db);
    expect(result.tracksImported).toBe(2);
    expect(result.settingsImported).toBe(1);

    // Rows landed in the prefixed tables.
    const tracks = db.rowsOf('app_music_creator_tracks');
    expect(tracks.map((r) => r.id).sort()).toEqual(['t_a', 't_b']);
    const settings = db.rowsOf('app_music_creator_settings');
    expect(settings).toHaveLength(1);
    expect(settings[0].key).toBe('music_creator_settings');

    // Legacy tables are gone.
    expect(db.hasTable('music_creator_tracks')).toBe(false);
    expect(db.hasTable('music_creator_settings')).toBe(false);
  });

  it('is idempotent — running twice does not double-import', async () => {
    const db = new MemoryDb();
    seedV1Tables(db);
    db.seedRow('music_creator_tracks', sampleTrackRow({ id: 't_a' }));
    db.seedRow('music_creator_settings', { key: 'k', value: '{}' });

    await migrateLegacyMusicCreatorTables(db);
    // Re-create the legacy tables with new rows — flag should still
    // skip them on the second run.
    db.seedRow('music_creator_tracks', sampleTrackRow({ id: 't_z' }));
    db.seedRow('music_creator_settings', { key: 'k2', value: '{}' });
    const second = await migrateLegacyMusicCreatorTables(db);

    expect(second).toEqual({
      tracksImported: 0,
      settingsImported: 0,
      youtubeToLibraryImported: 0,
    });
    // Prefixed-tables row count unchanged from first run.
    expect(db.rowsOf('app_music_creator_tracks').map((r) => r.id)).toEqual(['t_a']);
    expect(db.rowsOf('app_music_creator_settings')).toHaveLength(1);
  });

  it('promotes YouTube creator rows into the music-player library', async () => {
    const db = new MemoryDb();
    seedV1Tables(db);
    db.seedRow('music_creator_tracks', sampleTrackRow({
      id: 't_juli', source: 'juli3ta',
    }));
    db.seedRow('music_creator_tracks', sampleTrackRow({
      id: 'youtube:abc',
      title: 'YT Hit',
      source: 'youtube',
      external_id: 'abc',
      external_url: 'https://youtube.com/watch?v=abc',
      thumbnail_url: 'https://img/yt.jpg',
      duration_ms: 240_000,
      created_at: 1_700_000_000_000,
      artist: 'Some Channel',
      album: '',
    }));

    const result = await migrateLegacyMusicCreatorTables(db);
    expect(result.youtubeToLibraryImported).toBe(1);

    const libRows = db.rowsOf('app_music_player_library_tracks');
    expect(libRows).toHaveLength(1);
    expect(libRows[0]).toMatchObject({
      id: 'youtube:abc',
      provider: 'youtube',
      external_id: 'abc',
      title: 'YT Hit',
      duration_ms: 240_000,
      external_url: 'https://youtube.com/watch?v=abc',
      thumbnail_url: 'https://img/yt.jpg',
      added_at: 1_700_000_000_000,
      last_played_at: 0,
    });
  });
});
