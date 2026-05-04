/**
 * installer.ts — typed shell-side install / uninstall / reinstall API
 * for third-party Tytus OS apps.
 *
 * Phase 2 of SPRINT-TYTUS-APP-SYSTEM-V1. The App Store UI (Phase 3,
 * AppStore.tsx + TytusAppsTab.tsx) drives this directly. The tytus-cli
 * `app` subcommand (Phase 2.5, shipped) surfaces URLs + paste-ready
 * install instructions; a future tytus-cli ↔ daemon RPC could drive
 * this installer in-place from the terminal.
 *
 * Wire shape
 * ----------
 *   install:    fetch(manifestUrl) → JSON → validateManifest → INSERT
 *   uninstall:  lookup → reject builtin_protected → DELETE
 *   reinstall:  lookup → re-fetch manifest_url → re-validate → UPDATE
 *
 * Errors are exposed via `InstallerError`, a typed Error subclass with a
 * machine-readable `code` string. The App Store renders the code +
 * details in a friendly toast / modal.
 */

import {
  validateManifest,
  type Manifest,
  type ManifestValidationIssue,
} from '@tytus/host-api';
import {
  deleteInstalledApp,
  getInstalledApp,
  insertInstalledApp,
  updateInstalledApp,
  type InstalledAppRow,
} from './installed-apps-repo';
import {
  addToInstalledAppsCache,
  removeFromInstalledAppsCache,
} from './installed-apps-cache';
import { notifyInstalledAppsChanged } from './installed-apps-events';
import type { Db } from '@/lib/db/types';

/**
 * Typed failure mode. Every code corresponds to a single user-facing
 * outcome; the `details` payload carries machine-readable context the
 * UI can render (e.g. validateManifest issues, the offending URL, the
 * underlying fetch error).
 *
 * Codes:
 *   - `invalid_manifest`: validateManifest rejected the JSON. `details`
 *     is `ManifestValidationIssue[]`.
 *   - `duplicate`: a row with this id already exists. `details` is
 *     `{ existingId: string }`. Caller should `uninstallApp` first or
 *     use `reinstallApp`.
 *   - `not_found`: uninstall / reinstall ran against a missing id.
 *     `details` is `{ id: string }`.
 *   - `protected`: uninstall hit a builtin_protected=true row (system
 *     app). `details` is `{ id: string }`.
 *   - `fetch_failed`: network / status error fetching the manifest URL.
 *     `details` is `{ url: string, status?: number, cause?: unknown }`.
 *   - `parse_failed`: response wasn't valid JSON. `details` is
 *     `{ url: string, cause: unknown }`.
 *   - `bad_transport`: manifest validates but uses entry.module instead
 *     of entry.url — installed apps MUST ship via URL transport.
 *     `details` is `{ id: string }`.
 *   - `cannot_reinstall`: reinstall ran against a row that exists but
 *     has no `manifestUrl` recorded (typically a `kind='bundled'` row).
 *     `details` is `{ id: string, reason: string }`. Caller should fall
 *     back to the Install-from-URL flow.
 */
export type InstallerErrorCode =
  | 'invalid_manifest'
  | 'duplicate'
  | 'not_found'
  | 'protected'
  | 'fetch_failed'
  | 'parse_failed'
  | 'bad_transport'
  | 'cannot_reinstall';

export class InstallerError extends Error {
  readonly code: InstallerErrorCode;
  readonly details?: unknown;

  constructor(code: InstallerErrorCode, details?: unknown, message?: string) {
    super(message ?? `[tytus-installer] ${code}`);
    this.name = 'InstallerError';
    this.code = code;
    this.details = details;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────

/** Minimal injectable fetch surface so tests don't need real network. */
type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const defaultFetch: FetchLike = (url) =>
  fetch(url) as unknown as ReturnType<FetchLike>;

async function fetchManifest(
  manifestUrl: string,
  fetchImpl: FetchLike,
): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(manifestUrl);
  } catch (cause) {
    throw new InstallerError('fetch_failed', { url: manifestUrl, cause });
  }
  if (!res.ok) {
    throw new InstallerError('fetch_failed', {
      url: manifestUrl,
      status: res.status,
    });
  }
  try {
    return await res.json();
  } catch (cause) {
    throw new InstallerError('parse_failed', { url: manifestUrl, cause });
  }
}

function assertValid(json: unknown): asserts json is Manifest {
  const result = validateManifest(json);
  if (!result.valid) {
    throw new InstallerError(
      'invalid_manifest',
      result.issues satisfies ManifestValidationIssue[],
    );
  }
}

function assertUrlTransport(manifest: Manifest): void {
  // Installed (third-party) apps MUST use entry.url — entry.module is
  // reserved for workspace-bundled apps the OS ships with. The manifest
  // validator accepts either, so we re-check here.
  if (!manifest.entry?.url) {
    throw new InstallerError('bad_transport', { id: manifest.id });
  }
}

// ─── Public surface ──────────────────────────────────────────────────

