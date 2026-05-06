# Forge VS Code Web Base Sprint

**Date:** 2026-05-05  
**Repo:** `/Users/sebastian/Projects/makakoo/api/ProjectWannolot/services/tytus-os`  
**Sprint path:** `/Users/sebastian/Projects/makakoo/api/ProjectWannolot/services/tytus-os/development/sprints/2026-05-05-forge-vscode-dev-base`

## Purpose

Build the **base app first**: a Tytus-native `vscode.dev`-style workbench powered by Monaco.

Only after the base feels right do we connect Tytus-specific powers: AI pods, agents, swarm, local AIL, recipes, media tools, and artifact generation.

## Core decision

Do **not** keep developing the previous Forge notebook/source/studio layout.

Do **not** fork/import the full Microsoft VS Code workbench.

Build a focused VS Code-for-the-Web base inside `packages/app-forge`, using:

- `microsoft/vscode` / `vscode.dev` as UX blueprint.
- `monaco-editor` as embeddable editor engine.
- Tytus host APIs for future OS integration.

## Sprint docs

- `SPRINT.md` — canonical plan and execution phases.
- `DECISION.md` — checked facts and architecture decision.
- `UX_CONTRACT.md` — exact visual/interaction contract based on `vscode.dev`.
- `TECHNICAL_DESIGN.md` — module architecture and filesystem/editor plan.
- `QA_UAT_PLAN.md` — acceptance tests and gates.
- `EXECUTION_RUNBOOK.md` — commands and first implementation moves.
- `HANDOFF_PROMPT.md` — paste-ready prompt for a fresh context window.

## Ready state

Ready to start when Sebastian approves this sprint.

First execution action will be a clean replacement of `packages/app-forge/src/Forge.tsx` into a VS Code shell. Existing Forge recipes/persistence stay parked/hidden until the shell is accepted.
