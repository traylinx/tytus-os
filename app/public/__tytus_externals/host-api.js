/**
 * Tytus externals shim — `@tytus/host-api`.
 *
 * The host-api package ships pure types + the small runtime helpers
 * (`validateManifest`, `APP_ID_PATTERN`, `sqlAppId`, `physicalTableName`,
 * the typed error classes). Installed apps import any of those by name
 * from `@tytus/host-api`; the importmap rewrites that to this URL.
 *
 * The shape of the exports mirrors what `packages/host-api/src/index.ts`
 * actually re-exports as VALUES (not types — types vanish at compile
 * time, so they don't need a runtime entry).
 */
const api = globalThis.__TYTUS_EXTERNALS__ && globalThis.__TYTUS_EXTERNALS__.hostApi;
if (!api) {
  throw new Error(
    '[tytus-externals] @tytus/host-api not on window.__TYTUS_EXTERNALS__.',
  );
}

export const {
  APP_ID_PATTERN,
  sqlAppId,
  physicalTableName,
  validateManifest,
  PermissionDeniedError,
  AssetNotFoundError,
  AssetTooLargeError,
  AssetEscapeError,
  ManifestValidationError,
  DaemonClientError,
  createDaemonClient,
} = api;

export default api;
