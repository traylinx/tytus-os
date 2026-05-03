/**
 * Boot-time seed of `installed_apps` from the bundled-app manifests.
 *
 * Per spec §"installed_apps SQLite schema (M1 deliverable)":
 *   "The seed runs idempotently on every shell boot — re-asserts the
 *    manifest JSON for bundled apps so an upgrade with a newer
 *    manifest gets picked up."
 *
 * M3.5 wires this. Today the three music-suite manifests get seeded.
 * As Sheet/Studio/Memo extract in M4/M6/M7, their manifests are added
 * to BUNDLED_APP_MANIFESTS and pick up the same flow automatically.
 *
 * `entryUrl` and `assetsUrl` are resolved per Vite mode (DEV vs
 * production build). M3.5 leaves them null because the actual
 * loader-driven mount lifts in M3.6+; M5 wires the App Store UI
 * which reads them.
 */

import type { Manifest } from '@tytus/host-api';
import musicCreatorManifest from '../../../packages/app-music-creator/tytus-app.json';
import musicPlayerManifest from '../../../packages/app-music-player/tytus-app.json';
import voiceRecorderManifest from '../../../packages/app-voice-recorder/tytus-app.json';
import { seedInstalledApps } from './installed-apps-repo';
import type { Db } from '@/lib/db/types';

interface BundledManifestSpec {
  manifest: Manifest;
  entryUrl: string | null;
  assetsUrl: string | null;
}

function manifestEntry(id: string, raw: unknown): BundledManifestSpec {
  return {
    manifest: raw as Manifest,
    // null until M3.6 wires real loader URLs; the loader/AppStore
    // code paths handle null-entry gracefully (the app shows as
    // "Updating…" until the next boot). Tests + CI builds keep
    // entry resolution deterministic by reading from
    // packages/app-<id>/dist/index.js when present.
    entryUrl: null,
    assetsUrl: null,
  };
  void id;
}

/**
 * Static list of bundled-app manifests this build of Tytus OS ships.
 * As new apps extract, add them here. The seed is idempotent so
 * dev/prod boot loops re-assert manifest_json on every run.
 */
export const BUNDLED_APP_MANIFESTS: BundledManifestSpec[] = [
  manifestEntry('music-creator', musicCreatorManifest),
  manifestEntry('music-player', musicPlayerManifest),
  manifestEntry('voice-recorder', voiceRecorderManifest),
];

/**
 * Idempotent boot-time seed. Call once after initDb(). Failure is
 * non-fatal — the App Store + cross-app shared-storage features
 * degrade gracefully when installed_apps is empty.
 */
export async function seedBundledAppsAtBoot(db: Db): Promise<void> {
  await seedInstalledApps(db, BUNDLED_APP_MANIFESTS);
}
