/**
 * One-shot cleanup: uninstall incomplete standalone JULI3TA rows.
 *
 * `tytus-app-juli3ta@v0.0.2-alpha.1` and `v0.1.x` were briefly
 * auto-installed by early Featured-apps experiments. Those builds were
 * placeholder UIs; they are NOT Sebastian's full JULI3TA product. The
 * verified standalone extraction starts at v0.2.x and must survive this
 * sweep.
 *
 * Shipping both leaves the launcher with two icons that look like the
 * same product, plus a duplicate row in Frequently Used. This module
 * deletes incomplete standalone rows on boot — safe because those
 * releases only wrote placeholder draft rows and never owned the verified
 * JULI3TA track library.
 *
 * Idempotent. Keep the version guard until every user with a stale
 * v0.0/v0.1 row has crossed one boot on a cleanup-capable build.
 */

import {
  deleteInstalledApp,
  getInstalledApp,
  updateInstalledApp,
} from './installed-apps-repo';
import { removeFromInstalledAppsCache } from './installed-apps-cache';
import { notifyInstalledAppsChanged } from './installed-apps-events';
import type { Db } from '@/lib/db/types';
import type { Manifest } from '@tytus/host-api';

const INCOMPLETE_VERSION_PREFIXES = ['0.0.', '0.1.'];

const JULI3TA_GATEWAY_FIX_VERSION = '0.3.8';
const JULI3TA_GATEWAY_FIX_MANIFEST_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-juli3ta@juli3ta-0.3.8/tytus-app.json';
const JULI3TA_GATEWAY_FIX_ENTRY_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-juli3ta@juli3ta-0.3.8/dist/index.js';

const JULI3TA_GATEWAY_FIX_MANIFEST: Manifest = {
  $schema: 'https://tytus.traylinx.com/schema/app/v1.json',
  id: 'juli3ta',
  name: 'JULI3TA',
  version: JULI3TA_GATEWAY_FIX_VERSION,
  icon: 'juli3ta:mark',
  category: 'Creative',
  description:
    'JULI3TA — full AI-native music creator for Tytus OS. Create songs, lyrics, covers, and manage your local music workbench.',
  window: {
    defaultSize: { width: 1100, height: 760 },
    minSize: { width: 720, height: 540 },
  },
  permissions: [
    'vfs.user.music',
    'daemon.read',
    'daemon.network',
    'storage.app',
    'shell.openWindow',
    'shell.notifications',
    'shell.menu',
  ],
  storage: {
    tables: [
      { name: 'tracks', schema: 'migrations/0002_legacy_compat_tables.sql' },
      { name: 'settings', schema: 'migrations/0002_legacy_compat_tables.sql' },
      { name: 'voice-recordings', schema: 'migrations/0002_legacy_compat_tables.sql' },
      { name: 'music-library', schema: 'migrations/0002_legacy_compat_tables.sql' },
      { name: 'music-playlists', schema: 'migrations/0002_legacy_compat_tables.sql' },
    ],
  },
  entry: { url: JULI3TA_GATEWAY_FIX_ENTRY_URL },
};

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

export interface JuliAlphaCleanupReport {
  removed: boolean;
  /** Why the cleanup ran or was skipped — useful in tests + console. */
  reason: string;
}

export async function cleanupJuli3taAlphaIfPresent(
  db: Db,
): Promise<JuliAlphaCleanupReport> {
  const row = await getInstalledApp(db, 'juli3ta');
  if (!row) return { removed: false, reason: 'no juli3ta row' };

  // Only touch incomplete standalone rows. A future real lift must ship
  // as v0.2+ (or remove this guard in the same PR) after verified migration.
  const version = row.manifest.version ?? '';
  if (!INCOMPLETE_VERSION_PREFIXES.some((prefix) => version.startsWith(prefix))) {
    return { removed: false, reason: `version ${version} is not incomplete standalone` };
  }

  await deleteInstalledApp(db, 'juli3ta');
  removeFromInstalledAppsCache('juli3ta');
  notifyInstalledAppsChanged();
  return { removed: true, reason: `removed incomplete standalone ${version}` };
}

export interface JuliGatewayFixUpgradeReport {
  upgraded: boolean;
  reason: string;
}

export async function upgradeJuli3taGatewayFixIfStale(
  db: Db,
): Promise<JuliGatewayFixUpgradeReport> {
  const row = await getInstalledApp(db, 'juli3ta');
  if (!row) return { upgraded: false, reason: 'no juli3ta row' };
  if (row.kind !== 'installed') {
    return { upgraded: false, reason: `kind ${row.kind} is not installed` };
  }

  const version = row.manifest.version ?? '';
  if (!isVersionBefore(version, JULI3TA_GATEWAY_FIX_VERSION)) {
    return { upgraded: false, reason: `version ${version} is current` };
  }

  await updateInstalledApp(db, 'juli3ta', {
    manifest: JULI3TA_GATEWAY_FIX_MANIFEST,
    entryUrl: JULI3TA_GATEWAY_FIX_ENTRY_URL,
    assetsUrl: null,
    manifestUrl: JULI3TA_GATEWAY_FIX_MANIFEST_URL,
  });
  notifyInstalledAppsChanged();
  return {
    upgraded: true,
    reason: `upgraded juli3ta ${version || 'unknown'} to ${JULI3TA_GATEWAY_FIX_VERSION}`,
  };
}
