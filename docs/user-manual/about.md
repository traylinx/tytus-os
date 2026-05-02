# About Tytus OS

Tytus OS is the desktop interface for [**Tytus**](https://tytus.traylinx.com), a private AI pod product by Traylinx. It runs in a browser tab and looks like a real OS — boot, login, desktop, dock, draggable windows.

## What problem it solves

Operating an AI pod today means juggling a tray icon, a hidden web page (Tytus Tower), and a scattered set of CLI commands. Tytus OS unifies all of that into a single coherent surface — the way a Mac unifies "files I can see + apps I can launch + system settings I can change" into one desktop.

## What's in v1

A working web-OS shell with 50 apps:

- **8 Tytus surfaces** — Pod Inspector, Settings, Chat, Files, Channels, Help, Terminal, Browser. Some functional today, some still placeholders.
- **42 OS-feel utilities** — Notes, Todo, Calendar, Calculator, image / video / music players, code editor, API tester, drawing apps, games. All real and working.

The shell itself (window manager, dock, launcher, notifications) is **complete and verified** — every interaction has an automated smoke test.

## What's coming

The roadmap is a 6-phase strangler-port from the legacy "Tytus Tower" web UI bundled in `tytus-cli`:

1. **Foundation cleanup** ✅ shipped
2. **Typed daemon client + auth bridge** — what unblocks real pod data
3. **Settings + Pod Inspector** — first real pod-management surfaces
4. **Chat + streamed runs**
5. **Files + Channels**
6. **Deprecate Tower** — the old page goes away

Full plan: [roadmap.md](../development/roadmap.md). Original architecture decision: [INTEGRATION-DEEPDIVE.md](../../INTEGRATION-DEEPDIVE.md).

## Where it lives

- **Code:** <https://github.com/traylinx/tytus-os> (private)
- **Daemon it talks to:** [tytus-cli](https://github.com/traylinx/tytus-cli)
- **Parent platform:** [Traylinx](https://traylinx.com)
- **Documentation:** this folder

This entire user manual is also bundled into the `tytus` CLI itself — run `tytus os-docs` to print it as a single markdown blob, or `tytus link` to drop it as `.tytus/os-manual.md` in any project so AI CLIs (Claude Code, OpenCode, Gemini, Codex, Cursor, Vibe, Aider) can answer Tytus-OS questions natively. The MCP tool `tytus_os_docs` exposes the same content over MCP.

## Naming

- **Tytus OS** (one word) — this product
- **Tytus** — the AI-pod product family
- **Traylinx** — the company / brand
- **Wannolot** — the internal codename for the pod-orchestration tier (you'll see it in commits)
- **Makakoo** — the parent organization

## Built with

- Vite 7 + React 19 + TypeScript 5.9
- Tailwind CSS 3 + shadcn-style primitives (Radix UI)
- lucide-react icons
- Playwright (smoke + sweep tests)

## License

Private. Not yet open-sourced. (When it is, expected: Apache 2.0.)

## Contact

For now: open issues in the GitHub repo. A user-facing support flow ships with the Help app in Phase 4.
