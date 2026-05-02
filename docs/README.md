# Tytus OS Documentation

Everything you need to use, understand, contribute to, or extend Tytus OS.

The same files power the in-OS **Help** app — keep them parseable, voice-consistent, and self-contained.

## User manual
For people running Tytus OS.

| Doc | What it covers |
|---|---|
| [getting-started.md](user-manual/getting-started.md) | First boot, login, the desktop |
| [windows.md](user-manual/windows.md) | Drag, resize, close, minimize, maximize, Alt+Tab |
| [desktop.md](user-manual/desktop.md) | Icons, drag, right-click, wallpaper |
| [dock.md](user-manual/dock.md) | Pinning, indicators, restore from dock |
| [launcher.md](user-manual/launcher.md) | App grid, search, categories, frequently used |
| [keyboard-shortcuts.md](user-manual/keyboard-shortcuts.md) | Every shortcut in one table |
| [settings.md](user-manual/settings.md) | Appearance, display, sound, power, accent color |
| [apps-catalog.md](user-manual/apps-catalog.md) | All 52 built-in apps, one line each |
| [troubleshooting.md](user-manual/troubleshooting.md) | Common issues + how to fix |
| [about.md](user-manual/about.md) | What Tytus OS is, where it's going |

## Architecture
For contributors and curious users.

| Doc | What it covers |
|---|---|
| [overview.md](architecture/overview.md) | Stack, directory map, who-talks-to-whom |
| [state-management.md](architecture/state-management.md) | `useOSStore`, reducer, contexts, persistence |
| [windowing.md](architecture/windowing.md) | `WindowFrame`, `WindowManager`, drag/resize internals |
| [app-system.md](architecture/app-system.md) | Registry contract, `AppRouter`, `AppPlaceholder` |
| [theming.md](architecture/theming.md) | CSS variables, dark/light, accent colors |

## Development
For people working on Tytus OS itself.

| Doc | What it covers |
|---|---|
| [contributing.md](development/contributing.md) | Style, commits, PRs |
| [adding-an-app.md](development/adding-an-app.md) | Step-by-step: from icon to dispatch |
| [testing.md](development/testing.md) | `npm run test:smoke` + the 52-app sweep |
| [roadmap.md](development/roadmap.md) | The 6-phase strangler-port plan into Tytus daemon |

## Reference
- [INTEGRATION-DEEPDIVE.md](../INTEGRATION-DEEPDIVE.md) — original architecture decision (Tytus Tower → Tytus OS migration)
- [GitHub repo](https://github.com/traylinx/tytus-os) (private)

## Bundled into tytus-cli

This entire `user-manual/` folder is concatenated into `tytus-cli/os-docs.md` and embedded into the `tytus` binary at build time. The same content is exposed three ways for AI agents (Claude Code, OpenCode, Gemini, Codex, Cursor, Vibe, Aider, Archon):

- `tytus os-docs` — prints the bundled manual to stdout
- `tytus link [DIR]` — drops the manual as `.tytus/os-manual.md` in the target project
- `tytus_os_docs` MCP tool — same content over MCP (auto-allowed in injected `.mcp.json`)

When markdown files in `user-manual/` change, regenerate the bundle:
```bash
cd ../../tytus-cli && ./scripts/regen-os-docs.sh
```
