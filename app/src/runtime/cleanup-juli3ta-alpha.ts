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
