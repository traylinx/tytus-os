/**
 * Featured apps catalog — curated list of user apps the App Store
 * surfaces with one-click Install. Each entry points at a manifest URL
 * served from a public github.com/traylinx/tytus-app-* repo via jsDelivr.
 *
 * Hardcoded today; future Phase 10 may fetch this list from a remote
 * registry so we can ship new featured apps without an OS update.
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

export const FEATURED_APPS: FeaturedApp[] = [
  {
    id: 'text-editor',
    name: 'Text Editor',
    description: 'Plain-text editor with multi-file tabs, syntax highlighting, search/replace, and word-wrap.',
    icon: 'FileText',
    category: 'Productivity',
    manifestUrl: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-text-editor@v0.1.0/tytus-app.json',
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
];
