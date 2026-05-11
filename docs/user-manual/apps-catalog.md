# Apps Catalog

TytusOS apps fall into two groups:

1. **Product surfaces** — required for daily Tytus usage and backed by the daemon/pods.
2. **Optional/demo utilities** — OS-feel tools or demos that must not block core pod workflows.

## Product surfaces

| App | What it does |
|---|---|
| Pod Inspector | Fleet overview, included gateway, readiness, pod detail tabs, restart/doctor/log/env/copy actions |
| System Settings | Account, Plan & Units, Pods, Agents, Daemon, Sharing, Background, Appearance, Dock, Languages, Notifications, Privacy, About |
| Files | Finder-like browser for `~/Tytus`, Inbox, Outbox, Downloads, Shared, and pod workspaces |
| Channels | Per-pod messenger/channel setup with token-safe flows |
| Terminal | Host-backed shell through the local tray daemon, starting in `~/Tytus` |
| Atomek | Monaco workbench for files, chat, artifacts, AIL routing, Resource Fabric cockpit, and app skills |
| Browser | Registered launchers and safe web/app links |
| Help | Bundled manual, troubleshooting, diagnostic links |
| Chat | Opens agent chat surfaces and pod UIs |
| Music Creator | Tytus music/lyrics workflow using the included gateway |

## Included gateway

The All LLM Gateway is not a normal pod app. It is always included, OpenAI-compatible, and exposed in Pod Inspector with private/public URLs and copy formats.

## Demo and utility apps

Demo utilities can be present behind **Settings -> Appearance -> Show demo apps**. Keep them clearly marked and never document them as required platform capability.

Examples: games, ASCII Art, Matrix Rain, local notes/todos/calculator, API Tester, media viewers.


## Agentic app skills

Some apps publish skills that Atomek and other agent surfaces can attach dynamically. A skill may describe how to inspect a project, generate a patch preview, launch a local tool, drive a media app, or connect to an external app bridge such as Blender MCP.

Rules for production skills:

- declare the dependency honestly
- show unavailable when the dependency is not installed
- run through the Tytus host bridge
- never direct-fetch pod/model endpoints from the browser
- never hardcode AIL model IDs in app code
- return reviewable artifacts or patch previews before writing files

## App documentation rule

If an app appears in the production launcher/dock by default, its manual entry must answer:

- What real backend or local storage it uses
- What user problem it solves
- What is not implemented yet
- Where to troubleshoot it

If the answer is “nothing real”, keep the app hidden behind the demo-app toggle.
