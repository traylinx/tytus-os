/**
 * App manifest (`tytus-app.json`) — the contract between an app and the OS.
 *
 * The matching JSON Schema lives in `manifest.schema.json` and is what the
 * `tytus-app validate <path>` CLI checks against. The two MUST stay in
 * sync — the CLI is the source of truth at install time, this TS type is
 * the source of truth at compile time.
 */

export type AppKind = 'bundled' | 'installed' | 'legacy' | 'alias';

export type AppCategory =
  | 'System'
  | 'Internet'
  | 'Productivity'
  | 'Creative'
  | 'Games'
  | 'Utilities'
  | 'Media'
  | 'Development';

/**
 * Granular permissions an app can request in `manifest.permissions[]`.
 *
 * The literals enumerate everything except shared-storage keys — those
 * use the shape `storage.shared.<key>` where `<key>` is the share key
 * declared by the OWNING app's manifest. `Permission` accepts that shape
 * via the template literal type below.
 */
export type CorePermission =
  | 'daemon.read'
  | 'daemon.network'
  | 'vfs.user.music'
  | 'vfs.user.documents'
  | 'vfs.user.desktop'
  | 'vfs.user.downloads'
  | 'vfs.system'
  | 'shell.openWindow'
  | 'shell.notifications'
  | 'shell.menu'
  | 'shell.dock'
  | 'storage.app'
  | 'media.microphone'
  | 'media.display'
  | 'clipboard';

/** `storage.shared.<key>` — declares this app reads a shared table key
 *  registered by some other app's `storage.shares`. */
export type SharedStoragePermission = `storage.shared.${string}`;

export type Permission = CorePermission | SharedStoragePermission;

export interface ManifestWindow {
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize?: { width: number; height: number };
}

export interface ManifestStorageTable {
  /** Logical name; physical table is `app_<sqlAppId>_<name>`. */
  name: string;
  /** Path to the migration SQL file, relative to the manifest. */
  schema: string;
}

export interface ManifestStorage {
  tables?: ManifestStorageTable[];
  /** Tables this app exposes for cross-app reads. Map of share-key → physical
   *  table name. The reading app must declare `storage.shared.<key>` in its
   *  permissions. */
  shares?: Record<string, string>;
}

export interface ManifestEntry {
  /** Path to the ESM entry module, relative to the manifest. */
  module: string;
  /** Optional bundle root for `host.assets.*` resolution. Defaults to
   *  `./assets/` next to `module` if omitted. */
  assets?: string;
  /** Optional CSS file (e.g. `./dist/index.css`). Loader fetches, transforms
   *  for isolation, and injects inline. */
  css?: string;
  /** Per-locale i18n message bundles, relative to the manifest. */
  i18n?: Record<string, string>;
  /** Font URLs to preload before app code runs (preload as `<link rel=preload>`
   *  to avoid CLS). The CSS isolation algorithm REJECTS `@font-face` rules in
   *  app stylesheets — fonts must come through here. */
  fonts?: string[];
}

export interface ManifestFileAssociation {
  extension: string;
  mimeType: string;
}

export interface ManifestContributes {
  fileAssociations?: ManifestFileAssociation[];
}

export interface AliasManifestExtras {
  /** ID of the live app that this alias resolves to. */
  aliasOf?: string;
  /** Function body (string) that, when invoked with the legacy WindowArgs,
   *  returns the live app's WindowArgs shape. Eval'd at the loader's
   *  alias-resolution call site. */
  rewriteArgs?: string;
  /** Future Tytus version that will drop this alias entirely. CI rejects PRs
   *  that ship past this version still carrying the alias. */
  removeInVersion?: string;
  /** Aliases are hidden from the App Store's installed-apps tab. */
  hidden?: boolean;
}

export interface Manifest extends AliasManifestExtras {
  /** JSON Schema reference. Tooling uses this for editor autocomplete. */
  $schema?: string;

  /** App id; `^[a-z0-9-]+$`. Used as the registry primary key + the source
   *  of `sqlAppId = id.replaceAll('-', '_')` for SQL physical names. */
  id: string;
  /** Human-readable name shown in the App Store + dock. */
  name: string;
  /** Semantic version. */
  version: string;
  /** Lucide icon name (e.g. `Table2`). The shell renders the matching icon. */
  icon: string;
  /** App Store category. */
  category: AppCategory;
  /** Short tagline for the App Store. */
  description: string;
  /** Registry kind. Optional in source manifests — defaults to `bundled` for
   *  workspace packages; the shell sets it explicitly when seeding the
   *  installed_apps table. */
  kind?: AppKind;

  window: ManifestWindow;
  permissions: Permission[];
  storage?: ManifestStorage;
  entry: ManifestEntry;
  contributes?: ManifestContributes;
}

/**
 * Registry-level entry stored in the `installed_apps` SQLite table. Wraps the
 * raw manifest with shell-derived fields (resolved entry URL, install time,
 * built-in protection bit). The shell, not apps, populates this.
 */
export interface InstalledAppRow {
  id: string;
  kind: AppKind;
  manifest: Manifest;
  entryUrl: string | null;
  assetsUrl: string | null;
  installedAt: number;
  enabled: boolean;
  builtinProtected: boolean;
}

export const APP_ID_PATTERN = /^[a-z0-9-]+$/;

/** Derive the SQL-safe form of an app id (kebab → snake). */
export function sqlAppId(appId: string): string {
  return appId.replaceAll('-', '_');
}

/** Derive the physical table name for a logical table name owned by an app. */
export function physicalTableName(appId: string, tableName: string): string {
  return `app_${sqlAppId(appId)}_${tableName}`;
}
