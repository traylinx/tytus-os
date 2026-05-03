# Maintaining the User Manual

The user manual is the **source of truth for how TytusOS looks and behaves** — it powers three surfaces simultaneously:

1. The **Help app** inside TytusOS (browseable at `#/help/<slug>`)
2. The browseable docs in this repo (`docs/user-manual/*.md`)
3. The **bundled-into-tytus-cli LLM reference** (`tytus os-docs`, `.tytus/os-manual.md` after `tytus link`, the `tytus_os_docs` MCP tool)

When you change a manual page, all three surfaces update — the trick is knowing where the dynamism happens.

## File layout

```
tytus-os/
├── docs/
│   ├── user-manual/        ← every page is one .md, kebab-case slug
│   │   ├── getting-started.md
│   │   ├── windows.md
│   │   ├── desktop.md
│   │   ├── dock.md
│   │   ├── launcher.md
│   │   ├── keyboard-shortcuts.md
│   │   ├── files.md
│   │   ├── settings.md
│   │   ├── apps-catalog.md
│   │   ├── troubleshooting.md
│   │   └── about.md
│   └── troubleshooting/    ← deep-dive subpages
│       └── clipboard.md
└── app/
    └── src/
        ├── lib/
        │   ├── docs/registry.ts       ← Vite glob → typed registry
        │   └── markdown.ts            ← shared markdown→HTML renderer
        └── apps/Help.tsx              ← consumes registry
```

## The dynamic registry

`app/src/lib/docs/registry.ts` uses Vite's `import.meta.glob`:

```ts
const userManualGlob = import.meta.glob(
  '../../../../docs/user-manual/*.md',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
```

Vite scans the folder **at build time**, generates static imports for every match, and bundles each markdown file into the JS output as a string. The runtime never reads files — production is fully static.

What that means in practice:

- **Drop a new `.md` into `docs/user-manual/`** → on the next dev-server reload it shows up in the Help app sidebar with title parsed from its `# H1`. No code change.
- **Edit an existing `.md`** → Vite HMR pushes the new content into the running OS in dev. Production gets the new content on the next `vite build`.
- **Delete an `.md`** → it disappears from the registry on next reload.

The `server.fs.allow: ['..']` line in `vite.config.ts` (and `vitest.config.ts`) is what lets Vite cross out of `app/` to read the sibling `docs/` folder.

## Adding a new manual page

1. Create the file. Slug = filename without `.md`. Use kebab-case.
   ```bash
   touch docs/user-manual/printing.md
   ```
2. Write the page. The first `# H1` becomes the sidebar title.
   ```markdown
   # Printing

   TytusOS prints via …
   ```
3. (Optional) Slot the slug into the recommended-order list in `app/src/lib/docs/registry.ts`:
   ```ts
   const RECOMMENDED_ORDER: string[] = [
     'getting-started',
     // …
     'printing',          // ← add here in the position you want
     'troubleshooting',
     // …
   ];
   ```
   Slugs not in the list sort alphabetically after the known ones.
4. (Optional) Pick a lucide-react icon for the sidebar:
   ```ts
   const ICON_FOR_SLUG: Record<string, string> = {
     // …
     printing: 'Printer',
   };
   ```
   Then add `Printer` to the lucide imports in `app/src/apps/Help.tsx` and to the `DOC_ICON` map there. Anything not mapped falls back to the generic `FileText` icon.
5. Save. The dev server reloads, the page appears in the sidebar.

That's it. The registry tests in `app/src/lib/docs/registry.test.ts` will fail if you add a slug to `EXPECTED_SLUGS` but the file doesn't exist (or vice versa) — keep them in sync when adding a permanent page.

## Editing an existing page

Open the file, edit, save. Vite HMR pushes the change into the running OS.

The Help app re-renders with the new content. No restart needed.

## Hash deep-links

Every page is addressable from anywhere in the OS:

```
#/help                              → Help app, default page (registry's first entry)
#/help/getting-started              → specific user-manual page
#/help/keyboard-shortcuts           → another user-manual page
#/help/clipboard                    → docs/troubleshooting/clipboard.md (sub-section)
#/help/doctor                       → diagnostic tab (Doctor)
#/help/test                         → diagnostic tab (Health test)
#/help/logs                         → diagnostic tab (Logs)
```

The router (`lib/router.ts`) parses `#/help/<tab>`. The shell-route mapper (`lib/shellRoutes.ts`) sends diagnostic ids through as-is and prefixes everything else with `docs:` so the Help app resolves it through the registry.

When linking from another part of the OS, prefer the hash form — it survives reloads:

```ts
import { navigate } from '@/lib/router';
navigate({
  kind: 'help',
  tab: 'keyboard-shortcuts',
  params: new URLSearchParams(),
});
```

## Search

The Help sidebar has a "Search the manual…" input. It filters by title, body, and slug — case-insensitive substring match. No external index, just a single pass over `DOCS[]` per keystroke. Fast enough for ~12 pages of ~5KB each.

