/**
 * Boot-time seed of `installed_apps` from the bundled-app manifests.
 *
 * Per spec §"installed_apps SQLite schema (M1 deliverable)":
 *   "The seed runs idempotently on every shell boot — re-asserts the
 *    manifest JSON for bundled apps so an upgrade with a newer
 *    manifest gets picked up."
 *
 * M3.5 wires this. Today five real bundled-app manifests get seeded:
 * Music Player + Voice Recorder + Sheet + Studio + Memo. The old
 * `music-creator` package remains in the repo only as a deprecated
 * extraction stub and is NOT exposed as a system app; the real product
 * is the standalone installed `juli3ta` app.
 *
 * `entryUrl` and `assetsUrl` are resolved per Vite mode (DEV vs
 * production build). M3.5 leaves them null because the actual
 * loader-driven mount lifts in M3.6+; M5 wires the App Store UI
 * which reads them.
 */

import type { Manifest } from '@tytus/host-api';
// System apps — bundled with the shell, kind='bundled', builtin_protected=1.
// User apps (text-editor, markdown-preview, api-tester, photo-editor,
// code-editor) carved to standalone repos at github.com/traylinx/tytus-app-*
// + published to jsDelivr. Discovered via App Store's Featured section,
// installed via "Install from URL" → kind='installed' rows. Seeding them
// as bundled would collide with the install-from-URL path on duplicate id.
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
  // System apps (built-in, builtin_protected=1). Only apps with real
  // UI ship here. `music-creator` is intentionally omitted because
  // Sebastian's real JULI3TA lives in the verified standalone `juli3ta`
  // app; keeping the extraction stub visible creates a fake app.
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
