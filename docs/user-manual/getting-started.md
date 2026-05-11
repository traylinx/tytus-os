# Getting Started

TytusOS is the desktop for your private AI pods. It runs in a browser tab or installed web app, but the data and control plane come from the local `tytus` tray daemon.

## Install path

Fresh machine flow:

1. Install `tytus` for your OS.
2. Start the tray daemon.
3. Sign in once from the tray or TytusOS login screen.
4. Allocate a pod or use the included All LLM Gateway.
5. Use Files, Channels, Pod Inspector, Terminal, and apps from TytusOS.

Typical commands during development/support:

```bash
tytus setup
tytus tray start
tytus open
```

## First screen

If you are not signed in, TytusOS shows **Sign in to Tytus**. The button opens the normal one-time browser sign-in flow. After approval, the screen refreshes automatically.

If the top bar says **Session expired**, your pods are still running. Open **Settings -> Daemon** and choose **Sign in again**.

## Desktop basics

- Left top bar: Tytus app icon and context-aware app menu.
- Right top bar: daemon/session status, pod count, included gateway, notifications, date/time.
- Left desktop icons: product surfaces such as Pod Inspector, Channels, Settings, Files, Terminal, Browser.
- Bottom dock: pinned apps and running apps.
- Windows: drag, resize, focus, minimize, maximize, close.

## First useful actions

If you are new to the agent-team workflow, read these next: **Tytus Resource Fabric**, **OpenClaw, Hermes, and Local Agents**, **Shared Folders**, and **Tytus Use Cases**. They explain how the local computer, pods, shared folders, local agents, channels, and apps work as one system.


| Need | Open |
|---|---|
| See pods and gateway URLs | Pod Inspector |
| Copy OpenAI-compatible env vars | Pod Inspector -> Copy env |
| Browse local workspace | Files -> Tytus Home |
| Browse a pod workspace | Files -> Pod NN workspace |
| Edit local files and ask AI with file context | Atomek |
| Launch local agents with active file context | Atomek -> Agent Team |
| Coordinate OpenClaw, Hermes, local agents, shared folders, and apps | Atomek -> Start mission |
| Learn workflows inside the product | Help -> Resource Fabric / Agents / Shared Folders / Use Cases, or Atomek -> Docs & Skills |
| Configure Telegram/Discord/Slack/etc. | Channels |
| Fix expired login | Settings -> Daemon |
| Check shared folders | Settings -> Sharing or Files -> Shared |
| Run CLI commands | Terminal |
| Change theme/wallpaper/dock | Settings -> Appearance / Background / Dock |

## Tytus Home

Tytus creates a user workspace at `~/Tytus` on install or first launch. It is the default terminal and file-browser home.

Default structure:

```text
~/Tytus/
├── Downloads/
├── Inbox/
├── Logs/
├── Outbox/
├── Pods/
├── Projects/
├── Shared/
└── README.md
```

## What is real

Real production surfaces:

- Pod Inspector and included All LLM Gateway details
- Pod allocation/install status and readiness checks
- Files over Tytus Home, shared folders, and pod workspaces
- Channels setup
- Terminal backed by the host shell through the tray daemon
- Atomek workbench for local files, chat, artifacts, embedded docs, app skills, and local Resource Fabric cockpit
- Settings for account, daemon, sharing, appearance, dock, language, privacy, updates
- Music Creator and other Tytus apps that use the included gateway

Demo/optional apps may exist behind the demo-app toggle. They must not block core pod workflows.
