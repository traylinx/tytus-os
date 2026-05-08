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
  | 'DevTools';

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
  | 'vfs.user.pictures'
  | 'vfs.system'
  | 'shell.openWindow'
  | 'shell.notifications'
  | 'shell.menu'
  | 'shell.dock'
  | 'storage.app'
  | 'ai.chat'
  | 'ai.memory.read'
  | 'ai.memory.write'
  | 'ai.artifacts'
  | 'media.microphone'
  | 'media.display'
  | 'clipboard'
  | 'brain.read'
  | 'brain.append';

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
  /** Path to the ESM entry module, relative to the manifest.
   *  Used for **bundled** apps (workspace packages resolved at build time).
   *  Mutually exclusive with `url` — exactly one of `module` / `url` MUST
   *  be set on a non-alias manifest. */
  module?: string;
  /** Fully-qualified `https://` URL to a remote ESM module (e.g. jsDelivr
   *  / GitHub Pages chunk URL like
   *  `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<tag>/dist/index.js`).
   *  Used for **installed** apps that ship via a CDN, not the workspace.
   *  The remote loader does `await import(url)` and expects the same
   *  `bootApp(env): Component` default-export shape as workspace apps.
   *  Mutually exclusive with `module`. Only `https://` is accepted —
   *  `http://`, `data:`, `blob:`, `file://` are rejected. */
  url?: string;
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

/**
 * Structured rewrite descriptor for alias manifests. The registry resolver
 * reads this and constructs the target app's WindowArgs from a small
 * typed mapping — NO `new Function`/`eval` of arbitrary strings.
 *
 * Per 09-decisions.md M1-owned gap: "Alias `rewriteArgs` should NOT be
 * serialized JS. Use structured rewrite descriptors..." Removes the
 * eval-injection surface and makes registry rows portable.
 */
export type AliasRewriteDescriptor =
  /** Pass the legacy WindowArgs through unchanged to the live app. */
  | { type: 'identity' }
  /** Open the target Studio with a fixed mode (and optional readOnly). The
   *  legacy app's `fileRef` (if present) carries through. */
  | {
      type: 'studio';
      mode: 'code' | 'text' | 'markdown' | 'json';
      readOnly?: boolean;
    }
  /** Open the target Sheet; carries `fileRef` + optional `readOnly`. */
  | { type: 'sheet'; readOnly?: boolean }
  /** Open the target Memo; carries `fileRef` + optional `readOnly`. */
  | { type: 'memo'; readOnly?: boolean }
  /** Static args — the descriptor IS the WindowArgs object verbatim. Use
   *  for one-off redirects that don't fit the typed shapes above. */
  | { type: 'static'; args: Record<string, unknown> };

