/**
 * Boot-time auto-install of every Featured app.
 *
 * The Featured catalog (`featured-apps-catalog.ts` + the remote
 * `tytus-app-catalog` repo) describes a curated set of user apps that
 * the OS treats as "default installed" — JULI3TA, Text Editor, Code
 * Editor, Markdown Preview, Photo Editor, API Tester, etc. Without
 * this seed they only land in `installed_apps` after the user clicks
 * Install in the App Store, which leaves the launcher feeling empty
 * on first boot.
 *
 * This module fetches the live catalog (with hardcoded fallback) and,
 * for any entry whose id is not yet present in `installed_apps`, calls
 * `installAppFromManifestUrl` against its manifest URL. Failures are
 * tolerated — a flaky network on first boot does NOT block shell boot;
 * the next boot retries any still-missing apps.
 *
 * Performance note: installs run with controlled concurrency (default
 * 3) so a freshly empty SQLite DB doesn't fan out 6+ jsDelivr fetches
 * simultaneously and starve UI rendering. Each install is independent
 * — one failed manifest doesn't poison the others.
 */

import {
  loadFeaturedApps,
  type FeaturedApp,
} from '@/apps/featured-apps-catalog';
import {
  installAppFromManifestUrl,
  InstallerError,
} from './installer';
import { listInstalledApps } from './installed-apps-repo';
import type { Db } from '@/lib/db/types';

export interface AutoInstallReport {
  attempted: number;
  installed: string[];
  failed: Array<{ id: string; reason: string }>;
  skipped: string[];
}

export interface AutoInstallOptions {
  /** Override for tests — defaults to the live `loadFeaturedApps`. */
  loadCatalog?: () => Promise<FeaturedApp[]>;
  /** Override for tests — defaults to the live installer. */
  install?: (opts: {
    manifestUrl: string;
    db: Db;
  }) => Promise<unknown>;
  /** How many parallel install requests to fire at most. Defaults to 3. */
  concurrency?: number;
  /** Optional logger. Defaults to console.info / console.warn. */
  logger?: {
    info?: (msg: string, ...rest: unknown[]) => void;
    warn?: (msg: string, ...rest: unknown[]) => void;
  };
}

const DEFAULT_CONCURRENCY = 3;

/**
 * Walk a list with bounded concurrency. Tiny purpose-built scheduler
 * (vs pulling p-limit) keeps the runtime bundle dependency-free.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const inflight: Promise<void>[] = [];
  while (queue.length > 0 || inflight.length > 0) {
    while (queue.length > 0 && inflight.length < limit) {
      const item = queue.shift()!;
      const p = worker(item).finally(() => {
        const idx = inflight.indexOf(p);
        if (idx >= 0) inflight.splice(idx, 1);
      });
      inflight.push(p);
    }
    if (inflight.length > 0) {
      await Promise.race(inflight);
    }
  }
}

/**
 * Install every Featured app that isn't already in installed_apps.
 * Idempotent — a second run with all apps installed is a no-op.
 *
 * Returns a structured report so the caller (main.tsx) can log a
 * digest and the test suite can assert behaviour without parsing
 * console output.
 */
export async function autoInstallFeaturedAtBoot(
  db: Db,
  opts: AutoInstallOptions = {},
): Promise<AutoInstallReport> {
  const loadCatalog = opts.loadCatalog ?? loadFeaturedApps;
  const install =
    opts.install ??
    ((args) => installAppFromManifestUrl({ ...args, db }));
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const log = {
    info: opts.logger?.info ?? ((m: string) => console.info(m)),
    warn: opts.logger?.warn ?? ((m: string, ...rest: unknown[]) => console.warn(m, ...rest)),
  };

  let catalog: FeaturedApp[];
  try {
    catalog = await loadCatalog();
  } catch (err) {
    log.warn('[tytusos] featured catalog load failed; skipping auto-install', err);
    return { attempted: 0, installed: [], failed: [], skipped: [] };
  }

  const existing = new Set(
    (await listInstalledApps(db)).map((row) => row.id),
  );

  const targets = catalog.filter((entry) => !existing.has(entry.id));
  const skipped = catalog
    .filter((entry) => existing.has(entry.id))
    .map((entry) => entry.id);

  const installed: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  await runWithConcurrency(targets, concurrency, async (entry) => {
    try {
      await install({ manifestUrl: entry.manifestUrl, db });
      installed.push(entry.id);
    } catch (err) {
      const reason =
        err instanceof InstallerError
          ? `${err.code}${err.message ? `: ${err.message}` : ''}`
          : (err as Error)?.message ?? String(err);
      failed.push({ id: entry.id, reason });
    }
  });

  if (installed.length > 0) {
    log.info(
      `[tytusos] auto-installed ${installed.length} featured app(s): ${installed.join(', ')}`,
    );
  }
  for (const f of failed) {
    log.warn(`[tytusos] auto-install failed for ${f.id}: ${f.reason}`);
  }

  return {
    attempted: targets.length,
    installed,
    failed,
    skipped,
  };
}
