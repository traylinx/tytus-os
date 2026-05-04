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
  // Pending Phase 5 lifts (re-enable per app once code is moved):
  //   musiccreator → music-creator   (today the legacy in-tree app is
  //                                    the working "JULI3TA" — keeping
  //                                    the alias commented out lets it
  //                                    stay routed via the static
  //                                    AppRouter switch)
};

/**
 * Resolve any app id (legacy or canonical) to its canonical form.
 * Returns the input verbatim when no alias exists. Used by:
 *   - AppRouter (decide which `installed_apps` row to mount), and
 *   - AppLauncher (collapse legacy + canonical recents into one).
 */
export function resolveCanonicalAppId(id: string): string {
  if (id === 'musiccreator' && getInstalledAppRow('juli3ta')) {
    return 'juli3ta';
  }
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
 * same Markdown Preview.
 *
 * Returns the input unchanged when:
 *   - the id has no alias entry, OR
 *   - the canonical id isn't in the installed-apps cache yet (e.g.
 *     the auto-install hasn't completed on first boot).
 */
export function unifyAppDefinition(app: AppDefinition): AppDefinition {
  // JULI3TA exception: keep the legacy in-tree `musiccreator` app
  // routable as a protected migration fallback, but once standalone
  // `juli3ta` v0.1+ is installed the launcher/recents should show the
  // canonical app face instead of two JULI3TA icons. Do NOT put this in
  // LEGACY_APP_ID_ALIASES yet — AppRouter imports that map and would
  // stop routing direct `musiccreator` windows to the legacy fallback.
  if (app.id === 'musiccreator') {
    const row = getInstalledAppRow('juli3ta');
    if (row) return appDefinitionFromInstalledRow(row);
  }
  const canonical = LEGACY_APP_ID_ALIASES[app.id];
  if (!canonical) return app;
  const row = getInstalledAppRow(canonical);
  if (!row) return app;
  return appDefinitionFromInstalledRow(row);
}
