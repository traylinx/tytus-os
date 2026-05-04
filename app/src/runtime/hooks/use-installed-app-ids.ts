/**
 * useInstalledAppIds — live snapshot of every id present in the
 * `installed_apps` SQLite table, keyed to its `kind`.
 *
 * Subscribers are notified via the
 * `installed-apps-events.ts` bus, which `installer.ts` dispatches on
 * after every successful install / uninstall / reinstall.
 *
 * Why this exists
 * ---------------
 * `AppRouter` previously consulted a hardcoded `WORKSPACE_APP_IDS` Set
 * to decide whether an appId should mount via `WorkspaceAppHost`. That
 * Set baked the 11 known ids into the bundle, so any third-party app
 * the user installed at runtime (e.g. `todoist`) fell through to
 * `<AppPlaceholder/>` because its id wasn't in the Set. This hook lets
 * AppRouter consult the live table — installed and bundled rows BOTH
 * route through the dynamic loader, regardless of whether their id was
 * known at build time.
 *
 * Returns a `Map<id, kind>` so the caller can:
 *   - `.has(id)` for fast membership check
 *   - `.get(id)` to inspect kind ('bundled' | 'installed' | 'alias')
 *
 * Production: reads via `getDb()` + `listInstalledApps()`. Tests can
 * inject a custom `loader` for deterministic data without touching the
 * SQLite worker.
 *
 * Edge cases handled:
 *   - DB not yet initialized at first render → returns an empty Map
 *     and refreshes on the next 'changed' event (or a manual reload).
 *   - Component unmount during an in-flight `listInstalledApps` →
 *     `cancelled` flag avoids `setState` on unmounted component.
 */

import { useEffect, useState } from 'react';
import { getDb } from '@/lib/db';
import {
  listInstalledApps,
  type InstalledAppRow,
} from '../installed-apps-repo';
import { subscribeInstalledAppsChanged } from '../installed-apps-events';

export type InstalledAppIdMap = Map<string, InstalledAppRow['kind']>;

export interface UseInstalledAppIdsOptions {
  /** Test injection. When provided, replaces the production
   *  `getDb() + listInstalledApps()` path. */
  loader?: () => Promise<InstalledAppRow[]>;
}

export function useInstalledAppIds(
  opts: UseInstalledAppIdsOptions = {},
): InstalledAppIdMap {
  const { loader } = opts;
  const [ids, setIds] = useState<InstalledAppIdMap>(() => new Map());

  useEffect(() => {
    let cancelled = false;

    const reload = async () => {
      try {
        let rows: InstalledAppRow[];
        if (loader) {
          rows = await loader();
        } else {
          const db = getDb();
          if (!db) {
            // DB not booted yet — leave map empty; the next 'changed'
            // event (or a re-render once the DB is up) will refresh.
            return;
          }
          rows = await listInstalledApps(db);
        }
        if (cancelled) return;
        const next: InstalledAppIdMap = new Map();
        for (const row of rows) {
          next.set(row.id, row.kind);
        }
        setIds(next);
      } catch {
        // Swallow errors — the AppRouter falls back to its static
        // switch when the map is empty, which is the safest "the DB
        // is in trouble" UX.
        if (!cancelled) setIds(new Map());
      }
    };

    void reload();
    const unsubscribe = subscribeInstalledAppsChanged(() => {
      void reload();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loader]);

  return ids;
}
