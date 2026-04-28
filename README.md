# tytus-os

The next-generation Tytus desktop UI. A web-OS shell that replaces the legacy "Tytus Tower" web page (vanilla HTML/JS bundled in `tytus-cli`).

```
services/tytus-os/
├── docs/                       ← user manual + architecture + dev guide
├── INTEGRATION-DEEPDIVE.md     ← architecture decision (Tytus Tower → TytusOS)
└── app/                        ← TytusOS web shell (Vite/React/TS/Tailwind)
    └── README.md
```

## Status

**Phase 1 complete (2026-04-28).** Foundation is verified — 52/52 apps open cleanly, zero console errors, smoke tests green.

| Layer | Status |
|---|---|
| Window manager (drag, resize, focus, min/max) | ✅ |
| Boot → Login → Desktop | ✅ |
| Dock + Launcher + Notifications | ✅ |
| 50 apps installed | ✅ (42 OS-feel + 8 Tytus surfaces) |
| Daemon connection | ⏳ Phase 2 |
| Pod Inspector functional | ⏳ Phase 3 |

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

A 6-phase strangler-port from Tytus Tower into TytusOS native apps. Daemon API frozen. Tray bridges preserved. See [docs/development/roadmap.md](docs/development/roadmap.md) and [INTEGRATION-DEEPDIVE.md](INTEGRATION-DEEPDIVE.md).

## Repo

- Code: <https://github.com/traylinx/tytus-os> (private)
- Daemon: [tytus-cli](https://github.com/traylinx/tytus-cli)
- Issues / discussion: GitHub issues
