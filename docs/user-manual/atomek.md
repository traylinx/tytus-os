# Atomek

Atomek is the TytusOS Resource Fabric cockpit for local files, code, markdown, chat, artifacts, mission folders, shared folders, local agents, OpenClaw/Hermes pods, and app skills. It runs inside TytusOS, but it is published as its own Tytus app so it can move faster than the OS shell.

Use Atomek when you want to open a real folder, inspect or edit files, ask an AI about the active file, preview patches, or coordinate local agents and Tytus pod agents through one shared mission context.

## Open files and folders

Atomek uses the browser File System Access API when the browser supports it.

Normal flow:

1. Open **Atomek** from the launcher or dock.
2. Click **Open Folder** or **Open File**.
3. Pick the local folder or file in the browser permission picker.
4. The Explorer shows the selected tree and recent folders.
5. Click a file to open it in a tab.

Folder rows are clickable. Use the chevron to expand or collapse child folders. Text files open in the Monaco editor. Markdown files can be edited and previewed.

## Editing

Atomek is a real editor surface, not a static preview.

- Open tabs show the current files.
- Text and markdown files are editable in Monaco.
- Save writes through the browser file handle after the browser has granted permission.
- Dirty files stay in memory until saved.
- Markdown preview is available from the editor surface.
- The layout reflows when the window resizes.

If the editor is blank after a release, hard-refresh TytusOS and reopen the file. A blank editor with a known text file usually means the browser still has an old Atomek bundle cached.

## Chat and context

The right panel is the Atomek chat surface. It is not separate from the workspace.

The chat can attach:

- the active file
- selected/open editor context
- typed prompt text
- generated artifacts
- preview edits
- resolved local app skills

Use the context chips above the input to see what will be sent. Deselect a chip when you do not want that context included.

Chat uses the Tytus host AI bridge. It must not hardcode model IDs in the app. Model/provider selection comes from the global AIL configuration exposed by the host. When global AIL changes, Atomek should pick up the new model list through settings and host state, not through source edits.

## Local AIL and remote AIL

Atomek can route chat through the host AIL settings:

- **Remote AIL**: the Tytus pod/gateway route.
- **Local AIL**: the local/private route exposed by the host if installed and enabled.

The model picker should show models discovered from the selected AIL route. If the picker shows an old model, check the global AIL configuration first. Do not patch Atomek with a hardcoded replacement model.

## Artifacts and patch previews

Atomek should convert AI output into reviewable artifacts, not blind writes.

Expected flow:

1. Ask for an edit or generated file.
2. Atomek stores the answer as an artifact or preview edit.
3. You inspect the diff or generated content.
4. You explicitly save/apply the result.

Use **Outputs** to inspect saved artifacts and agent job output. Code blocks should render as rich output with copy controls.

## Resource Fabric / Agent Team

The **Agent Team** activity is the bridge to the Tytus Resource Fabric. It replaces duplicate extension panels and avoids turning Atomek into another IDE clone.

Atomek coordinates local computer resources, shared folders, OpenClaw/Hermes pods, local agents, AIL routes, channels, and app skills through one mission context.

It discovers capabilities through the Tytus host bridge, for example:

- OpenClaw pod agents
- Hermes pod agents when allocated
- Tytus Terminal
- pi
- OpenCode
- Codex
- Claude Code
- Gemini
- Qwen
- Kimi
- Aider

Only allowlisted tools should launch from Atomek. The browser must not run arbitrary shell commands and must not direct-fetch pod or model endpoints that fail CORS. Local work goes through the same-origin Tytus tray/host bridge.

### Why shared folders matter

Shared folders are the exchange layer between the local computer and Tytus pods. Local agents can write plans, transcripts, patches, screenshots, and artifacts into the shared/mission folder; OpenClaw or Hermes pods can pick that context up and return their own outputs. This is the main Atomek workflow: local resources and remote resources working as one team while the user keeps the files visible and controllable.

### Mission packs

A mission pack is a tray-managed folder under **Tytus Home / Missions**. It gives agents and pods a shared working context without granting blind write access to your project.

A new mission writes a standard pack:

- `MISSION.md` — human-readable goal, context, resources, constraints, next steps
- `MISSION.json` — typed machine contract, selected resources, task graph, approval gates
- `RESOURCES.md` — selected pods, local agents, folders, apps, and skills
- `TASKS.md` — planned task graph
- `HANDOFF.md` — copy-paste summary for another agent/window
- `INBOX.md` / `OUTBOX.md` — lightweight shared-folder exchange points
- `AUDIT.jsonl` — append-only mission events
- `RUNS.jsonl` — reloadable run index for local/pod/app jobs
- `runs/` — transcripts
- `outputs/` — generated artifacts and handoff files
- `proposals/` — patch/write/publish proposals before approval
- `approvals/` — explicit approve/reject records
- `NEXT.md` — immediate next action

The Agent Team board can list and resume existing mission packs through `host.missions.list()`. Resuming a mission restores the mission badge, task graph, and context prompt.

### Team presets

