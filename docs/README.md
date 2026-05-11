# TytusOS Documentation

This folder documents the TytusOS desktop that ships with the `tytus` tray daemon. Keep these docs current with the live product, not the old Tower or early demo-OS skeleton.

## User manual

| Doc | What it covers |
|---|---|
| [getting-started.md](user-manual/getting-started.md) | Fresh install, sign-in, desktop, pods, first actions |
| [settings.md](user-manual/settings.md) | Real Settings panels, session expiry, daemon recovery, updates |
| [files.md](user-manual/files.md) | Tytus Home, shared folders, pod workspace, Inbox/Outbox/Downloads |
| [atomek.md](user-manual/atomek.md) | Atomek workbench, editor, chat, AIL routing, Resource Fabric cockpit, app skills |
| [troubleshooting.md](user-manual/troubleshooting.md) | Session, readiness, CORS, files, terminal, Atomek, theme issues |
| [about.md](user-manual/about.md) | Product positioning, naming, install surfaces |
| [windows.md](user-manual/windows.md) | Window controls |
| [desktop.md](user-manual/desktop.md) | Desktop icons and wallpaper |
| [dock.md](user-manual/dock.md) | Dock behavior |
| [launcher.md](user-manual/launcher.md) | Launcher behavior |
| [keyboard-shortcuts.md](user-manual/keyboard-shortcuts.md) | Keyboard reference |
| [apps-catalog.md](user-manual/apps-catalog.md) | App list. Keep demo apps clearly marked. |

## Architecture

| Doc | What it covers |
|---|---|
| [overview.md](architecture/overview.md) | Stack, directory map, daemon relationship |
| [state-management.md](architecture/state-management.md) | Client state, persistence, daemon state |
| [windowing.md](architecture/windowing.md) | Window manager internals |
| [app-system.md](architecture/app-system.md) | App registry and routing |
| [theming.md](architecture/theming.md) | Shared CSS tokens for dark/light/accent |

## Development

| Doc | What it covers |
|---|---|
| [contributing.md](development/contributing.md) | Style and PR conventions |
| [adding-an-app.md](development/adding-an-app.md) | App registration and menu integration |
| [testing.md](development/testing.md) | Test/type/lint/build gates |
| [user-manual.md](development/user-manual.md) | How Help docs, markdown registry, and CLI os-docs bundling work |
| [roadmap.md](development/roadmap.md) | Migration roadmap. Treat old Tower references as historical unless explicitly marked active. |

## Bundled docs

The `tytus-cli` repo owns the AI-facing bundled manual:

- `tytus os-docs`
- `tytus link [DIR]`
- `tytus_os_docs` MCP tool

When user behavior changes here, follow [development/user-manual.md](development/user-manual.md), then update the CLI manual and central handbook too:

- `services/tytus-cli/os-docs.md`
- `services/tytus-cli/docs/guides/tytus-ecosystem.md`
- `~/Documents/TYTUS-OS/USER-GUIDE.md`
- `~/Documents/TYTUS-OS/MIGRATION-TEST-MANUAL.md`
