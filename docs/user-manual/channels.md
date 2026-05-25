# Channels

Channels connect a Tytus pod to external messengers. They are per-pod, token-safe, and managed from TytusOS or the tray.

## What works today

| Channel | Current status | Best for |
|---|---|---|
| Telegram | Native OpenClaw flow | Simple bot chat with one selected pod. |
| Discord bot | Native OpenClaw-backed bot flow when you provide Discord app credentials | Team-room or server workflows where the bot relays to the selected pod. |
| Slack Socket Mode | Native OpenClaw-backed flow when you provide Slack app credentials | Workspace chat without exposing public inbound webhooks. |
| LINE | Listed in setup UI, but treat as beta/manual until support confirms the target flow. | Regional messenger experiments. |
| WhatsApp / Signal / iMessage / Matrix and others | Not one-click native in launch docs. Use a custom bridge or ask the agent for a guided setup. | Advanced/custom deployments. |

Do not document broad “20+ messengers” as automatic native support. If a channel requires the user to create an external app, paste tokens, or run a custom bridge, say so clearly.

A "native" row here means Tytus exposes a setup flow for that transport. It does not mean every Discord/Slack/Telegram server topology is automatically provisioned, and it does not guarantee message delivery while the selected pod, Cortex, or external messenger API is unavailable.

## Add a channel

1. Open **Channels** in TytusOS or tray **Controls -> Show all pods -> <pod> -> Channels**.
2. Select the pod.
3. Pick the channel type.
4. Paste the token/credentials from the external service.
5. Save.
6. Send a test message.

Tokens never belong in URLs, screenshots, shared folders, or support tickets.

## Agent support

OpenClaw is the launch target for channel workflows. Hermes can be allocated and chatted with, but do not claim Hermes-native Discord/Slack/Telegram channel automation unless a specific release documents it.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Channel missing in tray | Refresh TytusOS/tray; confirm the pod appears in `/pod/status`. |
| Token rejected | Recreate token in Telegram/Discord/Slack and paste again; do not reuse leaked tokens. |
| Message reaches bot but no reply | Check pod readiness and Cortex state. Running is not always chat-ready. |
| Wrong pod replies | Open Channels and verify the selected target pod. |
| Need Discord team/swarm setup | Use Discord as a manual/team-room bridge unless native setup is explicitly enabled in the UI. Keep approval gates human-controlled. |
