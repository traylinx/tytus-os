# QA / UAT Plan — Forge VS Code Web Base

## Automated gates

Run after each phase:

```bash
npm run typecheck --workspace @tytus/app-forge
npm run build --workspace @tytus/app-forge
npm run test --workspace app -- ../packages/app-forge/src/recipes/studyPack.test.ts ../packages/app-forge/src/repo/forgeRepo.test.ts ../packages/app-forge/src/index.test.ts
```

Protected app gate:

```bash
if git diff --name-only | grep -Ei 'juli|juli3ta|music|audio|player|packages/app-music|app-julieta'; then
  echo "Protected JULI3TA/music path changed — stop" >&2
  exit 1
fi
```

## Manual UAT — default boot

1. Hard refresh `http://localhost:4242`.
2. Open Forge.
3. Confirm default screen:
   - Explorer activity active.
   - Explorer says `NO FOLDER OPENED`.
   - Center shows Welcome tab/page.
   - Right side shows Chat placeholder.
   - No `Study something` or `Raw material` tab.
   - No Studio tiles on default view.

## Manual UAT — local file/folder

1. Click `Open Folder`.
2. Expected: native folder chooser / File System Access permission flow, not upload copy.
3. Select a small folder.
4. Explorer shows tree.
5. Click `.md`, `.json`, `.ts` files.
6. Tabs open.
7. Monaco syntax/language changes.
8. Edit file.
9. Tab marks dirty.
10. `Cmd+S` saves if write handle available.
11. Status bar updates language/line/column.

## Manual UAT — layout comparison

Open side-by-side:

- `http://localhost:4242` Forge
- `https://vscode.dev/`

Pass only if:

- default layout proportions are recognizably same
- welcome content location matches
- explorer no-folder text/buttons match
- chat side panel resembles VS Code chat side panel
- status bar same scale and position

## Console gate

No new errors:

- no SQLite table errors
- no React style shorthand warnings
- no Monaco worker errors
- no File System Access uncaught errors on cancel

## Failure conditions

Fail sprint if any of these appear:

- app still looks like old Forge notebook/studio layout
- Open Folder says upload on browsers that support File System Access API
- old SQLite data auto-opens after hard refresh
- primary UI mentions Study/Raw material/Forge recipes before user opens extension/task surfaces
- protected JULI3TA/music diff appears
