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
export const WORKSPACE_APP_VERSION = '0.3.8';
export const WORKSPACE_APP_MANIFEST_URL =
  'https://raw.githubusercontent.com/traylinx/tytus-app-atomek/v0.3.8/tytus-app.json';
export const WORKSPACE_APP_ENTRY_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-atomek@v0.3.8/dist/index.js';

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
    'ai.chat',
    'ai.memory.read',
    'ai.memory.write',
    'ai.artifacts',
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

const isOutdatedWorkspaceRow = (row: InstalledAppRow): boolean =>
  row.id === WORKSPACE_APP_ID &&
  (row.manifest.version !== WORKSPACE_APP_VERSION ||
    row.entryUrl !== WORKSPACE_APP_ENTRY_URL ||
    row.manifestUrl !== WORKSPACE_APP_MANIFEST_URL);

export function coerceWorkspaceRebrandRow(row: InstalledAppRow): InstalledAppRow {
  if (!isLegacyWorkspaceRow(row) && !isOutdatedWorkspaceRow(row)) return row;
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

async function writeWorkspaceRow(
  db: Db,
  targetId: string,
  row: InstalledAppRow,
): Promise<void> {
  const args: SqlValue[] = [
    row.id,
    row.kind,
    JSON.stringify(row.manifest),
    row.entryUrl,
    row.assetsUrl,
    row.manifestUrl,
    row.enabled ? 1 : 0,
    row.builtinProtected ? 1 : 0,
    targetId,
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
}

export async function migrateWorkspaceRebrandIfPresent(
  db: Db,
): Promise<WorkspaceRebrandMigrationReport> {
  const legacy = await getInstalledApp(db, LEGACY_WORKSPACE_APP_ID);
  const canonical = await getInstalledApp(db, WORKSPACE_APP_ID);

  if (canonical) {
    const current = coerceWorkspaceRebrandRow(canonical);
    if (isOutdatedWorkspaceRow(canonical)) {
      await writeWorkspaceRow(db, WORKSPACE_APP_ID, current);
      addToInstalledAppsCache(current);
    } else {
      addToInstalledAppsCache(canonical);
    }

    if (legacy) {
      await deleteInstalledApp(db, LEGACY_WORKSPACE_APP_ID);
      removeFromInstalledAppsCache(LEGACY_WORKSPACE_APP_ID);
      notifyInstalledAppsChanged();
      return {
        migrated: true,
        reason: isOutdatedWorkspaceRow(canonical)
          ? `updated ${WORKSPACE_APP_ID} to ${WORKSPACE_APP_VERSION} and removed duplicate legacy workspace row`
          : 'removed duplicate legacy workspace row',
      };
    }

    if (isOutdatedWorkspaceRow(canonical)) {
      notifyInstalledAppsChanged();
      return {
        migrated: true,
        reason: `updated ${WORKSPACE_APP_ID} to ${WORKSPACE_APP_VERSION}`,
      };
    }

    return { migrated: false, reason: 'workspace row already current' };
  }

  if (!legacy) {
    return { migrated: false, reason: 'no legacy workspace row' };
  }

  const migrated = coerceWorkspaceRebrandRow(legacy);
  await writeWorkspaceRow(db, LEGACY_WORKSPACE_APP_ID, migrated);

  removeFromInstalledAppsCache(LEGACY_WORKSPACE_APP_ID);
  addToInstalledAppsCache(migrated);
  notifyInstalledAppsChanged();
  return {
    migrated: true,
    reason: `migrated ${LEGACY_WORKSPACE_APP_ID} to ${WORKSPACE_APP_ID} ${WORKSPACE_APP_VERSION}`,
  };
}
