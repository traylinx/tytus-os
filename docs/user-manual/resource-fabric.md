# Tytus Resource Fabric

The Tytus Resource Fabric is the part of Tytus that turns separate tools into one working team. It connects the local computer, Tytus pods, OpenClaw, Hermes, shared folders, local agent CLIs, app skills, channels, and approval gates around a single user goal.

Use it when work is bigger than one chat answer: repo repair, document production, media generation, research, app automation, or any job where local files and remote pods need to exchange context.

## What the fabric connects

| Resource | What it does | Where the user sees it |
|---|---|---|
| Local computer | Owns real files, terminals, installed apps, browser sessions, and local AI CLIs. | TytusOS Terminal, Files, Atomek, local apps |
| Tytus Home | Default local workspace, logs, downloads, missions, and shared files. | `~/Tytus`, Files, Terminal |
| Shared folders | Exchange layer between local agents, pods, and apps. | Files -> Shared, mission folders, Garage bindings |
| OpenClaw | Fast Tytus pod agent for critique, planning, channel/app workflows, and remote execution. | Pod Inspector, Atomek Agent Team |
| Hermes | Heavier reasoning pod family when allocated. Use for deeper planning, writing, and review. | Pod Inspector, Atomek Agent Team |
| Local agents | Installed tools such as Claude Code, OpenCode, Codex, pi, Kimi, Gemini, Qwen, or Aider. | Terminal, Atomek local jobs |
| App skills | Instructions and drivers for apps such as Atomek, JULI3TA, Blender, Remotion, and future local tools. | App manifests, Atomek Docs & Skills |
| Channels | Supported messenger setup. Telegram, Discord bot, and Slack Socket Mode are current OpenClaw-backed flows; LINE and other messengers are beta, manual/custom, or planned unless the UI says otherwise. | Channels app |
| AIL routes | Global model routes for remote and local AI. Apps discover these; they do not hardcode model ids. | Settings, Atomek settings, top bar |

## The core loop

1. **Create a mission** in Atomek or a shared folder.
2. **Collect context**: files, selected text, screenshots, links, task notes, resource list.
3. **Choose resources**: OpenClaw, Hermes, local CLI, app skill, shared folder, channel.
4. **Dispatch work** through Tytus host bridges, not raw browser fetches.
5. **Save transcripts and outputs** into the mission folder.
6. **Review changes** as previews, artifacts, or proposals.
7. **Approve and publish** only after the user sees the result.

This keeps autonomous work useful without turning the browser app into an unsafe shell.

## Mission folders

A mission folder is the safest default exchange format. It is ordinary files on disk, so every agent can understand it.

Typical structure:

```text
~/Tytus/Missions/<mission>/
├── MISSION.md        # human goal, rules, context
├── MISSION.json      # machine-readable contract
├── RESOURCES.md      # pods, local tools, folders, apps, skills
├── TASKS.md          # current task graph
├── HANDOFF.md        # copy-paste resume summary
├── INBOX.md          # incoming notes from agents/pods
├── OUTBOX.md         # approved outputs for user handoff
├── AUDIT.jsonl       # append-only events
├── RUNS.jsonl        # reloadable run index
├── runs/             # transcripts
├── outputs/          # generated files and final artifacts
├── proposals/        # patch/write/publish proposals
├── approvals/        # explicit approval records
└── NEXT.md           # next action
```

Agents should write into `runs/`, `outputs/`, or `proposals/` first. They should not blindly edit the source project unless the user approved the exact patch or workflow.

## What makes this useful

The user can run several different agents without losing state:

- OpenClaw writes a critique into the mission folder.
- Hermes writes a deeper plan or final copy.
- OpenCode or Claude Code runs against the local repo and writes a patch proposal.
- Atomek previews the patch and keeps the active files visible.
- JULI3TA, Blender, Remotion, or another app skill consumes the same mission assets.
- Channels notify the user or route handoffs to another workspace.

The important part is not one specific model. The important part is shared context, typed resources, visible outputs, and approval gates.

## Safety rules

- Apps must use the Tytus host/tray bridge for local files, pods, terminals, and model routes.
- Browser apps must not direct-fetch pod or gateway URLs that need same-origin proxying.
- Live Help / Ask Tytus Docs uses `/api/help/*` on the local tray bridge, which proxies to Traylinx Cortex; the browser never receives Cortex database credentials or service tokens.
- Apps must not hardcode model names. AIL routes define available model aliases globally.
- Local jobs must use allowlisted tools, not arbitrary shell from model text.
- Destructive actions need explicit confirmation.
- Generated edits should become previews or proposals before they touch project files.

## First mission to try

1. Open **Atomek**.
2. Click **Start mission**.
3. Use a goal such as: `Review this repo with OpenClaw and local OpenCode, write findings to the mission folder, then propose a patch for approval.`
4. Attach the active folder or important files.
5. Run the pod/local tasks.
6. Open `runs/` and `proposals/` before applying anything.