export interface InstallAppOptions {
  /** https URL pointing to a tytus-app.json. */
  manifestUrl: string;
  db: Db;
  /** Override clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Override fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}

/**
 * Fetch + validate + insert a third-party app. Returns the freshly
 * inserted row. Throws `InstallerError` on any failure path.
 */
export async function installAppFromManifestUrl(
  opts: InstallAppOptions,
): Promise<InstalledAppRow> {
  const { manifestUrl, db } = opts;
  const now = opts.now ?? (() => Date.now());
  const fetchImpl = opts.fetchImpl ?? defaultFetch;

  const json = await fetchManifest(manifestUrl, fetchImpl);
  assertValid(json);
  const manifest: Manifest = json;
  assertUrlTransport(manifest);

  const existing = await getInstalledApp(db, manifest.id);
  if (existing) {
    throw new InstallerError('duplicate', { existingId: manifest.id });
  }

  const installedAt = now();
  const row: InstalledAppRow = {
    id: manifest.id,
    kind: 'installed',
    manifest,
    entryUrl: manifest.entry?.url ?? null,
    assetsUrl: manifest.entry?.assets ?? null,
    manifestUrl,
    installedAt,
    enabled: true,
    builtinProtected: false,
  };
  await insertInstalledApp(db, row);
  // Write through to the synchronous cache BEFORE dispatching the event
  // so any consumer that reads in the same tick (App Store re-render,
  // launcher click) sees the new row immediately.
  addToInstalledAppsCache(row);
  notifyInstalledAppsChanged();
  return row;
}

export interface UninstallAppOptions {
  appId: string;
  db: Db;
}

/**
 * Remove a third-party app from the registry. Throws on missing rows or
 * builtin-protected (system) apps. Per-app SQLite tables (the
 * `app_<id>_*` prefix-guarded schema) are NOT dropped here — that's
 * deferred to M3.5+ cleanup work.
 */
export async function uninstallApp(opts: UninstallAppOptions): Promise<void> {
  const { appId, db } = opts;
  const row = await getInstalledApp(db, appId);
  if (!row) {
    throw new InstallerError('not_found', { id: appId });
  }
  if (row.builtinProtected) {
    throw new InstallerError('protected', { id: appId });
  }
  await deleteInstalledApp(db, appId);
  removeFromInstalledAppsCache(appId);
  notifyInstalledAppsChanged();
}

export interface ReinstallAppOptions {
  appId: string;
  db: Db;
  now?: () => number;
  fetchImpl?: FetchLike;
}

/**
 * Re-fetch the manifest from the URL the original install came from and
 * UPDATE the row in place. Used by the App Store "Reinstall" / "Check
 * for updates" affordance.
 *
 * The function deliberately rejects rows without a `manifestUrl` —
 * bundled / legacy / alias rows can't be reinstalled this way. It also
 * rejects rows whose CURRENT id doesn't match the refetched manifest's
 * id (the publisher renamed the app upstream — the user must uninstall +
 * fresh-install in that case).
 *
 * `installed_at` is preserved (this isn't a fresh install).
 */
export async function reinstallApp(
  opts: ReinstallAppOptions,
): Promise<InstalledAppRow> {
  const { appId, db } = opts;
  const fetchImpl = opts.fetchImpl ?? defaultFetch;

  const existing = await getInstalledApp(db, appId);
  if (!existing) {
    throw new InstallerError('not_found', { id: appId });
  }
  if (!existing.manifestUrl) {
    // No source URL on file — can't re-fetch. Typically a kind='bundled'
    // row (system app); the App Store hides the Reinstall button on
    // those, but the runtime guard catches programmatic callers.
    throw new InstallerError('cannot_reinstall', {
      id: appId,
      reason: 'manifest_url missing on row',
    });
  }

  const json = await fetchManifest(existing.manifestUrl, fetchImpl);
  assertValid(json);
  const manifest: Manifest = json;
  assertUrlTransport(manifest);

  if (manifest.id !== appId) {
    // The publisher renamed the app — refuse to silently rewrite the
    // primary key. UX guidance: tell the user, ask them to uninstall
    // the old id and install the new one.
    throw new InstallerError('invalid_manifest', [
      {
        path: '/id',
        message: `manifest id changed from ${appId} to ${manifest.id}; uninstall first then reinstall under the new id`,
      },
    ]);
  }

  await updateInstalledApp(db, appId, {
    manifest,
    entryUrl: manifest.entry?.url ?? null,
    assetsUrl: manifest.entry?.assets ?? null,
    manifestUrl: existing.manifestUrl,
  });

  // Return the freshly-fetched row so the UI can update without a
  // round-trip back to listInstalledApps.
  const updated: InstalledAppRow = {
    ...existing,
    manifest,
    entryUrl: manifest.entry?.url ?? null,
    assetsUrl: manifest.entry?.assets ?? null,
  };
  addToInstalledAppsCache(updated);
  notifyInstalledAppsChanged();
  return updated;
}
