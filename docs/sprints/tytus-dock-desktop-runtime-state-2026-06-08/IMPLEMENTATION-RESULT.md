# Implementation Result — Dock Desktop Runtime State

Date: 2026-06-08
Status: implemented in local working tree; release/local hot-swap not performed in this sprint step.

## Implemented

- Added desktop app runtime metadata in `services/tytus-cli/tray/web/assets/apps.json` for every external desktop app currently in the App Store catalog.
- Added `POST /api/apps/runtime` in `tytus-tray`.
  - Input: `{ "app_ids": ["open-design", "openwork"] }`
  - Output: per-app `{ id, running, status, detail }`
  - macOS/Linux use exact process-name probing via `pgrep -x`.
  - Linux falls back to `/proc/*/comm` if `pgrep` is unavailable.
  - Windows uses `Get-Process` by process name.
- Added typed daemon client support in the Tytus OS frontend.
- Updated Dock behavior for desktop apps:
  - clicking a desktop app immediately puts its dock icon into `opening` state;
  - opening state shows a small spinner overlay;
  - Dock polls runtime state for visible desktop app icons only;
  - active dot appears when the daemon reports the desktop process running;
  - opening state clears when the app becomes running or after a 30s timeout;
  - active dot disappears after the app process quits on the next runtime poll.
- Preserved existing Tytus OS app window behavior.
- Preserved existing desktop app launch flow through `/api/apps/open`.

## Files touched for this sprint

- `services/tytus-cli/tray/web/assets/apps.json`
- `services/tytus-cli/tray/src/web_server.rs`
- `services/tytus-os/app/src/components/Dock.tsx`
- `services/tytus-os/app/src/lib/daemon.ts`
- `services/tytus-os/app/src/types/daemon/StoreApp.ts`
- `services/tytus-os/app/src/types/daemon/index.ts`
- `services/tytus-os/app/src/lib/fixture-regression.test.ts`

Note: the working tree already contained unrelated App Store, File Manager, CLI, and vendored bundle changes before/around this sprint. They were not reverted.

## Validation

Passed:

- `npm run i18n:check --workspace app`
- `npm run test --workspace app -- fixture-regression.test.ts --run`
- `npm run typecheck --workspace app`
- `npm run build --workspace app`
- `npx eslint src/components/Dock.tsx`
- `cargo test -p tytus-tray runtime_process_candidates`
- `cargo test -p tytus-tray apps_catalog_every_launchable_entry_has_runtime_candidates`

Known existing validation noise:

- Full `npm run lint --workspace app` still fails on pre-existing repository-wide lint debt, mainly generated `app/public/dev-atomek/dist/*`, legacy React compiler rules in unrelated files, and unrelated unused variables. `Dock.tsx` itself passes targeted ESLint.
- Vite build still emits existing warnings for CSS minification, static/dynamic DB imports, and bundle chunk size. Build exits `0`.

## Release readiness

Code is ready for local daemon hot-swap/release review from the dock-runtime perspective. Before release, review the unrelated working-tree changes so this sprint does not accidentally ship unrelated CLI/FileManager/AppStore changes unless intended.
