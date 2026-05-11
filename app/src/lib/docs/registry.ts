// ============================================================
// Tytus OS Help — bundled-docs registry
// ============================================================
//
// Surfaces every user-manual markdown file as a typed entry the Help
// app can render. Vite globs the sibling `docs/` folder at build time:
// drop a new .md file into `tytus-os/docs/user-manual/` and it shows
// up in the Help sidebar after the next dev-server reload — no code
// change required.
//
// Production output is fully static — `vite build` inlines every
// matched .md as a JS string chunk, so the runtime never reads files.
// The `server.fs.allow: ['..']` line in vite.config.ts is what lets
// the dev server cross out of `app/` to read the docs folder.
//
// Glob roots:
//   `../../../../docs/user-manual/*.md`     → main manual
//   `../../../../docs/troubleshooting/*.md` → sub-manuals (clipboard, …)
//
// Path math (from app/src/lib/docs/registry.ts):
//   .. → app/src/lib/
//   ../.. → app/src/
//   ../../.. → app/
//   ../../../.. → tytus-os/
//   ../../../../docs/… → the markdown sources

const userManualGlob = import.meta.glob(
  '../../../../docs/user-manual/*.md',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const troubleshootingGlob = import.meta.glob(
  '../../../../docs/troubleshooting/*.md',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

export interface DocEntry {
  /** filename without .md, e.g. "getting-started" */
  slug: string;
  /** parsed from the first H1, falls back to slug */
  title: string;
  /** raw markdown body */
  body: string;
  /** "user-manual" | "troubleshooting" — drives sidebar grouping */
  section: 'user-manual' | 'troubleshooting';
  /** lucide-react icon name (caller resolves) — heuristic-mapped from slug */
  icon: string;
  /** rough word count for search ranking + a "5 min read" estimate */
  wordCount: number;
}

// Lucide icon name for each known slug. Anything not in this map falls
// back to a generic "FileText". Keep these aligned with the Sprint A+B
// settings.md / apps-catalog.md tone — no decorative icons.
const ICON_FOR_SLUG: Record<string, string> = {
  'getting-started': 'Rocket',
  'resource-fabric': 'Network',
  agents: 'UsersRound',
  'shared-folders': 'FolderSync',
  'use-cases': 'Workflow',
  windows: 'AppWindow',
  desktop: 'Monitor',
  dock: 'LayoutPanelTop',
  launcher: 'LayoutGrid',
  'keyboard-shortcuts': 'Keyboard',
  files: 'Folder',
  atomek: 'AppWindow',
  settings: 'Settings',
  'apps-catalog': 'AppWindow',
  troubleshooting: 'Wrench',
  about: 'Info',
  clipboard: 'ClipboardList',
};

// Sidebar order. Anything not listed sorts alphabetically AFTER the
// known entries. Putting Getting Started first matches the manual's
// own README ordering and the os-docs.md concatenation order in
// tytus-cli/scripts/regen-os-docs.sh.
const RECOMMENDED_ORDER: string[] = [
  'getting-started',
  'resource-fabric',
  'agents',
  'shared-folders',
  'use-cases',
  'windows',
  'desktop',
  'dock',
  'launcher',
  'keyboard-shortcuts',
  'files',
  'atomek',
  'settings',
  'apps-catalog',
  'troubleshooting',
  'clipboard',
  'about',
];

const slugFromPath = (p: string): string =>
  p.split('/').pop()!.replace(/\.md$/, '');

const titleFromBody = (body: string, fallback: string): string => {
  const m = body.match(/^# (.+)$/m);
  return m ? m[1].trim() : fallback;
};

const wordCount = (body: string): number =>
  body.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length;

const buildEntries = (
  modules: Record<string, string>,
  section: DocEntry['section'],
): DocEntry[] =>
  Object.entries(modules).map(([path, body]) => {
    const slug = slugFromPath(path);
    return {
      slug,
      title: titleFromBody(body, slug),
      body,
      section,
      icon: ICON_FOR_SLUG[slug] ?? 'FileText',
      wordCount: wordCount(body),
    };
  });

const orderIndex = (slug: string): number => {
  const idx = RECOMMENDED_ORDER.indexOf(slug);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
};

const sortByOrder = (a: DocEntry, b: DocEntry): number => {
  const ai = orderIndex(a.slug);
  const bi = orderIndex(b.slug);
  if (ai !== bi) return ai - bi;
  return a.slug.localeCompare(b.slug);
};

/** All bundled docs, sorted in recommended reading order. */
export const DOCS: DocEntry[] = [
  ...buildEntries(userManualGlob, 'user-manual'),
  ...buildEntries(troubleshootingGlob, 'troubleshooting'),
].sort(sortByOrder);

export const findDoc = (slug: string): DocEntry | undefined =>
  DOCS.find((d) => d.slug === slug);

/** Substring search across title + body. Case-insensitive. */
export const searchDocs = (query: string): DocEntry[] => {
  const q = query.trim().toLowerCase();
  if (!q) return DOCS;
  return DOCS.filter(
    (d) =>
      d.title.toLowerCase().includes(q) ||
      d.body.toLowerCase().includes(q),
  );
};

/** Estimated read time in minutes (200 wpm). */
export const readingTimeMin = (doc: DocEntry): number =>
  Math.max(1, Math.round(doc.wordCount / 200));
