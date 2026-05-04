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
  return LEGACY_APP_ID_ALIASES[id] ?? id;
}
