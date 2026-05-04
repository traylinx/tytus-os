/**
 * Localized app-name resolver with a hard fallback.
 *
 * `t('app.<id>.name')` returns the literal key string when the locale
 * has no entry — for runtime-installed third-party apps (markdown-
 * preview, photo-editor, …) that miss en.ts entries by design, this
 * leaked strings like "app.markdown-preview.name" into launcher
 * labels, dock tooltips, and window title bars. Routing every
 * callsite through this helper keeps the fallback logic consistent:
 * if the i18n key is missing, fall back to the AppDefinition.name (or
 * the manifest.name for installed apps), which is always populated.
 */
export function localizedAppName(
  t: (key: string) => string,
  id: string,
  fallback: string,
): string {
  const key = `app.${id}.name`;
  const result = t(key);
  return result === key ? fallback : result;
}