If the manual ever grows past ~50 pages, swap to a proper FTS index (e.g. minisearch).

## Bundling into tytus-cli (`tytus os-docs`)

The same markdown files also ship inside the `tytus` binary as a single concatenated `os-docs.md`, exposed three ways:

| Surface | How it's served |
|---|---|
| `tytus os-docs` | reads `os-docs.md` via `include_str!`, prints to stdout |
| `tytus link [DIR]` | drops `os-docs.md` as `.tytus/os-manual.md` in the target dir |
| `tytus_os_docs` MCP tool | returns the same content over MCP |

`os-docs.md` is **regenerated** from this folder by a script in the tytus-cli repo:

```bash
cd ../tytus-cli && ./scripts/regen-os-docs.sh
```

Run that whenever you change `docs/user-manual/*.md` or `docs/troubleshooting/*.md` and want the change to land in the next `tytus` release. Also mirror user-facing handbook changes into `~/Documents/TYTUS-OS/USER-GUIDE.md` and update `~/Documents/TYTUS-OS/MIGRATION-TEST-MANUAL.md` when the test surface changes. The script:

1. Concatenates the user-manual files in canonical reading order (same as the Help sidebar)
2. Appends the troubleshooting sub-pages
3. Writes `tytus-cli/os-docs.md`

Then build the binary:

```bash
cd ../tytus-cli && cargo build --release --bin tytus --bin tytus-mcp
```

The included markdown is checked at compile time (`include_str!` fails the build if `os-docs.md` is missing). Commit the regenerated `os-docs.md` alongside your tytus-cli changes.

## Verifying changes

Three checks, ordered cheap-to-expensive:

```bash
# 1. Type-check the registry + Help app
cd app && npx tsc --noEmit

# 2. Run the registry + routing + SSE tests (~30s)
npx vitest run src/lib/docs src/lib/shellRoutes src/hooks/useJobStream

# 3. Eyeball it in the dev server
npm run dev
# open http://localhost:4242, click the Help dock icon, navigate the manual,
# try the search box, deep-link via #/help/<slug>
```

If you also regenerated `os-docs.md`:

```bash
cd ../tytus-cli && cargo test --release --bin tytus --package atomek-cli --package tytus-mcp
./target/release/tytus os-docs | head -20    # smoke
./target/release/tytus link /tmp/link-smoke && cat /tmp/link-smoke/.tytus/os-manual.md | head
```

## Style guide for manual pages

Follow what's already there:

- Each page opens with `# Title` (one `<h1>`).
- Lead paragraph explains what the page is about in 1–2 sentences.
- Use `## H2` for sections, `### H3` for sub-sections — don't skip levels.
- Tables are great for "Setting → Effect" and "Shortcut → Action" — the markdown renderer handles GFM tables natively.
- Code blocks fence with triple backticks. Language hint optional.
- Cross-link with relative paths: `[settings.md](settings.md)`.
- No emojis unless they appear in the actual UI being documented.
- Inline `<code>` for keys, paths, file names, and CSS variables.
- Voice: clear, terse, second-person. Avoid marketing tone.

The Help app's renderer (`lib/markdown.ts`) handles:

- code blocks + inline code
- headings h1-h6
- bold/italic/strikethrough
- links (external opens in new tab)
- images
- ordered + unordered lists, task lists (`- [x]` / `- [ ]`)
- blockquotes (`> text`)
- horizontal rules (`---`)
- GFM tables

If you need something more exotic (callouts, footnotes, embedded diagrams), extend `lib/markdown.ts` and add a regression test in any new test file.

## What gets translated

UI strings live in `app/src/i18n/locales/*.ts`. The user manual is currently **English-only** — the translation pipeline ships UI strings, not long-form prose.

Future-compatible: the registry will look for `docs/{locale}/user-manual/*.md` first if a non-English locale becomes active, falling back to the canonical English. That code is not yet wired but the registry signature is shape-stable for it.

## When the registry shape changes

If you change `DocEntry` (e.g. add `category`, `lastUpdated`), update:

1. `app/src/lib/docs/registry.ts` — the type + builder
2. `app/src/lib/docs/registry.test.ts` — expand test coverage
3. `app/src/apps/Help.tsx` — consume the new field if it should surface
4. This page — document the new field

## Why we built it this way

- **No daemon round-trip.** The docs ship inside the OS bundle. Asking for `#/help/files` reads from JS memory, not network.
- **No new dependency.** The markdown renderer is one file. No `react-markdown`, no `marked`, no `remark`. Keeps the bundle small.
- **Drop-in dynamism.** Author writes markdown into a folder. No registry, no indexing, no build script. Vite handles it.
- **Same source for AI agents.** The exact bytes a user reads in the Help app are what an AI CLI gets via `tytus os-docs` / `tytus_os_docs`. One source of truth.
