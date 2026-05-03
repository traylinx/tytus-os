/**
 * Typed accessor for the `installed_apps` SQLite table (SCHEMA_V12).
 *
 * Shell-private state — apps don't see this surface; the loader,
 * registry seeder, and forSharedKey resolver use it. Apps go through
 * `host.storage.current()` for their OWN tables; never through here.
 *
 * Per spec §"installed_apps SQLite schema (M1 deliverable)" /
 * 01-host-api.md.
 */

import type { Db, SqlValue } from '@/lib/db/types';
import type { AppKind, Manifest } from '@tytus/host-api';

export interface InstalledAppRow {
  id: string;
  kind: AppKind;
  manifest: Manifest;
  entryUrl: string | null;
  assetsUrl: string | null;
  installedAt: number;
  enabled: boolean;
  builtinProtected: boolean;
}

const BUILT_IN_PROTECTED = new Set([
  'sheet',
  'studio',
  'memo',
  'music-creator',
  'music-player',
  'voice-recorder',
]);

/** Read every row from installed_apps. Used by the App Store UI (M5)
 *  + by forSharedKey resolution. */
export async function listInstalledApps(db: Db): Promise<InstalledAppRow[]> {
  const rows = await db.query<{
    id: string;
    kind: AppKind;
    manifest_json: string;
    entry_url: string | null;
    assets_url: string | null;
    installed_at: number;
    enabled: number;
    builtin_protected: number;
  }>(
    'SELECT id, kind, manifest_json, entry_url, assets_url, installed_at, enabled, builtin_protected FROM installed_apps',
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    manifest: JSON.parse(r.manifest_json) as Manifest,
    entryUrl: r.entry_url,
    assetsUrl: r.assets_url,
    installedAt: r.installed_at,
    enabled: !!r.enabled,
    builtinProtected: !!r.builtin_protected,
  }));
}

/** Read one installed_apps row by id. */
export async function getInstalledApp(
  db: Db,
  id: string,
): Promise<InstalledAppRow | null> {
  const rows = await db.query<{
    id: string;
    kind: AppKind;
    manifest_json: string;
    entry_url: string | null;
    assets_url: string | null;
    installed_at: number;
    enabled: number;
    builtin_protected: number;
  }>(
    'SELECT id, kind, manifest_json, entry_url, assets_url, installed_at, enabled, builtin_protected FROM installed_apps WHERE id = ?',
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    manifest: JSON.parse(r.manifest_json) as Manifest,
    entryUrl: r.entry_url,
    assetsUrl: r.assets_url,
    installedAt: r.installed_at,
    enabled: !!r.enabled,
    builtinProtected: !!r.builtin_protected,
  };
}

/**
 * Idempotent seed of the bundled-app rows. Called by the shell at boot
 * (M5+). Re-asserts manifest_json on every boot so a Tytus update
 * with newer bundled-app manifests propagates without manual
 * intervention.
 */
export async function seedInstalledApps(
  db: Db,
  bundled: Array<{
    manifest: Manifest;
    entryUrl: string | null;
    assetsUrl: string | null;
  }>,
  now: () => number = () => Date.now(),
): Promise<void> {
  for (const b of bundled) {
    const builtinProtected = BUILT_IN_PROTECTED.has(b.manifest.id) ? 1 : 0;
    const args: SqlValue[] = [
      b.manifest.id,
      'bundled',
      JSON.stringify(b.manifest),
      b.entryUrl,
      b.assetsUrl,
      now(),
      1,
      builtinProtected,
    ];
    // INSERT … ON CONFLICT DO UPDATE — re-assert manifest_json + entry +
    // assets on every boot so an OS update lands new metadata cleanly.
    await db.run(
      `INSERT INTO installed_apps
         (id, kind, manifest_json, entry_url, assets_url, installed_at, enabled, builtin_protected)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         manifest_json = excluded.manifest_json,
         entry_url = excluded.entry_url,
         assets_url = excluded.assets_url`,
      args,
    );
  }
}

/**
 * Resolve every shared-table physical name a given app may read.
 *
 * Cross-app sharing requires both sides to declare:
 *   - Owner manifest:  storage.shares: { <key>: 'app_owner_table' }
 *   - Reader manifest: permissions: ['storage.shared.<key>']
 *
 * This function reads installed_apps, finds every key the reader is
 * permitted to consume, looks up the owner's physical table for each,
 * and returns the de-duplicated set. The reader's AppDb gets these
 * names threaded into `sharedTableNames` so the prefix guard accepts
 * them.
 */
export async function resolveSharedTableNames(
  db: Db,
  readerAppId: string,
): Promise<string[]> {
  const installed = await listInstalledApps(db);
  const reader = installed.find((row) => row.id === readerAppId);
  if (!reader) return [];

  const requestedKeys = new Set<string>();
  for (const perm of reader.manifest.permissions ?? []) {
    if (perm.startsWith('storage.shared.')) {
      requestedKeys.add(perm.slice('storage.shared.'.length));
    }
  }
  if (requestedKeys.size === 0) return [];

  const tables = new Set<string>();
  for (const row of installed) {
    if (row.id === readerAppId) continue;
    const shares = row.manifest.storage?.shares;
    if (!shares) continue;
    for (const [key, table] of Object.entries(shares)) {
      if (requestedKeys.has(key)) tables.add(table);
    }
  }
  return [...tables].sort();
}
