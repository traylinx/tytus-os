/**
 * One-shot cleanup: uninstall the JULI3TA alpha placeholder.
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
 * deletes the alpha row on boot — safe because the alpha never wrote
 * any meaningful data (drafts only, and the user never used them).
 *
 * Idempotent. Once the install lands a non-alpha v0.1.0 of
 * `tytus-app-juli3ta`, this cleanup becomes a no-op (the version
 * check below short-circuits). At that point the alpha cleanup can
 * be retired.
 */

import {
  deleteInstalledApp,
  getInstalledApp,
} from './installed-apps-repo';
import { removeFromInstalledAppsCache } from './installed-apps-cache';
import { notifyInstalledAppsChanged } from './installed-apps-events';
import type { Db } from '@/lib/db/types';

const ALPHA_VERSION_PREFIX = '0.0.';

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

  // Only touch alpha placeholders (0.0.x). A real v0.1+ install must
  // never be deleted by this seed.
  const version = row.manifest.version ?? '';
  if (!version.startsWith(ALPHA_VERSION_PREFIX)) {
    return { removed: false, reason: `version ${version} is not alpha` };
  }

  await deleteInstalledApp(db, 'juli3ta');
  removeFromInstalledAppsCache('juli3ta');
  notifyInstalledAppsChanged();
  return { removed: true, reason: `removed alpha ${version}` };
}