Atomek does not ask the user to manually understand every tool. The front door offers presets generated from the live resource graph:

- **Repo Repair** — local implementer plus independent reviewer.
- **OpenClaw + Local** — OpenClaw/Hermes pod perspective plus local Claude/OpenCode/Codex/pi execution.
- **Creative Production** — app skills such as JULI3TA, Blender, and Remotion plus shared assets.
- **Research Watch** — pod/AIL research, local synthesis, shared-folder handoff, optional channels.

Each preset maps roles to real resources: planner, implementer, reviewer, Team Desk, and app tool when relevant. Missing resources show as setup-needed instead of fake availability.

### Resource graph

The setup view shows resources as a graph: pods, local agents, apps, shared folders, app skills, and the active workspace. Use **Use** to attach a resource to the current mission prompt. Use **Setup** when a missing dependency needs a local install command or app deep link.

### Task graph

The default mission task graph is deliberately small:

1. scope the mission and context with the planner role
2. execute or produce an artifact through the implementer/app role
3. run app-skill work when relevant
4. review, approve, and prepare handoff with the reviewer role

This keeps Atomek useful immediately while leaving room for richer multi-agent orchestration later.


## Ask pod

**Ask pod** sends the selected mission task to a ready pod agent through `host.daemon.callPodEndpoint()`. Atomek first asks the pod for `/v1/models`, selects the first live model returned by the pod metadata, then sends a non-streaming `/v1/chat/completions` request through the same-origin Tytus bridge. No model id is hardcoded in Atomek.

The pod response is saved like any other run:

- visible in the Runs panel
- captured in Outputs
- written under `runs/`
- indexed in `RUNS.jsonl`

If the pod gateway rejects the request or is unreachable, Atomek writes a failed run transcript instead of silently hiding the error.

## Open in Terminal

**Open in Terminal** launches the TytusOS terminal with the current workspace context. Use it when you want the full interactive shell and can supervise the command.

Good uses:

- run tests
- inspect git state
- launch a local CLI manually
- run a project command that needs a real terminal

The terminal is backed by the Tytus tray PTY bridge and starts in the relevant local workspace when possible.

## Run local job

A local job is for supervised background work by an installed local agent. It receives a selected mission task, the mission folder, selected resources, and Atomek context. Output streams into Atomek, is saved under `runs/`, and is also captured in **Outputs** so patches can become reviewable edit previews.

Atomek also writes `RUNS.jsonl` in the mission folder. That run index stores job id, tool, task, status, exit code, and transcript path so Atomek can reload mission history after a refresh or app restart. Older transcript files still appear as legacy run entries.

Use **Cancel** to stop a running job through the tray job bridge. Canceling sends a safe terminate request to the tracked child process; it does not delete the mission folder, `RUNS.jsonl`, or prior transcript output.

Rules:

- local jobs use allowlisted tools only
- outputs stream back into Atomek
- edits become previews before write/apply
- model selection remains global through AIL
- no arbitrary shell from model text

## Agentic app skills

Tytus apps can expose skills through manifests or sidecar docs. Atomek uses those skills to attach the right instructions and launch the right driver.

Examples:

| Skill | Current meaning |
|---|---|
| Atomek inspect project | Ask an agent to review the active workspace context. |
| Atomek patch preview | Ask for a unified diff or fenced replacement block for Atomek to preview. |
| Local terminal open | Open the TytusOS terminal with context. |
| JULI3TA create song | Hand off a music-generation task to JULI3TA where supported. |
| Blender MCP create scene | Use a Blender MCP/socket bridge when the Blender skill and local server are installed. |

Do not show fake support. If a skill or app driver is not installed, show it as unavailable with the missing dependency.

## Troubleshooting Atomek

| Problem | Fix |
|---|---|
| Old UI or duplicate Agent Team icons | Hard-refresh TytusOS. Confirm Atomek is loaded from `tytus-app-atomek@v0.4.19` or newer. |
| Files are listed but editor is blank | Reopen the file, then hard-refresh. If still broken, report the file type and console error. |
| Folder does not expand/collapse | You are likely on an older bundle. Refresh and check the Atomek version. |
| Chat answer appears only after completion | Streaming path is degraded. Check browser console and host `/v1/chat/completions` proxy errors. |
| Remote pod call gets CORS errors | The app is calling a remote endpoint directly. Route through the Tytus host proxy instead. |
| Local tool missing | Install the CLI/tool, then click **Refresh capabilities** in Agent Team / Setup. |
| Model picker shows an obsolete model | Update global AIL configuration. Do not hardcode the model in Atomek. |

## Contributor rules

- Keep Atomek app code in the standalone `tytus-app-atomek` repo.
- Keep TytusOS as the shell/host, not a forked Atomek implementation.
- Do not change JULI3TA internals while fixing Atomek.
- Do not hardcode AIL model IDs.
- Do not bypass the host bridge for pod, local-tool, or remote-model access.
- User-visible behavior changes must update this manual and regenerate `tytus-cli/os-docs.md`.
