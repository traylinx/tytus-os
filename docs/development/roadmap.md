# Roadmap

Six phases, strangler-port. The full architectural decision lives at [INTEGRATION-DEEPDIVE.md](../../INTEGRATION-DEEPDIVE.md). This file is the operator-facing summary.

## Where we are

**Phases 1–7 all shipped 2026-04-28** in a single session across 8 feature branches. 71/71 vitest tests green.

| Phase | Status | Branch |
|---|---|---|
| Phase 1 — Foundation cleanup | ✅ shipped 2026-04-28 | (skeleton freeze) |
| Phase 2 — Daemon client + auth bridge | ✅ shipped 2026-04-28 | `phase-2/daemon-client` + `phase-2/security-floor` (tytus-cli) |
| Phase 3a — Zero-pods overlay + Settings + Install wizard | ✅ shipped 2026-04-28 | `phase-3a/zero-pods-and-install` |
| Phase 3b — Pod Inspector | ✅ shipped 2026-04-28 | `phase-3b/pod-inspector` |
| Phase 4 — Help app + Command Palette | ✅ shipped 2026-04-28 | `phase-4/help-app` |
| Phase 5 — Channels + Files + Browser | ✅ shipped 2026-04-28 | `phase-5/channels-files-browser` |
| Phase 6 — Demo apps toggle | ✅ shipped 2026-04-28 | `phase-6/demo-apps-toggle` |
| Phase 7 — Shared folders + Desktop pin | ✅ shipped 2026-04-28 | `phase-7/shared-folders-and-desktop-pin` |

## What shipped

### Phase 1 — Foundation cleanup ✅ (2026-04-28)

- Boot / login / desktop / dock / window manager all functional
- 50 apps installed (8 Tytus surfaces + 42 OS-feel utilities)
- Zero console errors across 52 apps (sweep verified)
- Smoke tests cover window interactions + dock + launcher
- Repo at `traylinx/tytus-os`, private

### Phase 2 — Daemon client + types + auth bridge ✅ (2026-04-28, `phase-2/daemon-client` + `phase-2/security-floor`)

- **`lib/daemon.ts`** — full daemon client, 28+ methods (`getState`, `getCatalog`, `postLaunch`, `postInstall`, `postLogout`, …)
- **Opaque `Secret` brand type** with `revealSecret(s, "user_gesture")` literal type-gate
- **`DaemonResult<T>` envelope** with 9 error categories
- **`useDaemonState` hook** — 5s poll, A1a immediate / A1b 3-fail offline banner
- **`useJobStream` hook** — SSE consumer with late-subscribe deadline
- **Hash-fragment router** with nonce preservation (`#/run/doctor`, `#/pod/02/restart`, `#/settings/agents`)
- **Auth bridge** — `LoginScreen` reads `state.logged_in`, polls; user signs in via tray menu
- **Security floor (tytus-cli)** — `Sec-Fetch-Site: same-origin` POST guard + nosniff on the daemon

### Phase 3a — Zero-pods overlay + Settings + Install wizard ✅ (2026-04-28, `phase-3a/zero-pods-and-install`)

- **ZeroPodsOverlay** shell-level CTA when `state.agents = []`
- **Settings panels**: Account, Plan & Units, Pods, Agents, Daemon (sidebar groups: Tytus | System with divider)
- **Install wizard modal** with Retry on failure + auto-refresh on success
- **1-click install** via `?install=auto` deep-link from overlay
- **Pod cards** with copy + reveal (Secret-typed user_key, ui_url token)
- **Sign-out confirmation modal** (the destructive bug from 2026-04-28 caught us)
- Refresh buttons on Plan + Pods, plan tier breakdown by pod
- Persisted active Settings category in localStorage

### Phase 3b — Pod Inspector ✅ (2026-04-28, `phase-3b/pod-inspector`)

- **Fleet Overview** table — sortable, search, status pills
- **Per-pod tabs** — URLs / env / status / actions
- **Action streaming** via run-streamed: Restart, Doctor (daemon-wide), Stop forwarder, Refresh creds
- **Uninstall** soft confirm modal
- **Revoke** hard confirm — typed-name confirmation (mirrors the 2026-04-28 logout-wipe lesson)
- **Restart-all** batch op
- **TopPanel Fleet Health strip** — color-coded chip showing pod count + active jobs
- **Per-pod pin** — Fleet table star + Pod tab marker, persisted in localStorage with 8-pod cap

