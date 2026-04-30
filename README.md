# tytus-os

The next-generation Tytus desktop UI. A web-OS shell that replaces the legacy "Tytus Tower" web page (vanilla HTML/JS bundled in `tytus-cli`).

```
services/tytus-os/
├── docs/                       ← user manual + architecture + dev guide
├── INTEGRATION-DEEPDIVE.md     ← architecture decision (Tytus Tower → Tytus OS)
└── app/                        ← Tytus OS web shell (Vite/React/TS/Tailwind)
    └── README.md
```

## Status

**Phases 1–7 complete (2026-04-28).** Foundation + daemon-wired surfaces shipped in one session. 71/71 vitest tests green.

| Layer | Status |
|---|---|
| Window manager (drag, resize, focus, min/max) | ✅ |
| Boot → Login → Desktop | ✅ |
| Dock + Launcher + Notifications | ✅ |
| 50 apps installed | ✅ (42 OS-feel + 8 Tytus surfaces) |
| Daemon connection (typed client + state hook + SSE) | ✅ Phase 2 |
| Pod Inspector functional | ✅ Phase 3b |
| Settings (Account / Plan / Pods / Agents / Daemon) | ✅ Phase 3a |
| Help (Doctor / Test / Logs / About) + Command Palette | ✅ Phase 4 |
| Channels / Files / Browser apps | ✅ Phase 5 |
| Demo apps toggle | ✅ Phase 6 |
| Shared folders + Desktop pin | ✅ Phase 7 |

Full status: [docs/SKELETON-STATUS.md](docs/SKELETON-STATUS.md).

## Run

```bash
cd app && npm install && npm run dev
```

→ http://localhost:4242

## Documentation

Everything is in [`docs/`](docs/README.md):

- **User manual** — getting started, windows, dock, launcher, keyboard shortcuts, apps catalog, settings, troubleshooting
- **Architecture** — stack, state management, windowing internals, app system, theming
- **Development** — contributing, adding an app, testing, roadmap

The same files will load into the in-OS **Help** app once Phase 4 wires it up.

## Phase plan

A 6-phase strangler-port from Tytus Tower into Tytus OS native apps. Daemon API frozen. Tray bridges preserved. See [docs/development/roadmap.md](docs/development/roadmap.md) and [INTEGRATION-DEEPDIVE.md](INTEGRATION-DEEPDIVE.md).

**Shipped 2026-04-28:**
- ✅ Phase 1 — Foundation (boot/login/desktop/dock/window manager + 52 apps)
- ✅ Phase 2 — Daemon client + Secret brand type + state/job hooks + hash router + same-origin guard
- ✅ Phase 3a — Zero-pods overlay + Settings (Account / Plan / Pods / Agents / Daemon) + install wizard
- ✅ Phase 3b — Pod Inspector (Fleet Overview, per-pod tabs, streamed actions, typed-name revoke confirm, per-pod pin)
- ✅ Phase 4 — Help app + Command Palette (Cmd+K) + window state persistence + Chat link launcher
- ✅ Phase 5 — Channels + Files (Inbox/Downloads) + Browser
- ✅ Phase 6 — `isDemo` flag + Settings → Display "Show demo apps" toggle
- ✅ Phase 7 — Files: Shared folders tab + Desktop reserved-zone pin (4×2 top-left grid)

**Deferred (Phase 8 candidates):**
- ⏳ Per-pod logs SSE tail — daemon gap (`/api/logs?name=pod-NN` doesn't exist; run-streamed allowlist lacks `logs` action)
- ⏳ Tower removal in tytus-cli — gated on "no Tower bundle linked from any tray menu for 14 days" trigger (manifest Q7)
- ⏳ Desktop pin v2 — manifest §2.5 "user icons cannot be displaced by pin" rule (current Phase 7 simplification accepts visual overlap)

## Repo

- Code: <https://github.com/traylinx/tytus-os> (private)
- Daemon: [tytus-cli](https://github.com/traylinx/tytus-cli)
- Issues / discussion: GitHub issues
