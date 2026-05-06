/**
 * Public-surface cleanup for the Forge MVP.
 *
 * These app ids are still present as source packages or legacy routes, but
 * they are no longer user-facing products. Forge stays public, while Text
 * Editor and Markdown Editor are restored as standalone productivity apps.
 * Filtering only affects launcher/store/dock surfaces; it does not delete
 * data or packages.
 */
export const REPLACED_BY_FORGE_APP_IDS: ReadonlySet<string> = new Set([
  'memo',
  'notes',
  'studio',
  'sheet',
  'spreadsheet',
  'code-editor',
  'codeeditor',
  'jsonformatter',
]);

export function isReplacedByForge(appId: string | null | undefined): boolean {
  return !!appId && REPLACED_BY_FORGE_APP_IDS.has(appId);
}
