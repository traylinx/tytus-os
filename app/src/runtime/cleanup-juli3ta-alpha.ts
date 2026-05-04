/**
 * One-shot cleanup: uninstall incomplete standalone JULI3TA rows.
 *
 * `tytus-app-juli3ta@v0.0.2-alpha.1` was briefly auto-installed by
 * commit b08b794 as part of the Featured-apps boot seed. The alpha
 * version is a placeholder UI (purple landing + "MY DRAFTS" panel +
 * "Open Music Creator" button); it is NOT the real product. The real
 * working app is the legacy in-tree Music Creator (`musiccreator`
 * registry id with launcher label "JULI3TA").
 *
 * Shipping both leaves the launcher with two icons that look like the
 * same product, plus a duplicate row in Frequently Used. This module
 * deletes incomplete standalone rows on boot — safe because the standalone releases only wrote draft rows and the working product/data lives in legacy `musiccreator`.
 *
 * Idempotent. Remove this only after the real 9k LOC JULI3TA lift ships with verified data migration from legacy `musiccreator`.
 */

import {
  deleteInstalledApp,
  getInstalledApp,
} from './installed-apps-repo';
import { removeFromInstalledAppsCache } from './installed-apps-cache';
import { notifyInstalledAppsChanged } from './installed-apps-events';
import type { Db } from '@/lib/db/types';

const INCOMPLETE_VERSION_PREFIXES = ['0.0.', '0.1.'];

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
