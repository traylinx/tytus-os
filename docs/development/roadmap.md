# Roadmap

Six phases, strangler-port. The full architectural decision lives at [INTEGRATION-DEEPDIVE.md](../../INTEGRATION-DEEPDIVE.md). This file is the operator-facing summary.

## Where we are

**Phase 1: Foundation cleanup** — ✅ shipped 2026-04-28.

- Boot / login / desktop / dock / window manager all functional
- 50 apps installed (8 Tytus surfaces + 42 OS-feel utilities)
- Zero console errors across 52 apps (sweep verified)
- Smoke tests cover window interactions + dock + launcher
- Repo at `traylinx/tytus-os`, private

The skeleton is locked. Phase 2 starts whenever Sebastian gives the word.

## What's next

### Phase 2 — Daemon client + types + auth bridge (2–3 days)

Goal: every app that needs pod data can fetch it from `tytus-cli` over a stable contract.

- **`lib/daemon.ts`** — port discovery (`/tmp/tytus/tray-web.port`), typed `fetch`, retry with exponential backoff, structured error model
- **Domain types** in `types/`: `Pod`, `Plan`, `Channel`, `Job`, `BindingRow`, `Catalog`, `StateSnapshot`
- **`hooks/useDaemonState.ts`** — react-query-style live `/api/state` poll with auto-revalidation
- **`hooks/useJobStream.ts`** — EventSource wrapper for SSE, handles reconnect + cancellation
- **Auth bridge** — `LoginScreen` reads daemon state; if unauthenticated, deep-links to tray's `tytus login` flow and polls until auth flips

**Acceptance:** the OS knows the user's plan tier, units used, and pod list. It does not yet *show* this — that's Phase 3.

### Phase 3 — Settings + Pod Inspector (3–4 days)

Goal: the two most-used tray destinations work natively in TytusOS.

- **Settings** gains a top strip: plan name, units used / total, "Upgrade" button, agent catalog with one-click install, autostart toggles, sign-out. Wi-Fi / Bluetooth panels either get a "Pod network" replacement or hide.
- **Pod Inspector** ships: per-pod card (env vars, URLs, copy buttons), restart / uninstall / revoke buttons that POST to `/api/pod/<n>/run-streamed` and stream into a built-in log pane
- **Tray deep-link router** — `#/pod/02/restart` opens Pod Inspector for pod 02 and auto-fires the restart

**Acceptance:** Tytus Tower's "Settings" and per-pod actions are now fully covered by TytusOS. Tower stays alive but most users won't need to click into it.

### Phase 4 — Chat + streamed runs (2–3 days)

- **Chat** wires to pod chat (either via `/api/pod/open` browser deep-link, or eventually inline via daemon proxy)
- **Help** wires to `/api/doctor`, daemon lifecycle, log tail
- Health-test surface inside Pod Inspector

**Acceptance:** `#chat`, `#/run/doctor`, `#/run/test` all native.

### Phase 5 — Files + Channels (3–4 days)

- **Files** integrates per-pod inbox, downloads, garage shared folders. The current virtual-FS hook gets a daemon-backed implementation.
- **Channels** ships: per-pod bindings list, Add Channel modal with token input (using shadcn `<Dialog>` — but tokens never touch the URL bar)
- All `/api/shared-folders/*` endpoints surfaced

**Acceptance:** Tytus Tower's last functional tabs are absorbed.

### Phase 6 — Deprecate Tower (1 day, gated on parity)

- Banner on the legacy Tower page: "This is now built into Tytus — open the OS"
- Tray menu items still pointing at Tower get rerouted in `tytus-cli` to open TytusOS
- After 2 weeks of zero-traffic on Tower routes (metric-gated), delete the Tower HTML/JS bundles + tower routes from `tytus-cli`

**Acceptance:** Tower is gone. Contract preserved. Tray ↔ OS bridge is the only path.

## Hard rules across all phases

1. **Tray ↔ daemon HTTP contract is frozen.** No endpoint renames, no breaking shapes. New endpoints OK.
2. **Tray fragment deep-links are frozen.** New ones OK, no breaking existing ones.
3. **The job_id + SSE pattern** — every long-running action returns `{job_id}`, streams via `/api/jobs/<id>/stream`. New OS apps must speak this.
4. **Token modals stay browser-secure.** Tokens never appear in URLs.
5. **Phase 2 lands before any feature porting.** The typed daemon client is the foundation for everything else; skipping it = "Tower with prettier CSS."

## Beyond Phase 6 (parking lot)

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
