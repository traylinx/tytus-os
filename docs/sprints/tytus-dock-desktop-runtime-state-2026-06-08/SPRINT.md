# Sprint: Tytus Dock Desktop Runtime State

Date: 2026-06-08
Owner: Harvey
Status: **IMPLEMENTED — validation passed with known unrelated lint debt**

## Problem

Pinned desktop apps in the Tytus OS Dock can now launch correctly via `/api/apps/open`, but the Dock treats them differently from internal Tytus OS windows:

- Click has no durable visual feedback while the native app is opening.
- The Dock active dot is based on `dockItems.isOpen`, which is only updated by internal `OPEN_WINDOW` / `CLOSE_WINDOW` flows.
- External desktop apps such as Open Design launch outside the Tytus window manager, so the Dock does not know they are running.
- Result: Open Design opens, but Dock still looks inactive.

## User-visible target behavior

When user clicks a pinned desktop app in the Dock:

1. Icon immediately enters **opening** state.
2. Tytus calls `/api/apps/open` as today.
3. Dock polls/receives runtime state from tray daemon.
4. When the native app process is detected, icon shows the normal active dot.
5. If the app exits, active dot disappears.
6. If launch fails or times out, opening state clears and no false active dot remains.

This must work for macOS, Windows, and Linux.

## Scope

### In scope

- Add backend runtime detection for desktop catalog apps.
- Add frontend runtime polling for Dock-visible desktop apps.
- Add Dock visual state: opening/loading and running active dot.
- Keep current launch/install/App Store behavior intact.
- Cross-platform process detection strategy.
- Tests for API shape and Dock state derivation.

### Out of scope

- Changing App Store install logic.
- Changing desktop app catalog structure beyond minimal runtime metadata.
- Deep window-management integration for native apps.
- Native OS event hooks / accessibility permissions.
- Releasing before tests pass.

## Current architecture findings

### Frontend

- Dock code: `services/tytus-os/app/src/components/Dock.tsx`
- Dock items come from `state.dockItems`.
- Active dot renders only when `item?.isOpen` is true.
- Internal apps update `isOpen` through `OPEN_WINDOW`, `CLOSE_WINDOW`, `MINIMIZE_WINDOW`, etc.
- Desktop apps are represented by App Store catalog entries and loaded through `client.getStoreApps()`.
- Desktop app launch path in Dock:
  - If `getAppById(appId)` returns no internal app, Dock calls `client.postAppOpen(appId)`.
  - On success it only bounces icon. It does not mark runtime state.

### Backend

- App catalog endpoint: `GET /api/apps`.
- App health endpoint: `POST /api/apps/check`.
- Desktop launch endpoint: `POST /api/apps/open`.
- Launch implementation: `launch_catalog_app()` in `services/tytus-cli/tray/src/web_server.rs`.
- It validates catalog app id and launch spec, then launches via platform open/terminal helpers.
- No endpoint currently reports whether launched desktop apps are running.

## Proposed implementation phases

### Phase 1 — Runtime metadata and backend status endpoint

Add minimal catalog/runtime support without changing existing launch behavior.

Deliverables:

- New endpoint, recommended:
  - `POST /api/apps/runtime`
  - Request: `{ "app_ids": ["open-design", "openwork"] }`
  - Response: `{ "results": [{ "id": "open-design", "running": true, "status": "running", "detail": null }] }`
- Pure helper functions for runtime detection.
- Catalog runtime metadata support, recommended optional fields:
  - `runtime.process_names`: `string[]`
  - `runtime.bundle_ids`: `string[]` for macOS where available
  - `runtime.window_titles`: optional future field, not required now
- Backward compatible fallback:
  - For `launch.kind = "app"`, use launch target as a process-name candidate.
  - For `launch.kind = "terminal"`, use target command basename as candidate.

Cross-platform detection baseline:

- macOS:
  - Prefer `pgrep -x <process>` for exact process names.
  - Optional AppleScript/System Events fallback only if needed; avoid requiring Accessibility permissions.
  - For `.app` target like `Open Design`, process candidate should include `Open Design` and normalized basename.
- Linux:
  - `pgrep -x <process>` or `/proc` scan fallback.
  - AppImage/binary names from catalog runtime metadata.
- Windows:
  - PowerShell `Get-Process -Name <name> -ErrorAction SilentlyContinue` or `tasklist` fallback.
  - Strip `.exe` in process-name matching.

Acceptance:

- Endpoint returns deterministic JSON for installed/not-installed/running/not-running.
- Invalid IDs rejected same as `/api/apps/open`.
- Broken/uninstalled apps return `running: false` without crashing.
- Existing `/api/apps/open`, `/api/apps/check`, `/api/apps/install` unchanged.

### Phase 2 — Frontend daemon client + Dock runtime polling

Deliverables:

- Add typed daemon client method:
  - `postAppsRuntime(appIds: string[])`
- Add runtime result types and guards in `services/tytus-os/app/src/lib/daemon.ts` / `types/daemon`.
- In Dock:
  - Track `openingDesktopApps: Set<string>` locally.
  - Track `runningDesktopApps: Set<string>` from daemon polling.
  - Poll only desktop app ids visible in Dock, not entire catalog.
  - Poll interval target: 2s while opening, 5–10s when idle.
  - Also refresh on window focus / visibility change.

Acceptance:

- Clicking Open Design immediately shows opening state.
- Opening state clears when runtime says running.
- If runtime never says running, opening clears after timeout (recommended 20–30s) and error stays non-invasive.
- Runtime polling aborts/cleans up on unmount.

### Phase 3 — Dock visual states

Deliverables:

- Running desktop app dot uses same visual language as internal `isOpen` dot.
- Opening state is visible but subtle:
  - small spinner ring around/near icon OR pulsing icon opacity.
  - no layout shift.
- Internal apps must remain unchanged.
- Desktop app click while already running should still call open/focus behavior if platform supports it; otherwise just bounce and keep dot.

Acceptance:

- Internal Tytus apps still show dot exactly as before.
- Desktop apps show dot when external process is alive.
- Open Design icon keeps real app logo and active dot.
- No duplicate Dock items.

### Phase 4 — Tests and local reload

Deliverables:

- Rust unit tests for runtime matching helpers.
- Frontend unit test for daemon shape guard.
- Dock component/state derivation test where practical.
- Local build:
  - `npm run build --workspace app`
  - `npm run i18n:check --workspace app`
  - relevant Vitest tests
- Local tray reload for Sebastian to test.

Acceptance:

- No new i18n drift.
- Existing App Store/Dock behavior preserved.
- Desktop runtime dot verified manually with Open Design.

## Risk controls

- Keep runtime state separate from persisted `dockItems.isOpen`; do not pollute internal window manager state with external process state.
- Do not add OS permissions or Accessibility dependencies.
- Do not change install/open catalog resolution except adding optional metadata.
- Do not block Dock render on daemon calls.
- Runtime endpoint should fail soft: if detection errors, app is `running: false` with detail, not frontend crash.

## Definition of done

Implementation result: see `IMPLEMENTATION-RESULT.md`.

- Open Design pinned in Dock:
  - click → opening indicator immediately
  - app opens → active dot appears
  - app quits → dot disappears within polling interval
- Same mechanism works for at least one internal app regression check and one desktop app check.
- Code built and tested locally.
- Sprint docs updated with implementation result before release.
