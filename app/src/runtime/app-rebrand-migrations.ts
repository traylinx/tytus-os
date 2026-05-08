/**
 * Boot/runtime repair for product rebrands.
 *
 * Existing users can have stale `installed_apps` rows pinned to immutable
 * old CDN tags, plus open-window localStorage entries with old ids/titles.
 * Catalog publication alone cannot repair either one.
 */

import type { Manifest } from '@tytus/host-api';
import type { Db, SqlValue } from '@/lib/db/types';
import {
  deleteInstalledApp,
  getInstalledApp,
  type InstalledAppRow,
} from './installed-apps-repo';
import {
  addToInstalledAppsCache,
  removeFromInstalledAppsCache,
} from './installed-apps-cache';
import { notifyInstalledAppsChanged } from './installed-apps-events';

export const WORKSPACE_APP_ID = 'atomek';
export const LEGACY_WORKSPACE_APP_ID = 'forge';
export const WORKSPACE_APP_VERSION = '0.2.1';
export const WORKSPACE_APP_MANIFEST_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-atomek@v0.2.1/tytus-app.json';
export const WORKSPACE_APP_ENTRY_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-atomek@v0.2.1/dist/index.js';

export const WORKSPACE_APP_MANIFEST: Manifest = {
  $schema: 'https://tytus.traylinx.com/schema/app/v1.json',
  id: WORKSPACE_APP_ID,
  name: 'Atomek',
  version: WORKSPACE_APP_VERSION,
  icon: 'Sparkles',
  category: 'Productivity',
  description:
    'Monaco workspace with local files, chat/output panels, extension connectors, markdown preview, and search.',
  window: {
    defaultSize: { width: 1200, height: 780 },
    minSize: { width: 760, height: 520 },
  },
  permissions: [
    'daemon.read',
    'daemon.network',
    'vfs.user.documents',
    'shell.notifications',
    'shell.dock',
  ],
  entry: { url: WORKSPACE_APP_ENTRY_URL },
  contributes: {
    fileAssociations: [
      { extension: '.md', mimeType: 'text/markdown' },
      { extension: '.txt', mimeType: 'text/plain' },
      { extension: '.json', mimeType: 'application/json' },
      { extension: '.csv', mimeType: 'text/csv' },
      { extension: '.ts', mimeType: 'text/typescript' },
      { extension: '.tsx', mimeType: 'text/typescript-jsx' },
      { extension: '.js', mimeType: 'text/javascript' },
      { extension: '.css', mimeType: 'text/css' },
      { extension: '.html', mimeType: 'text/html' },
    ],
  },
};

const isLegacyWorkspaceRow = (row: InstalledAppRow): boolean =>
  row.id === LEGACY_WORKSPACE_APP_ID ||
  row.manifest.id === LEGACY_WORKSPACE_APP_ID ||
  row.manifest.name === 'Tytus Forge' ||
  Boolean(row.entryUrl?.includes('/tytus-app-forge@')) ||
  Boolean(row.manifestUrl?.includes('/tytus-app-forge@'));

export function coerceWorkspaceRebrandRow(row: InstalledAppRow): InstalledAppRow {
  if (!isLegacyWorkspaceRow(row)) return row;
  return {
    ...row,
    id: WORKSPACE_APP_ID,
    kind: 'installed',
    manifest: WORKSPACE_APP_MANIFEST,
    entryUrl: WORKSPACE_APP_ENTRY_URL,
    assetsUrl: null,
    manifestUrl: WORKSPACE_APP_MANIFEST_URL,
    enabled: true,
    builtinProtected: false,
  };
}

export interface WorkspaceRebrandMigrationReport {
  migrated: boolean;
  reason: string;
}

export async function migrateWorkspaceRebrandIfPresent(
  db: Db,
): Promise<WorkspaceRebrandMigrationReport> {
  const legacy = await getInstalledApp(db, LEGACY_WORKSPACE_APP_ID);
  if (!legacy) {
    return { migrated: false, reason: 'no legacy workspace row' };
  }

  const canonical = await getInstalledApp(db, WORKSPACE_APP_ID);
  if (canonical) {
    await deleteInstalledApp(db, LEGACY_WORKSPACE_APP_ID);
    removeFromInstalledAppsCache(LEGACY_WORKSPACE_APP_ID);
    addToInstalledAppsCache(canonical);
    notifyInstalledAppsChanged();
    return { migrated: true, reason: 'removed duplicate legacy workspace row' };
  }

  const migrated = coerceWorkspaceRebrandRow(legacy);
  const args: SqlValue[] = [
    migrated.id,
    migrated.kind,
    JSON.stringify(migrated.manifest),
    migrated.entryUrl,
    migrated.assetsUrl,
    migrated.manifestUrl,
    migrated.enabled ? 1 : 0,
    migrated.builtinProtected ? 1 : 0,
    LEGACY_WORKSPACE_APP_ID,
  ];
  await db.run(
    `UPDATE installed_apps
        SET id = ?,
            kind = ?,
            manifest_json = ?,
            entry_url = ?,
            assets_url = ?,
            manifest_url = ?,
            enabled = ?,
            builtin_protected = ?
      WHERE id = ?`,
    args,
  );

  removeFromInstalledAppsCache(LEGACY_WORKSPACE_APP_ID);
  addToInstalledAppsCache(migrated);
  notifyInstalledAppsChanged();
  return {
    migrated: true,
    reason: `migrated ${LEGACY_WORKSPACE_APP_ID} to ${WORKSPACE_APP_ID} ${WORKSPACE_APP_VERSION}`,
  };
}
