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
export const WORKSPACE_APP_VERSION = '0.4.22';
export const WORKSPACE_APP_MANIFEST_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-atomek@v0.4.22/tytus-app.json';
export const WORKSPACE_APP_ENTRY_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-atomek@v0.4.22/dist/index.js';

export const WORKSPACE_APP_MANIFEST: Manifest = {
  $schema: 'https://tytus.traylinx.com/schema/app/v1.json',
  id: WORKSPACE_APP_ID,
  name: 'Atomek',
  version: WORKSPACE_APP_VERSION,
  icon: 'atomek:mark',
  category: 'Productivity',
  description:
    'Branded Tytus Resource Fabric cockpit with persistent workspace state, embedded docs for OpenClaw/Hermes pods, local agents, shared folders, app skills, files, chat, artifacts, and approval-gated outputs.',
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
    agentSkills: [
      { id: 'atomek.docs-resource-fabric', title: 'Explain Tytus Resource Fabric', description: 'Explain how local computer, pods, shared folders, OpenClaw/Hermes, local agents, app skills, channels, and AIL routes work together.', driver: 'host-api', skillUrl: 'skills/atomek.docs-resource-fabric.md', triggers: ['resource fabric', 'tytus', 'mission', 'orchestration'] },
      { id: 'atomek.docs-openclaw-hermes', title: 'Explain OpenClaw and Hermes', description: 'Explain how OpenClaw, Hermes, and local agents cooperate through missions and shared folders.', driver: 'host-api', skillUrl: 'skills/atomek.docs-openclaw-hermes.md', triggers: ['openclaw', 'hermes', 'agents', 'pods'] },
      { id: 'atomek.docs-shared-folders', title: 'Explain shared folders', description: 'Explain shared folders, mission folders, pod inbox/outbox, Garage bindings, and file handoff rules.', driver: 'host-api', skillUrl: 'skills/atomek.docs-shared-folders.md', triggers: ['shared folders', 'mission folder', 'handoff', 'files'] },
      { id: 'atomek.docs-use-cases', title: 'Explain Tytus use cases', description: 'Explain practical Tytus agent-team workflows for repo repair, documents, creative production, app automation, and research.', driver: 'host-api', skillUrl: 'skills/atomek.docs-use-cases.md', triggers: ['use cases', 'workflow', 'repo repair', 'creative production'] },
    ],
  },
};

const isLegacyWorkspaceRow = (row: InstalledAppRow): boolean =>
  row.id === LEGACY_WORKSPACE_APP_ID ||
  row.manifest.id === LEGACY_WORKSPACE_APP_ID ||
  row.manifest.name === 'Tytus Forge' ||
  Boolean(row.entryUrl?.includes('/tytus-app-forge@')) ||
  Boolean(row.manifestUrl?.includes('/tytus-app-forge@'));

const versionParts = (version: string): number[] =>
  version
    .split(/[^0-9]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10));

const isVersionBefore = (actual: string, minimum: string): boolean => {
  const a = versionParts(actual);
  const b = versionParts(minimum);
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
};

const isOutdatedWorkspaceRow = (row: InstalledAppRow): boolean => {
  if (row.id !== WORKSPACE_APP_ID) return false;
  const joinedUrls = `${row.entryUrl ?? ''} ${row.manifestUrl ?? ''}`;
  return (
    isVersionBefore(row.manifest.version ?? '', WORKSPACE_APP_VERSION) ||
    /tytus-app-forge@/i.test(joinedUrls) ||
    /tytus-app-atomek@v0\.(?:[0-2]|3\.[0-9]|4\.[0-2])\b/i.test(joinedUrls)
  );
};

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
