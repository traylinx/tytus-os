/**
 * Featured apps catalog — curated list of user apps the App Store
 * surfaces with one-click Install. Each entry points at a manifest URL
 * served from a public github.com/traylinx/tytus-app-* repo via jsDelivr.
 *
 * Phase 10: source of truth is the remote catalog at
 * https://cdn.jsdelivr.net/gh/traylinx/tytus-app-catalog@<tag>/featured.json
 * — adding a featured app no longer requires an OS update. The App Store
 * fetches once per mount with `loadFeaturedApps()`. If the fetch fails
 * (offline, jsDelivr blip), we fall back to the hardcoded `FEATURED_APPS`
 * baked into the bundle so the section is never empty when the network
 * misbehaves.
 *
 * The App Store filters this list against the live installed_apps table
 * — only entries whose id is NOT already present render with an Install
 * button. Already-installed entries fall through to the regular
 * "Installed apps" / "System apps" sections.
 */

export interface FeaturedApp {
  /** Must match the `id` in the published tytus-app.json — the App Store
   *  uses this to filter out already-installed entries. */
  id: string;
  name: string;
  description: string;
  /** Lucide icon name (kept as a string so this file has zero import
   *  weight in the catalog declaration; the rendering component maps
   *  these to actual Lucide components). */
  icon: string;
  category: string;
  /** Manifest URL the App Store hands to `installAppFromManifestUrl`. */
  manifestUrl: string;
}

const ALL_FEATURED_APPS: FeaturedApp[] = [
  {
    id: 'text-editor',
    name: 'Text Editor',
    description: 'Plain-text editor with multi-file tabs, syntax highlighting, search/replace, and word-wrap.',
    icon: 'FileText',
    category: 'Productivity',
    manifestUrl: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-text-editor@v0.1.1/tytus-app.json',
  },
  {
    id: 'code-editor',
    name: 'Code Editor',
    description: 'Code editor with file tree, syntax highlighting, and live folder watch.',
    icon: 'Code2',
    category: 'DevTools',
    manifestUrl: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-code-editor@v0.1.0/tytus-app.json',
  },
  {
    id: 'markdown-preview',
    name: 'Markdown Preview',
    description: 'Live markdown editor and preview with split-pane view.',
    icon: 'FileCode',
    category: 'Productivity',
    manifestUrl: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-markdown-preview@v0.1.0/tytus-app.json',
  },
  {
    id: 'photo-editor',
    name: 'Photo Editor',
    description: 'Photo editor with crop, rotate, filters, and brightness/contrast adjustments.',
    icon: 'Image',
    category: 'Media',
    manifestUrl: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-photo-editor@v0.1.0/tytus-app.json',
  },
  {
    id: 'api-tester',
    name: 'API Tester',
    description: 'Postman-style HTTP request builder with collections, history, and environments.',
    icon: 'Plug',
    category: 'DevTools',
    manifestUrl: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-api-tester@v0.1.0/tytus-app.json',
  },
  {
    id: 'juli3ta',
    name: 'JULI3TA',
    description: 'Full AI-native music creator for Tytus OS. Create songs, lyrics, covers, and manage your local music workbench.',
    icon: 'juli3ta:mark',
    category: 'Creative',
    manifestUrl: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-juli3ta@juli3ta-0.2.15/tytus-app.json',
  },
];

const REPLACED_BY_FORGE_FALLBACK_IDS = new Set([
  'text-editor',
  'code-editor',
  'markdown-preview',
]);

export const FEATURED_APPS: FeaturedApp[] = ALL_FEATURED_APPS.filter(
  (app) => !REPLACED_BY_FORGE_FALLBACK_IDS.has(app.id),
);

/** URL of the remote Featured catalog. Bumped per OS release; the
 *  catalog repo is independently versioned so featured-app additions
 *  don't require a Tytus OS rebuild. v0.7.0 publishes verified standalone
 *  JULI3TA v0.2.1. */
export const FEATURED_CATALOG_URL =
  'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-catalog@v0.7.0/featured.json';

/**
 * Denylist of catalog ids the OS will refuse to auto-install at boot,
 * regardless of what the remote catalog says. Empty now that stale
 * JULI3TA v0.0/v0.1 rows are handled by `cleanupJuli3taAlphaIfPresent`
 * and verified standalone JULI3TA starts at v0.2.x.
 */
export const AUTO_INSTALL_DENYLIST: ReadonlySet<string> = new Set();

interface RemoteCatalogShape {
  version?: number;
  apps?: unknown;
}

function parseRemoteCatalog(raw: unknown): FeaturedApp[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as RemoteCatalogShape;
  if (!Array.isArray(data.apps)) return null;
  const out: FeaturedApp[] = [];
  for (const entry of data.apps) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.id !== 'string' ||
      typeof e.name !== 'string' ||
      typeof e.description !== 'string' ||
      typeof e.icon !== 'string' ||
      typeof e.category !== 'string' ||
      typeof e.manifestUrl !== 'string'
    ) {
      continue;
    }
    if (!e.manifestUrl.startsWith('https://')) continue;
    out.push({
      id: e.id,
      name: e.name,
      description: e.description,
      icon: e.icon,
      category: e.category,
      manifestUrl: e.manifestUrl,
    });
  }
  return out;
}

/**
 * Load the Featured catalog. Tries the remote URL first; on any failure
 * (network, parse, validation) returns the hardcoded `FEATURED_APPS` so
 * the App Store always renders something useful.
 *
 * Test seam: pass a `fetchImpl` to drive deterministic behaviour without
 * touching the network. Production calls global `fetch`.
 */
export async function loadFeaturedApps(opts?: {
  url?: string;
  fetchImpl?: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  signal?: AbortSignal;
}): Promise<FeaturedApp[]> {
  const url = opts?.url ?? FEATURED_CATALOG_URL;
  const fetchImpl =
    opts?.fetchImpl ??
    ((u: string) =>
      fetch(u, { signal: opts?.signal }).then(async (r) => ({
        ok: r.ok,
        json: () => r.json(),
      })));
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return FEATURED_APPS;
    const body = await res.json();
    const parsed = parseRemoteCatalog(body);
    if (parsed && parsed.length > 0) return parsed;
    return FEATURED_APPS;
  } catch {
    return FEATURED_APPS;
  }
}
