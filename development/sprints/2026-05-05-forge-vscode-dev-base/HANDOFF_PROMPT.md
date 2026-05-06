Continue the Forge VS Code Web Base sprint.

Repo:
`/Users/sebastian/Projects/makakoo/api/ProjectWannolot/services/tytus-os`

Sprint docs:
`/Users/sebastian/Projects/makakoo/api/ProjectWannolot/services/tytus-os/development/sprints/2026-05-05-forge-vscode-dev-base`

Read first:

1. `SPRINT.md`
2. `UX_CONTRACT.md`
3. `TECHNICAL_DESIGN.md`
4. `EXECUTION_RUNBOOK.md`
5. `QA_UAT_PLAN.md`

User goal:

Build the base app like `https://vscode.dev/` first. Only later connect Tytus apps, AI pods, agents, swarm, local AIL, recipes, media tools.

Hard constraints:

- Do not continue old Forge notebook/source/studio layout.
- Default boot must show VS Code-style welcome + `NO FOLDER OPENED`.
- Open Folder must use `showDirectoryPicker()` first, not upload input.
- Do not auto-open old SQLite Forge cards on boot.
- Do not touch JULI3TA/music.

First implementation step:

Replace `packages/app-forge/src/Forge.tsx` with a clean VS Code workbench shell backed by new `packages/app-forge/src/workbench/*` modules.

Gates:

```bash
npm run typecheck --workspace @tytus/app-forge
npm run build --workspace @tytus/app-forge
npm run test --workspace app -- ../packages/app-forge/src/recipes/studyPack.test.ts ../packages/app-forge/src/repo/forgeRepo.test.ts ../packages/app-forge/src/index.test.ts
if git diff --name-only | grep -Ei 'juli|juli3ta|music|audio|player|packages/app-music|app-julieta'; then
  echo "Protected JULI3TA/music path changed — stop" >&2
  exit 1
fi
```
