# tytus-os

TytusOS is the browser desktop for Tytus. It is served by the local `tytus` tray daemon and is now the primary user interface for pods, files, channels, settings, terminal, and app workflows.

Legacy Tower exists only as a rollback surface while cutover finishes. New user docs and support flows should point to TytusOS.

```
services/tytus-os/
├── app/                  Vite + React + TypeScript desktop shell
├── docs/                 user manual, architecture, development notes
└── INTEGRATION-DEEPDIVE.md
```

## Current product shape

| Surface | Current behavior |
|---|---|
| Desktop shell | macOS-like top bar, context-aware app menu, dock, draggable/resizable windows, launcher, desktop icons |
| Pod Inspector | Fleet overview, stable included gateway, per-pod status, readiness truth, pod actions, connection/env copying |
| Files | Finder-like browser for `~/Tytus`, Inbox, Outbox, Downloads, shared folders, and pod workspaces |
| Channels | Per-pod channel setup with safe token handling and agent-guided fallback for long-tail messengers |
| Settings | Account, Plan & Units, Pods, Agents, Daemon, Sharing, Background, Appearance, Dock, Languages, Notifications, Privacy, About |
| Terminal | Browser terminal backed by the host shell through the tray daemon; starts in `~/Tytus` |
| Atomek | Monaco workbench for local files, chat, artifacts, AIL model routing, and Computer / Agents local-tool bridge |
| Music Creator | TytusOS-native app using the included gateway, with pod readiness and session-state awareness |
| Session state | Expired login is visible and recoverable; running pods stay online while the user signs in again |
| Themes | Dark/light and accent system use shared tokens. New UI must not hard-code black icons on dark backgrounds. |

## Run locally

Development:

```bash
cd services/tytus-os/app
npm install
npm run dev
```

Production users do not run Vite directly. They install the tray app and open TytusOS from the tray menu or browser:

```bash
tytus tray start
tytus open
```

## Docs

- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/user-manual/getting-started.md`](docs/user-manual/getting-started.md) — first-use flow
- [`docs/user-manual/settings.md`](docs/user-manual/settings.md) — settings and session recovery
- [`docs/user-manual/files.md`](docs/user-manual/files.md) — Tytus Home, shared folders, pod workspaces
- [`docs/user-manual/atomek.md`](docs/user-manual/atomek.md) — Atomek workbench, chat, AIL routing, Computer / Agents
- [`docs/user-manual/troubleshooting.md`](docs/user-manual/troubleshooting.md) — user-support playbook
- `tytus os-docs` in `tytus-cli` — AI-agent friendly manual bundled with the CLI
- `~/Documents/TYTUS-OS/USER-GUIDE.md` — central handbook mirror for humans

## Quality gates

Before changing user-facing behavior, run from `app/`:

```bash
npm run test
npm run typecheck
npm run lint
npm run audit:radius
npm run build
```

Documentation-only changes should still run markdown/diff checks in the owning repo and update the central handbook when behavior changes.

## Repo links

- TytusOS app: <https://github.com/traylinx/tytus-os> (private)
- Tray daemon / CLI: <https://github.com/traylinx/tytus-cli> (private)
