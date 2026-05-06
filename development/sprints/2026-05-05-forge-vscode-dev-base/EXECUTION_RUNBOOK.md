# Execution Runbook — Forge VS Code Web Base

## Pre-flight

```bash
cd /Users/sebastian/Projects/makakoo/api/ProjectWannolot/services/tytus-os
git status --short
```

Current repo already has uncommitted Forge MVP work. Do **not** commit before the VS Code base is corrected.

## First implementation moves

1. Create `packages/app-forge/src/workbench/` modules.
2. Move File System Access API wrapper into `workbench/fileAccess.ts`.
3. Replace current `Forge.tsx` with composition:
   - `WorkbenchShell`
   - `ActivityBar`
   - `ExplorerPane`
   - `WelcomePage`
   - `EditorGroup`
   - `SecondarySidebar`
   - `StatusBar`
4. Disconnect boot UI from `useForgeData` initial selected card.
5. Keep `useForgeData` imported only where future extension/task panel needs it; ideally not in default shell.
6. Reuse Monaco dependency but create new `WorkbenchMonacoEditor` for files.
7. Run gates.

## Do not do

- Do not polish old `Forge.tsx` layout.
- Do not add more recipes/studio cards.
- Do not create new public apps.
- Do not touch JULI3TA/music.
- Do not claim real filesystem if using upload fallback.

## Gate sequence

```bash
npm run typecheck --workspace @tytus/app-forge
npm run build --workspace @tytus/app-forge
npm run test --workspace app -- ../packages/app-forge/src/recipes/studyPack.test.ts ../packages/app-forge/src/repo/forgeRepo.test.ts ../packages/app-forge/src/index.test.ts
if git diff --name-only | grep -Ei 'juli|juli3ta|music|audio|player|packages/app-music|app-julieta'; then
  echo "Protected JULI3TA/music path changed — stop" >&2
  exit 1
fi
```

## Browser check

Use visible browser if `harvey_browse`/CDP is unstable.

Hard refresh after build. If old persisted Forge data still appears, implementation failed Phase 0.
