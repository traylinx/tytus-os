# Tytus Use Cases

These workflows show how Tytus, OpenClaw, Hermes, local agents, shared folders, Atomek, and apps fit together.

## 1. Repair a repo with a team

Goal: fix a bug without losing evidence or letting one model blindly edit files.

1. Open the repo folder in **Atomek**.
2. Start a mission: `Find root cause, propose patch, run tests, save proof.`
3. Attach the active file or folder context.
4. Ask **OpenClaw** for a fast critique and task split.
5. Run **OpenCode**, **Claude Code**, **Codex**, or **pi** locally through Terminal or Atomek local job.
6. Save transcript under `runs/` and proposed patch under `proposals/`.
7. Ask **Hermes** or another reviewer for risk review when available.
8. Apply only approved diffs.
9. Put final status in `OUTBOX.md`.

## 2. Build a document package

Goal: produce a client-ready brief from scattered notes.

1. Create a mission folder.
2. Put source notes, PDFs, screenshots, and requirements in `INBOX.md` or `inputs/`.
3. Ask OpenClaw to extract claims, gaps, and risks.
4. Ask Hermes to synthesize structure and tone.
5. Ask a local agent to write markdown files.
6. Review in Atomek markdown preview.
7. Export final files to `outputs/`.

## 3. Creative production across apps

Goal: make a song/video/scene with agents and local apps.

1. Store brief, references, lyrics, audio, and image assets in a mission folder.
2. Use **JULI3TA** for music generation or restyle tasks.
3. Use **Blender** or **Remotion** skills when installed for scenes and renders.
4. Ask agents to generate prompts, check style consistency, and prepare handoffs.
5. Keep every source asset and final render in `outputs/`.

## 4. Shared-folder pod handoff

Goal: let a remote pod consume files from the local computer and return output.

1. Put files into `~/Tytus/Shared/<job>/` or a Garage-bound folder.
2. Push/copy relevant inputs to the pod workspace if needed.
3. Ask OpenClaw or Hermes to process the files.
4. Pull outputs back or let sync return them.
5. Review with Atomek.

## 5. Channel-supervised agent work

Goal: keep the user informed while agents work.

1. Configure Channels for the pod or user account.
2. Create a mission folder with clear rules.
3. Dispatch an agent task.
4. Agent writes status to the mission folder and sends channel updates when configured.
5. User approves proposals from Atomek or the channel workflow.

## 6. Local app automation

Goal: use installed desktop apps without rebuilding them inside Atomek.

1. Install the app and its Tytus/agent skill if available.
2. Refresh capabilities in Atomek.
3. Attach the relevant files or mission folder.
4. Launch the app or local bridge through Tytus host integration.
5. Keep artifacts in the mission folder.

Examples: Blender MCP scene generation, Remotion render recipes, JULI3TA music workflows, browser checks, local terminal tasks.

## 7. Research watch

Goal: monitor a topic and produce a concise report.

1. Start a mission with a topic and sources.
2. Use a pod or AIL route for research.
3. Use a local agent for synthesis and citation cleanup.
4. Store raw findings in `runs/`.
5. Store final report in `OUTBOX.md`.

## Rules that apply to every use case

- Use shared files for context handoff.
- Use Atomek when you need visibility, editing, and approval.
- Use Terminal when you need full manual control.
- Use OpenClaw for fast pod perspective.
- Use Hermes for deep reasoning when allocated.
- Use local agents for work requiring the local filesystem or installed tools.
- Use app skills for app-specific instructions.
- Keep AIL model selection global.
- Never apply destructive output without approval.

