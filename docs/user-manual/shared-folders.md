# Shared Folders

Shared folders are the exchange layer between the local computer, Tytus pods, local agents, app skills, and future remote workspaces. They make the agent team practical because every participant can read and write ordinary files instead of relying on one chat transcript.

## Shared folder types

| Type | Use | Typical path |
|---|---|---|
| Tytus Home Shared | Local drop-zone available from Files and Terminal. | `~/Tytus/Shared` |
| Mission folder | Per-job context, transcripts, outputs, proposals, approvals. | `~/Tytus/Missions/<mission>` |
| Pod workspace | Agent-side working directory. | `/app/workspace` |
| Pod inbox/outbox | File transfer points for pods. | `/app/workspace/inbox`, `/app/workspace/out` |
| Garage/garagetytus binding | Cross-machine or pod-synced folder when configured. | user-chosen local path |

Use **Files** for browsing. Use **Atomek** when the shared folder is part of an agent mission and should be connected to chat, context, and approvals.

## Local to pod exchange

CLI examples:

```bash
tytus push ./brief.md --pod 01 --to /app/workspace/inbox/brief.md
tytus ls /app/workspace/inbox --pod 01
tytus pull /app/workspace/out/result.md --pod 01 --to ~/Tytus/Shared/result.md
```

TytusOS examples:

1. Open **Files**.
2. Browse **Tytus Home**, **Shared**, or a pod workspace.
3. Open **Atomek** when you need editing, context, chat, or mission coordination.
4. Keep final handoffs in the mission folder `OUTBOX.md` or `outputs/`.

## Mission folder exchange

Recommended convention:

```text
INBOX.md          incoming notes, findings, pod outputs
OUTBOX.md         final user-ready handoff
runs/             full transcripts from local or pod jobs
outputs/          generated docs/assets
proposals/        patches or write proposals before approval
approvals/        approve/reject records
```

Agents should append a short note to `INBOX.md` when they leave a finding for another agent. Final artifacts should be copied or summarized into `OUTBOX.md`.

## Garage / garagetytus

When a folder needs to sync across machines or pods, use a Garage-backed binding instead of manual copy/paste. A binding maps a local folder to a shared bucket and keeps it synchronized.

Typical intent:

- share a project handoff with a pod
- share media assets between local apps and remote agents
- keep a mission folder visible on another machine
- let one agent produce files another agent can consume

If no binding exists, the local shared folder `~/Tytus/Shared` is still useful as a same-machine drop-zone.

## Conflict rules

- Prefer one writer per file at a time.
- Use append-only logs (`AUDIT.jsonl`, `RUNS.jsonl`) for events.
- Use separate files in `runs/` for transcripts.
- Put proposed edits in `proposals/` before applying them.
- If two agents produce conflicting outputs, keep both and ask a reviewer agent or the user to choose.

## What not to do

- Do not give agents broad blind write access to the whole home directory.
- Do not use shared folders as a hidden command channel for destructive actions.
- Do not store raw credentials in mission folders.
- Do not assume pod paths and local paths are identical.
- Do not bypass Tytus path guards with `..`, symlink escapes, or encoded traversal.

## First shared-folder workflow

1. Put input files in `~/Tytus/Shared/<project>/` or create an Atomek mission.
2. Ask OpenClaw to review the files and write findings to `INBOX.md`.
3. Ask a local agent to implement or format output and save a proposal.
4. Use Atomek to preview and approve.
5. Move final files to `OUTBOX.md` or `outputs/`.

