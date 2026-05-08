/**
 * Legacy app-id → canonical app-id alias map.
 *
 * The shell ships two parallel naming schemes during the apps-platform
 * transition: the original non-hyphenated launcher ids
 * (`markdownpreview`, `texteditor`, …) hard-coded into the static
 * `APP_REGISTRY`, and the hyphenated canonical ids that the workspace
 * packages + installed_apps rows use (`markdown-preview`,
 * `text-editor`, …). Aliasing one onto the other keeps:
 *
 *   - The launcher icon discoverable under its legacy id
 *     (so Sebastian's existing dock pins still resolve), AND
 *   - AppRouter / WorkspaceAppHost mounting the canonical app via the
 *     installed_apps row.
 *
 * Living in its own module so AppLauncher (Frequently Used dedupe) and
 * AppRouter (mount routing) can both consume the same source of truth
 * without circular imports.
 */

export const LEGACY_APP_ID_ALIASES: Record<string, string> = {
  notes: 'memo',
  spreadsheet: 'sheet',
  musicplayer: 'music-player',
  voicerecorder: 'voice-recorder',
  markdownpreview: 'markdown-preview',
  photoeditor: 'photo-editor',
  texteditor: 'text-editor',
  codeeditor: 'code-editor',
  apitester: 'api-tester',
  // Product rebrand: old public Forge installs/windows should resolve to the
  // new Atomek app id without keeping brand names in new source internals.
  forge: 'atomek',
  // JULI3TA transition: when the verified standalone app is installed
  // under id `juli3ta`, the legacy launcher id (`musiccreator`) should
  // surface/open that independent app. If the standalone row is absent,
  // `unifyAppDefinition` returns the legacy definition and AppRouter's
  // static `musiccreator` switch remains the fallback. Do NOT point this
  // at `music-creator` — that bundled package is not Sebastian's full
  // JULI3TA product.
  musiccreator: 'juli3ta',
};

/**
 * Resolve any app id (legacy or canonical) to its canonical form.
 * Returns the input verbatim when no alias exists. Used by:
 *   - AppRouter (decide which `installed_apps` row to mount), and
 *   - AppLauncher (collapse legacy + canonical recents into one).
 */
export function resolveCanonicalAppId(id: string): string {
  return LEGACY_APP_ID_ALIASES[id] ?? id;
}

import type { AppDefinition } from '@/types';
import {
  getInstalledAppRow,
} from '@/runtime/installed-apps-cache';
import { appDefinitionFromInstalledRow } from './registry';

/**
 * If `app` is a legacy launcher entry whose canonical alias is now
 * installed, replace it with the AppDefinition derived from the
 * installed manifest. This unifies the icon + name + description so
 * the launcher grid, Dock, and Frequently Used all show the same
 * face for a given app — no more "FileCode here / Eye there" for the
 * same Markdown Editor.
 *
 * Returns the input unchanged when:
 *   - the id has no alias entry, OR
 *   - the canonical id isn't in the installed-apps cache yet (e.g.
 *     the auto-install hasn't completed on first boot).
 */
export function unifyAppDefinition(app: AppDefinition): AppDefinition {
  const canonical = LEGACY_APP_ID_ALIASES[app.id];
  if (!canonical) return app;
  const row = getInstalledAppRow(canonical);
  if (!row) return app;
  return appDefinitionFromInstalledRow(row);
}
