# Local Cortex

By default, chat with your pod routes through Tytus's cloud Cortex on Strato. That works out of the box and requires no extra software. If you want chat **memory** and the Cortex database/cache to stay on your Mac, you can run Cortex locally instead.

Local Cortex is opt-in. Cloud stays the default for everyone.

## What runs where

| Profile | Where chat goes | Where memory lives |
|---|---|---|
| **Cloud** (default) | `tytus.traylinx.com` → Strato Cortex → your pod | Strato Postgres |
| **Local** (opt-in) | `127.0.0.1:8098` → local Cortex → your pod | Your Mac's Docker volumes |

In both profiles, the **agent** (OpenClaw or Hermes) runs in your pod on Strato. Local Cortex only moves the "memory and routing" layer to your machine. Running agents locally is a separate, future feature.

## Requirements

- macOS or Linux. Windows local Cortex is not yet supported.
- **Docker Desktop installed and running.** Tytus does not bundle a Docker daemon; you bring your own. Install: https://www.docker.com/products/docker-desktop
- Roughly 4 GB free disk space for the initial image pulls (Postgres, Redis, Cortex).
- Roughly 1.2 GB of RAM in use when the stack is running.

## Switching to local

1. Open **Settings → AI**.
2. Pick **Local Cortex (opt-in)**. TytusOS flips the routing flag immediately, but chat will fall back to cloud until the stack is actually running.
3. Open a terminal and run:

   ```bash
   tytus cortex up
   ```

   First run pulls images (~30–90 seconds on a typical connection). The CLI prints progress as it goes. When it returns, the status panel in Settings should flip to **Active**.

4. (Optional) verify with:

   ```bash
   tytus cortex test
   ```

   The CLI sends a probe message to your local Cortex and prints the round-trip latency.

That's it. From now on, the Cortex memory/routing layer runs locally. The selected agent still runs in your remote pod, and model calls may still go to the configured AIL/upstream provider. The assistant message in Atomek shows a **"Local Cortex"** chip beside the response.

## Switching back to cloud

1. Open **Settings → AI** and pick **Cloud Cortex**.
2. If you also want to stop the local Docker containers, run:

   ```bash
   tytus cortex down
   ```

   Your Postgres volume is preserved so you can switch back later without losing memory. To wipe memory too, add `--purge`:

   ```bash
   tytus cortex down --purge
   ```

## The `tytus cortex` commands

| Command | What it does |
|---|---|
| `tytus cortex up` | Install + start Postgres, Redis, Cortex on `127.0.0.1:8098`. Idempotent. |
| `tytus cortex down` | Stop the containers. Data volumes preserved. |
| `tytus cortex down --purge` | Stop and wipe data volumes. **Destructive.** |
| `tytus cortex status` | Show profile, container state, health, version. |
| `tytus cortex test` | Send a probe message. Reports round-trip latency. |
| `tytus cortex reset --yes` | Stop + purge volumes + clear local Cortex state. Returns you to factory. |
| `tytus cortex token rotate` | Mint a new per-user token. Ends any in-flight chats. |
| `tytus cortex token show` | Show whether a token is present (never prints the token body). |
| `tytus cortex logs [--tail N] [--follow]` | Tail Cortex container logs. |
| `tytus cortex upgrade` | Pull the latest pinned image + run database migrations. |
| `tytus cortex version` | Show the pinned image tag this CLI release bundles. |

All commands accept `--json` for AI-CLI consumption.

## Troubleshooting

### "Docker CLI not found"

Install Docker Desktop and start it before running `tytus cortex up`. The CLI shells out to `docker version` first; if that fails the install aborts with a hint.

### "Cortex did not become healthy within 90s"

Run `tytus cortex logs` to see what the Cortex API container is complaining about. Most common causes:

- Postgres took longer than usual to initialize on first run. Try `tytus cortex up` again — it's idempotent.
- The host's SwitchAILocal gateway is not reachable. Local Cortex calls it for chat and embeddings via `host.docker.internal:18080`. Verify your SwitchAILocal install is running.
- Port 8098 collides with something else on your machine. Pick a different port: `tytus cortex up --port 9098`.

### "no ctx_* token — run `tytus cortex token rotate`"

The user token mint failed (or was never attempted, e.g. you ran `down` then `up` and the mint step raced). Just rotate:

```bash
tytus cortex token rotate
```

### Chat hangs after switching to local

Two things to check, in order:

1. `tytus cortex status` — is the stack running and healthy?
2. `tytus cortex test "ping"` — does Cortex reply?

If step 2 works but Atomek/Chat still hangs, the tray daemon may need a restart to re-read `state.json`. Restart Tytus from the menu bar.

### "Memory search requires profile=local. Switch in Settings → AI."

This appears in TytusOS apps that try to call `host.ai.cortexSearch()` while the user is on cloud. Local Cortex's memory store is private to the user's machine — there's no cloud equivalent. Either switch to local, or accept that recall is unavailable on the cloud profile.

## What's NOT supported in v1

- **Running pods locally.** Agents stay in your remote Strato pod. The `chat_target=agent` path through local Cortex is intentionally disabled (DAM is not running on your Mac).
- **Cortex-mediated direct memory writes.** Local Cortex consolidates memories from chats automatically; there is no `host.ai.cortexRemember()` API today. If you want explicit "save this fact" UX, use Atomek's existing **Remember** button — that writes to a separate, workbench-scoped memory store.
- **Migrating cloud sessions to local.** The two profiles maintain separate memories. Switching does not move data either way.
- **Multi-user local Cortex.** One Mac, one user.

## Privacy posture

- Tokens live in `~/Library/Application Support/tytus/state.json` (mode 0600, user-only).
- Postgres + Redis volumes are Docker-managed, owned by your user account.
- The local Cortex API binds to `127.0.0.1` only — never reachable from other machines on the network.
- Tray daemon's `/api/cortex/*` endpoints enforce same-origin checks; only TytusOS itself can call them.
- Provider credentials may still be used for model inference through the configured AIL/upstream route. What stays local in Local Cortex mode is the Cortex API state, memory database/cache, and Docker volumes — not necessarily every model inference request.

## Architecture

For the implementation details, see the sprint pack at `services/tytus-os/development/sprints/2026-05-21-chat-with-pods-local-cortex-parity/` (developer-facing, not user docs).
