/**
 * Boot-time seed of `installed_apps` from the bundled-app manifests.
 *
 * Per spec §"installed_apps SQLite schema (M1 deliverable)":
 *   "The seed runs idempotently on every shell boot — re-asserts the
 *    manifest JSON for bundled apps so an upgrade with a newer
 *    manifest gets picked up."
 *
 * M3.5 wires this. Today all six bundled-app manifests get seeded:
 * the three music-suite manifests + Sheet (M4 PR-M4.1) + Studio
 * (M6 PR-M6.1) + Memo (M7 PR-M7.1). As subsequent sub-PRs lift
 * each app's UI, the seed shape stays unchanged.
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
import sheetManifest from '../../../packages/app-sheet/tytus-app.json';
import studioManifest from '../../../packages/app-studio/tytus-app.json';
import memoManifest from '../../../packages/app-memo/tytus-app.json';
import { seedInstalledApps } from './installed-apps-repo';
import type { Db } from '@/lib/db/types';

interface BundledManifestSpec {
  manifest: Manifest;
  entryUrl: string | null;
  assetsUrl: string | null;
}

function manifestEntry(id: string, raw: unknown): BundledManifestSpec {
  // M3.6: bundled apps share a loader convention — their entry_url is
  // the npm package identifier `@tytus/app-<id>`. The dynamic-loader
  // resolves this through Vite's workspace alias in DEV (the symlink
  // under node_modules/@tytus/app-<id>) and through the bundled chunk
  // registered by the install pipeline in PROD. Centralising it here
  // keeps the seed deterministic across boots while leaving the door
  // open for third-party apps to set arbitrary entry_url values.
  return {
    manifest: raw as Manifest,
    entryUrl: `@tytus/app-${id}`,
    assetsUrl: null,
  };
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
  manifestEntry('sheet', sheetManifest),
  manifestEntry('studio', studioManifest),
  manifestEntry('memo', memoManifest),
];

/**
 * Idempotent boot-time seed. Call once after initDb(). Failure is
 * non-fatal — the App Store + cross-app shared-storage features
 * degrade gracefully when installed_apps is empty.
 */
export async function seedBundledAppsAtBoot(db: Db): Promise<void> {
  await seedInstalledApps(db, BUNDLED_APP_MANIFESTS);
}
