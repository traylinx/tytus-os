# Atomek

Atomek is the TytusOS workbench for local files, code, markdown, chat, artifacts, and local computer agents. It runs inside TytusOS, but it is published as its own Tytus app so it can move faster than the OS shell.

Use Atomek when you want to open a real folder, inspect or edit files, ask an AI about the active file, preview patches, or launch an installed local agent with the same context.

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

## Computer / Agents

The **Computer / Agents** activity is the bridge to real tools installed on the machine. It replaces duplicate extension panels.

It discovers local capabilities through the Tytus host bridge, for example:

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

## Open in Terminal

**Open in Terminal** launches the TytusOS terminal with the current workspace context. Use it when you want the full interactive shell and can supervise the command.

Good uses:

- run tests
- inspect git state
- launch a local CLI manually
- run a project command that needs a real terminal

The terminal is backed by the Tytus tray PTY bridge and starts in the relevant local workspace when possible.

## Run local job

A local job is for supervised background work by an installed local agent. It should receive a typed task plus Atomek context, stream output into **Outputs**, and return reviewable artifacts or patch previews.

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
| Old UI or duplicate Computer/Agents icons | Hard-refresh TytusOS. Confirm Atomek is loaded from `tytus-app-atomek@v0.4.13` or newer. |
| Files are listed but editor is blank | Reopen the file, then hard-refresh. If still broken, report the file type and console error. |
| Folder does not expand/collapse | You are likely on an older bundle. Refresh and check the Atomek version. |
| Chat answer appears only after completion | Streaming path is degraded. Check browser console and host `/v1/chat/completions` proxy errors. |
| Remote pod call gets CORS errors | The app is calling a remote endpoint directly. Route through the Tytus host proxy instead. |
| Local tool missing | Install the CLI/tool, then click **Refresh capabilities** in Computer / Agents. |
| Model picker shows an obsolete model | Update global AIL configuration. Do not hardcode the model in Atomek. |

## Contributor rules

- Keep Atomek app code in the standalone `tytus-app-atomek` repo.
- Keep TytusOS as the shell/host, not a forked Atomek implementation.
- Do not change JULI3TA internals while fixing Atomek.
- Do not hardcode AIL model IDs.
- Do not bypass the host bridge for pod, local-tool, or remote-model access.
- User-visible behavior changes must update this manual and regenerate `tytus-cli/os-docs.md`.