export interface AliasManifestExtras {
  /** ID of the live app that this alias resolves to. */
  aliasOf?: string;
  /** Structured descriptor — NOT a serialized function. The registry maps
   *  this to a target WindowArgs at resolve time. Absent → identity. */
  rewriteArgs?: AliasRewriteDescriptor;
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
  /** Required for `kind` ∈ {bundled, installed, legacy}. ABSENT for
   *  `kind: 'alias'` — alias manifests redirect to `aliasOf` and have no
   *  entry of their own. The JSON Schema enforces this conditional via
   *  if/else; the runtime must not assume `entry` is present without
   *  first checking `kind`. */
  entry?: ManifestEntry;
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

// ─── Runtime manifest validation ─────────────────────────────────────
//
// `validateManifest` is a lightweight runtime check used at install time
// inside the browser (where bundling Ajv would add ~80KB). It enforces
// the structural rules that prevent catastrophic installs:
//   - id matches APP_ID_PATTERN
//   - required fields present (name, version, window, permissions[])
//   - window.defaultSize + minSize have positive numeric width/height
//   - storage.tables[].name matches APP_ID_PATTERN (so the prefix guard
//     doesn't blow up later)
//   - entry.module is a non-empty string when kind ∈ {bundled, installed,
//     legacy} (never for kind='alias')
//   - permissions are strings (we DON'T enumerate the allowed set here —
//     the install pipeline can warn on unknown permissions, but the
//     authoritative permission whitelist lives in manifest.schema.json
//     and shifts more often than this runtime guard)
//
// The build-time CLI (bin/tytus-app.mjs, Ajv-driven) remains the
// canonical full-schema validator. Apps that pass `validateManifest`
// at runtime can still fail the CLI gate — that's intentional: stricter
// checks belong at build, not install.

export interface ManifestValidationIssue {
  /** JSON-Pointer-style path to the offending field. Empty for root issues. */
  path: string;
  /** Short human-readable reason. */
  message: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  issues: ManifestValidationIssue[];
}

const SEMVER_LOOSE = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/;

/**
 * Validate a runtime manifest object — typically the JSON parsed from a
 * `tytus-app.json` an install pipeline just fetched. Returns ALL issues
 * (does not bail on first failure) so the App Store can show a useful
 * "this manifest is broken because..." message instead of one line at a
 * time.
 *
 * NOTE: this does NOT verify the resolved entry-module URL is reachable;
 * that's the install pipeline's job. It also does NOT enforce that
 * referenced migration files exist on disk — that's a build-time concern.
 */
export function validateManifest(raw: unknown): ManifestValidationResult {
  const issues: ManifestValidationIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, issues: [{ path: '', message: 'manifest must be a JSON object' }] };
  }
  const m = raw as Record<string, unknown>;

  // id
  const id = m.id;
  if (typeof id !== 'string' || id.length === 0) {
    push('/id', 'required string');
  } else if (!APP_ID_PATTERN.test(id)) {
    push('/id', `must match ${APP_ID_PATTERN} (lowercase, digits, hyphen)`);
  }

  // name
  if (typeof m.name !== 'string' || m.name.trim().length === 0) {
    push('/name', 'required non-empty string');
  }

  // version
  if (typeof m.version !== 'string') {
    push('/version', 'required string');
  } else if (!SEMVER_LOOSE.test(m.version)) {
    push('/version', `not a valid semver (got ${JSON.stringify(m.version)})`);
  }

  // kind (optional, default = 'installed' at install time)
  if (m.kind !== undefined) {
    const allowed: AppKind[] = ['bundled', 'installed', 'legacy', 'alias'];
    if (typeof m.kind !== 'string' || !allowed.includes(m.kind as AppKind)) {
      push('/kind', `must be one of ${allowed.join(', ')}`);
    }
  }
  const effectiveKind: AppKind = (m.kind as AppKind | undefined) ?? 'installed';

  // window (required for non-alias)
  if (effectiveKind !== 'alias') {
    const w = m.window;
    if (typeof w !== 'object' || w === null) {
      push('/window', 'required object');
    } else {
      const ww = w as Record<string, unknown>;
      validateSize(ww.defaultSize, '/window/defaultSize', push);
      validateSize(ww.minSize, '/window/minSize', push);
      if (ww.maxSize !== undefined) validateSize(ww.maxSize, '/window/maxSize', push);
    }
  }

  // permissions (always required, possibly empty array)
  if (!Array.isArray(m.permissions)) {
    push('/permissions', 'required array');
  } else {
    m.permissions.forEach((p, i) => {
      if (typeof p !== 'string' || p.length === 0) {
        push(`/permissions/${i}`, 'must be a non-empty string');
      }
    });
  }

  // storage (optional)
  if (m.storage !== undefined) {
    const s = m.storage;
    if (typeof s !== 'object' || s === null) {
      push('/storage', 'must be object when present');
    } else {
      const ss = s as Record<string, unknown>;
      if (ss.tables !== undefined) {
        if (!Array.isArray(ss.tables)) {
          push('/storage/tables', 'must be array when present');
        } else {
          ss.tables.forEach((t, i) => {
            if (typeof t !== 'object' || t === null) {
              push(`/storage/tables/${i}`, 'must be object');
              return;
            }
            const tt = t as Record<string, unknown>;
            if (typeof tt.name !== 'string' || !APP_ID_PATTERN.test(tt.name)) {
              push(`/storage/tables/${i}/name`, 'must match APP_ID_PATTERN');
            }
            if (typeof tt.schema !== 'string' || tt.schema.length === 0) {
              push(`/storage/tables/${i}/schema`, 'required non-empty string');
            }
          });
        }
      }
      if (ss.shares !== undefined) {
        if (typeof ss.shares !== 'object' || ss.shares === null || Array.isArray(ss.shares)) {
          push('/storage/shares', 'must be object {key: physicalTableName} when present');
        }
      }
    }
  }

  // entry — required for non-alias kinds. Must have exactly one of
  // `module` (bundled / workspace package) or `url` (installed remote ESM
  // via CDN, e.g. jsDelivr / GitHub Pages). XOR is enforced because the
  // two transports have totally different resolution paths and a manifest
  // that sets both is almost certainly a misconfiguration.
  if (effectiveKind !== 'alias') {
    const e = m.entry;
    if (typeof e !== 'object' || e === null) {
      push('/entry', 'required object for non-alias kinds');
    } else {
      const ee = e as Record<string, unknown>;
      const hasModule = typeof ee.module === 'string' && ee.module.length > 0;
      const hasUrl = typeof ee.url === 'string' && ee.url.length > 0;

      if (!hasModule && !hasUrl) {
        push(
          '/entry',
          'must set exactly one of `module` (bundled) or `url` (installed remote)',
        );
      } else if (hasModule && hasUrl) {
        push(
          '/entry',
          '`module` and `url` are mutually exclusive — set one or the other, not both',
        );
      }

      // Reject any `module` value that exists but isn't a non-empty string.
      if (ee.module !== undefined && !hasModule) {
        push('/entry/module', 'must be a non-empty string when present');
      }

      // Reject any `url` value that exists but isn't a non-empty string,
      // and require https:// when it IS a non-empty string. Cheap-but-firm
      // guard against http://, data:, blob:, file:// and similar shapes
      // that would let an installed-app manifest smuggle a non-CDN
      // transport into the loader.
      if (ee.url !== undefined) {
        if (!hasUrl) {
          push('/entry/url', 'must be a non-empty string when present');
        } else {
          const url = ee.url as string;
          if (!url.startsWith('https://')) {
            push(
              '/entry/url',
              `must be an https:// URL (got ${JSON.stringify(url)})`,
            );
          }
        }
      }
    }
  } else if (m.entry !== undefined) {
    push('/entry', "must be omitted when kind='alias'");
  }

  return { valid: issues.length === 0, issues };
}

function validateSize(
  v: unknown,
  path: string,
  push: (path: string, message: string) => void,
): void {
  if (typeof v !== 'object' || v === null) {
    push(path, 'required object {width, height}');
    return;
  }
  const s = v as Record<string, unknown>;
  if (typeof s.width !== 'number' || s.width <= 0 || !Number.isFinite(s.width)) {
    push(`${path}/width`, 'must be a positive number');
  }
  if (typeof s.height !== 'number' || s.height <= 0 || !Number.isFinite(s.height)) {
    push(`${path}/height`, 'must be a positive number');
  }
}
