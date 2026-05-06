# CURRENT STATUS — Forge VS Code Web Base

**Updated:** 2026-05-06

## Status

Implementation is in VS Code-web-base shape, visibly branded as **Tytus Forge**. Old Forge notebook/source/studio layout is no longer the default shell.

## Completed

- `packages/app-forge/src/Forge.tsx` now renders `WorkbenchShell` only.
- `packages/app-forge/src/workbench/*` owns the new base workbench.
- Visible product branding is now Tytus Forge:
  - app manifest name: `Tytus Forge`
  - launcher registry name: `Tytus Forge`
  - welcome page title: `Tytus Forge`
  - no visible `Visual Studio Code` product title in Forge UI
- VS Code-style structure exists:
  - Activity Bar
  - Explorer / Search / Source Control / Run / Extensions panes
  - Welcome screen
  - Open Editors + workspace tree
  - Monaco editor tabs
  - right Chat / Outputs side bar
  - bottom Problems / Output / Terminal panel placeholders
  - blue status bar
- File System Access API implemented:
  - `showOpenFilePicker()` for files
  - `showDirectoryPicker({ mode: 'readwrite' })` for folders
  - same-origin `window.top` fallback for Tytus app-frame cases
  - browser upload-style fallback only if real File System Access API is unavailable
- Monaco editor implemented:
  - one model per file path
  - language detection
  - minimap
  - dirty state
  - save / save all
  - cursor status updates
- Markdown preview split implemented using the local markdown renderer.
- Shortcuts implemented:
  - Cmd/Ctrl+O open file
  - Cmd/Ctrl+S save
  - Cmd/Ctrl+W close tab
  - Cmd/Ctrl+B toggle Explorer
  - Cmd/Ctrl+Shift+F search
  - Cmd/Ctrl+K or Cmd/Ctrl+P command palette
- Chat panel is deliberately honest:
  - no fake AI execution
  - no fake pod availability
  - local/deterministic placeholder only
- Layout persistence:
  - Explorer width
  - Chat width
  - panel visibility
  - Markdown preview visibility
- Latest gates pass:
  - `npm run typecheck --workspace @tytus/app-forge`
  - `npm run build --workspace @tytus/app-forge`
  - `npm exec -- vitest run packages/app-forge/src/index.test.ts packages/app-forge/src/repo/forgeRepo.test.ts packages/app-forge/src/recipes/studyPack.test.ts`
  - 3 test files / 11 tests passed
- Protected JULI3TA/music scan clean.

## Still pending after branding

1. Manual visual UAT in Chrome:
   - hard refresh Tytus OS
   - open Forge
   - compare against `https://vscode.dev/`
2. Default boot check:
   - Explorer active
   - no folder opened copy
   - Welcome tab/page
   - Chat side panel
   - no `Study something` / `Raw material` / Studio cards
3. Local file/folder UAT:
   - `Open Folder` should show native local chooser on Chromium
   - if it shows upload wording, browser frame permissions still block File System Access API
   - open `.md`, `.json`, `.ts`, `.css`, `.html`
   - edit/save and confirm dirty state clears
4. Markdown preview UAT:
   - open Markdown
   - toggle preview split
   - confirm rendering matches expected Markdown Preview quality
5. Chat close/open UAT:
   - close right panel
   - reopen from editor toolbar / command palette
   - editor should expand correctly
6. Console gate:
   - no SQLite table errors
   - no React style shorthand warnings
   - no Monaco worker errors
   - no uncaught File System Access errors on cancel
7. Final diff review, commit, and push.

## Known environment blocker

`harvey_browse` / agent-browser-harness has failed with:

```text
RuntimeError: no close frame received or sent
```

Lope Codex diagnosis: CDP/browser-harness transport issue, not Forge product bug.
Use manual Chrome UAT or headless screenshot once the local dev server is running.

## Commands

```bash
cd /Users/sebastian/Projects/makakoo/api/ProjectWannolot/services/tytus-os

npm run typecheck --workspace @tytus/app-forge
npm run build --workspace @tytus/app-forge
npm exec -- vitest run \
  packages/app-forge/src/index.test.ts \
  packages/app-forge/src/repo/forgeRepo.test.ts \
  packages/app-forge/src/recipes/studyPack.test.ts

if git diff --name-only | grep -Ei 'juli|juli3ta|music|audio|player|packages/app-music|app-julieta'; then
  echo "Protected JULI3TA/music path changed — stop" >&2
  exit 1
fi
```