### Phase 4 — Help app + streamed runs ✅ (2026-04-28, `phase-4/help-app`)

- **Help app**: Doctor / Health Test / Logs / About tabs
- **Logs tab** polls `/api/logs?name=daemon|startup&offset=N` with pause/resume + auto-scroll
- **Command Palette** (Cmd+K / Ctrl+K) — modal, search, Apps / Pods / System sections, ↑↓ wraps, Enter executes
- **Window state persistence** — open windows persist to localStorage, restore on reload
- **Chat app v1** — link launcher (sidebar of pods + "Open Pod NN in browser →" button per pod)

### Phase 5 — Channels + Files + Browser ✅ (2026-04-28, `phase-5/channels-files-browser`)

- **Channels** — pods sidebar + Available/Configured columns + token-secure Add modal (token in body, never URL)
- **Files** — Inbox + Downloads tabs (run-streamed ls-inbox; postFilesOpenDownloads → Finder)
- **Browser** — URL bar with scheme validation + registered launchers + Quick Actions

### Phase 6 — Demo apps toggle ✅ (2026-04-28, `phase-6/demo-apps-toggle`)

- **Manifest AN8** — `isDemo` flag on Games + ASCII Art + Matrix Rain
- **Settings → Display** "Show demo apps" toggle (default off for paid users)
- **AppLauncher** filters demo apps + hides Games tab when off

### Phase 7 — Shared folders + Desktop pin ✅ (2026-04-28, `phase-7/shared-folders-and-desktop-pin`)

- **Files: Shared folders tab** — bind modal, pick-folder via osascript, sync-now, open in Finder
- **Desktop reserved-zone pin** — 4×2 top-left grid for pinned pods, click opens Pod Inspector tab

## Hard rules across all phases

1. **Tray ↔ daemon HTTP contract is frozen.** No endpoint renames, no breaking shapes. New endpoints OK.
2. **Tray fragment deep-links are frozen.** New ones OK, no breaking existing ones.
3. **The job_id + SSE pattern** — every long-running action returns `{job_id}`, streams via `/api/jobs/<id>/stream`. New OS apps must speak this.
4. **Token modals stay browser-secure.** Tokens never appear in URLs.
5. **Phase 2 lands before any feature porting.** The typed daemon client is the foundation for everything else; skipping it = "Tower with prettier CSS."

## Deferred (Phase 8 candidates)

1. **Per-pod logs SSE tail** — daemon gap. `/api/logs?name=pod-NN` doesn't exist, and the run-streamed allowlist lacks a `logs` action. Needs a tytus-cli daemon change before TytusOS can wire it.
2. **Tower removal in tytus-cli** — manifest Q7 trigger gate: "no Tower bundle linked from any tray menu for 14 days." Not yet armed; can ripout after the gate fires.
3. **Desktop pin v2** — manifest §2.5 says "user icons cannot be displaced by pin." Current Phase 7 simplification accepts visual overlap; v2 needs reserved-zone reflow + collision-aware grid.

## Beyond Phase 8 (parking lot)

- Code splitting per app (drop boot bundle from 363 KB to ~150 KB gzipped)
- Real auth flow (no more "Unlock with any password")
- Window snapping (drag to edge)
- Per-app keyboard shortcut registration
- Self-hosted fonts (offline-friendly)
- Settings → "Pod network" panel replacing Wi-Fi/Bluetooth decoration
- A real recoverable Trash app
- Multi-monitor / external-display support
- ⌘+Q to quit an app (today only Ctrl+W closes one window)

## Things explicitly NOT on the roadmap

- An app store / installable third-party apps (out of scope for v1)
- Cross-tab sync via BroadcastChannel (interesting; not load-bearing)
- A native desktop wrapper (Tauri / Electron) — TytusOS is web-first
- Mobile responsive layout — desktop OS metaphor only
- Offline-first / PWA — possible later, not Phase 1–6

## How sprint planning works after Phase 1

Each phase becomes a sprint doc at `~/Projects/makakoo/sprints/tytus-os-phase-<n>-<slug>/SPRINT.md` (per the no-sprint-docs-in-repos rule). The phase doc captures:

- Goal
- Acceptance criteria
- File-by-file change list
- Test plan
- Lope / codex consult outcomes

Sprints close when their acceptance criteria green-light.
