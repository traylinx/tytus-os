# OpenClaw, Hermes, and Local Agents

Tytus works best when agents act as a team instead of isolated chat boxes. OpenClaw and Hermes run in Tytus pods. Local agents run on the user's computer. Atomek and shared folders connect both sides.

## Agent families

| Agent | Best for | Typical role |
|---|---|---|
| OpenClaw | Fast critique, planning, tactical execution, channel/app workflows. | reviewer, planner, remote worker |
| Hermes | Deeper reasoning, synthesis, writing, long-form review when allocated. | architect, editor, senior reviewer |
| Local Claude/OpenCode/Codex/pi/Kimi/Gemini/Qwen/Aider | Work against local repos, terminals, installed tools, and user files. | implementer, tester, local operator |

Use the brand names **OpenClaw** and **Hermes** in user-facing docs and UI. Old internal labels should not leak into the product.

## Units and pod types

| Pod/agent | Units | Notes |
|---|---:|---|
| Included All LLM Gateway / no-agent reserved pod | 0 | Does not count against plan units. Gives the stable OpenAI-compatible gateway. |
| OpenClaw | 1 | Code, review, tactical tasks, channel workflows. |
| Hermes | 2 | Deeper synthesis, memory-heavy review, scheduled/long-form work when available. |

Tytus may show a **reserved/free slot** as `No agent`. That is capacity, not a broken pod. Starting an agent reuses the reserved pod when possible. Display names like `Claus` or `Hermie` come from `/pod/status.display_name` and should appear consistently in Traylinx, TytusOS, and the tray.

## Install and check agents

CLI examples:

```bash
tytus status
tytus agent catalog
tytus agent install openclaw
tytus agent install hermes
tytus agent list
```

TytusOS examples:

1. Open **Pod Inspector**.
2. Check which pods are allocated and ready.
3. Open agent details to see readiness, routes, logs, and environment.
4. Open **Atomek -> Agent Team** to see the same resources in mission context.

Do not treat a pod URL as enough. A pod is useful when its health/readiness checks pass and the Tytus bridge can call it.

## How agents should work together

A strong agent-team workflow:

1. **User defines mission** in Atomek.
2. **OpenClaw** performs fast critique or task decomposition.
3. **Local agent** performs repo/file work on the local machine.
4. **Hermes** reviews architecture, copy, or final plan when available.
5. **Atomek** collects transcripts and patch proposals.
6. **User approves** edits or artifacts.

The mission folder is the shared memory for this work. Every agent should leave enough evidence for the next agent to continue.

## Dispatch surfaces

| Surface | Use it for |
|---|---|
| Pod Inspector | install, inspect, restart, open pod UIs, check readiness |
| Atomek Agent Team | choose resources, create missions, run local jobs, ask pods, inspect transcripts |
| Terminal | supervised shell, project commands, manual local-agent CLI runs |
| Files | browse Tytus Home, Shared, mission folders, pod workspaces |
| Channels | connect OpenClaw to supported messenger flows; Telegram, Discord bot, and Slack Socket Mode are current. Other messengers may need manual/custom bridge work or future support. |

Atomek should not replace Claude Code, OpenCode, Codex, or pi. It should orchestrate them with files, context, and approval gates.

## Good use cases

### Repo repair

- Open local repo in Atomek.
- Start mission: `Find root cause, propose patch, run tests, save proof.`
- Ask OpenClaw for critique.
- Run local OpenCode or Claude Code with mission context.
- Ask Hermes or another reviewer for final risk review.
- Apply only approved patches.

### Research and synthesis

- Put source docs in a mission folder.
- Ask OpenClaw to extract claims and risks.
- Ask Hermes for synthesis.
- Ask local agent to format output and update docs.
- Save final summary in `OUTBOX.md`.

### Creative production

- Store brief, references, lyrics, images, and audio in shared/mission folders.
- Use JULI3TA, Blender, Remotion, or other app skills for media steps.
- Use agents for prompts, review, edits, and packaging.
- Keep source assets and final outputs in the same mission folder.

## Troubleshooting

| Problem | Fix |
|---|---|
| OpenClaw or Hermes missing | Install/allocate the agent from Pod Inspector or CLI, then refresh Atomek capabilities. |
| Pod says running but job fails | Check readiness in Pod Inspector and `tytus doctor`. Running is not the same as healthy. |
| Local agent missing | Install the CLI on the computer, confirm it is on `PATH`, then refresh Atomek. |
| Agent output disappears | Look in the mission folder `runs/`, `RUNS.jsonl`, and Atomek Outputs. |
| Wrong model shown | Update global AIL route/model config; do not hardcode model ids in apps. |

