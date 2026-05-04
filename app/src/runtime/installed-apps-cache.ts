/**
 * Module-level snapshot of `installed_apps` rows, kept in sync with the
 * SQLite source of truth via direct writes from `installer.ts` (on
 * install / uninstall / reinstall) and a one-shot boot populate from
 * `main.tsx` (after `seedBundledAppsAtBoot` resolves).
 *
 * Why this exists
 * ---------------
 * `app/src/apps/registry.ts` ships a static `APP_REGISTRY` array with
 * the build-time-known apps. `getAppById` consults that array to drive
 * `useOSStore.createWindow` — and createWindow throws "Unknown app:
 * <id>" if the lookup misses. Third-party apps installed at runtime
 * (e.g. `juli3ta`, `text-editor` from the App Store's Featured catalog)
 * are NOT in the static array, so clicking "Open" used to do nothing
 * — the throw aborted before AppRouter ever rendered.
 *
 * This cache fills the gap synchronously: every install path updates
 * the cache before dispatching `notifyInstalledAppsChanged`, so by the
 * time any consumer asks `getAppById(id)` for a freshly-installed app,
 * the row is already cacheable.
 *
 * Lifecycle
 * ---------
 *   - Boot: main.tsx calls `populateInstalledAppsCache(db)` once after
 *     the seed runs (covers system + previously-installed-app rows
 *     from the persistent OPFS).
 *   - Install: installer.ts calls `addToInstalledAppsCache(row)` after
 *     a successful INSERT.
 *   - Uninstall: installer.ts calls `removeFromInstalledAppsCache(id)`
 *     after a successful DELETE.
 *   - Reinstall: installer.ts calls `addToInstalledAppsCache(updated)`
 *     after the in-place UPDATE.
 *
 * Tests can call `__clearInstalledAppsCacheForTests()` to reset between
 * cases.
 */

import type { Db } from '@/lib/db/types';
import {
  listInstalledApps,
  type InstalledAppRow,
} from './installed-apps-repo';

let snapshot: Map<string, InstalledAppRow> = new Map();

/** Synchronous lookup. Used by `registry.getAppById` as the fallback
 *  for ids missing from the static `APP_REGISTRY`. */
export function getInstalledAppRow(id: string): InstalledAppRow | undefined {
  return snapshot.get(id);
}

/** Read every cached row. Useful for the App Store / launcher to
 *  enumerate installed apps without re-querying SQLite. */
export function listCachedInstalledApps(): InstalledAppRow[] {
  return Array.from(snapshot.values());
}

/** Replace the cache with `rows`. Called once at boot from main.tsx. */
export function setInstalledAppsCache(rows: InstalledAppRow[]): void {
  snapshot = new Map(rows.map((r) => [r.id, r]));
}

/** Add or replace a single row. Called by installer.ts on INSERT /
 *  reinstall UPDATE. Idempotent — overwrites any existing entry. */
export function addToInstalledAppsCache(row: InstalledAppRow): void {
  snapshot.set(row.id, row);
}

/** Remove a single row. Called by installer.ts on DELETE. No-op if the
 *  id isn't cached. */
export function removeFromInstalledAppsCache(id: string): void {
  snapshot.delete(id);
}

/** One-shot populate — read every row from SQLite and replace the
 *  cache. Called from main.tsx after `seedBundledAppsAtBoot` resolves
 *  so previously-installed third-party apps are openable on the first
 *  click after a page reload. Failure is non-fatal; the cache stays
 *  empty until the next install (which writes to it directly). */
export async function populateInstalledAppsCache(db: Db): Promise<void> {
  try {
    const rows = await listInstalledApps(db);
    setInstalledAppsCache(rows);
  } catch (err) {
    console.warn('[tytusos] installed-apps cache populate failed', err);
  }
}

/** Test-only. Reset between cases so module-level state doesn't leak. */
export function __clearInstalledAppsCacheForTests(): void {
  snapshot = new Map();
}
