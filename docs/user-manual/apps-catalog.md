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

Tytus itself publishes documentation skills through the tray host API:

- `tytus.docs.cli-reference` — current bundled CLI/tray/MCP/Cortex reference
- `tytus.docs.os-manual` — current bundled TytusOS user manual
- `tytus.docs.agentic-app-skills` — how agentic apps should discover and attach documentation skills

Agentic apps should use `host.skills.resolve({ prompt })` before answering Tytus product questions, then load the chosen markdown with `host.skills.get(id)`. The same skills are listed in Resource Fabric as `app-skill` resources.

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


## Remote app loading failures

Atomek and JULI3TA are versioned Tytus apps. If an app window says it cannot load because a module was served as `text/plain`, the browser rejected a raw GitHub module URL. This is a delivery/config issue, not a user data issue.

User recovery:

1. Refresh TytusOS.
2. Use **Settings -> Check for updates** / tray **Update Tytus** when available.
3. Reopen the app.
4. If it still fails, send support the app name, version, and the exact console line.

Support should verify the app manifest points to a JavaScript module endpoint with the right MIME type, preferably a pinned CDN/release asset such as jsDelivr or a bundled dist URL, not a raw GitHub URL served as `text/plain`. Current launch catalog baseline: Atomek `v0.4.33`, JULI3TA `juli3ta-0.3.24`.
