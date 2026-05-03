# System Settings

Open Settings from the dock, desktop icon, app launcher, tray deep-link, or `#/settings/<panel>`.

Settings is split into **Tytus** panels and **System** panels. Production docs should only describe panels that actually exist and work.

## Tytus panels

| Panel | Use it for |
|---|---|
| Account | Signed-in email, plan, sign out |
| Plan & Units | Unit limit, used units, included gateway, upgrade link |
| Pods | Allocated pods, API/UI URLs, keys, status, allocate action |
| Agents | Install OpenClaw/Hermes-style agents into pods and follow install progress |
| Daemon | Local daemon health, session expiry, sign-in recovery, lifecycle buttons, autostart toggles |
| Sharing | Garagetytus/shared-folder bindings, diagnostics, defaults, cache/open-folder actions |

## System panels

| Panel | Use it for |
|---|---|
| Background | Wallpaper selection. Default design pack background is bundled. |
| Appearance | Dark/light mode, accent color, theme tokens, demo-app visibility |
| Dock | Dock size/position/order/visibility |
| Languages | UI language packs |
| Notifications | Recent notifications and notification behavior |
| Privacy | Clipboard reset, lock screen, local privacy notes |
| About | TytusOS version, daemon version/PID/uptime, Tytus Home, update status |

Removed early placeholder panels such as fake Wi-Fi, Bluetooth, printers, mouse, keyboard, display, and battery. Do not reintroduce decorative OS controls unless they are backed by real product behavior.

## Session expired

When the daemon refresh token expires, Settings -> Daemon shows **Session expired** and a **Sign in again** card.

Important behavior:

- Running pods stay online.
- Local files are not deleted.
- The user signs in again through the browser one-time flow.
- After approval, TytusOS should refresh state automatically. If it does not, use **Check session** or reload the page.

## Daemon state labels

| Label | Meaning | User action |
|---|---|---|
| Connected | Daemon authenticated and healthy | none |
| Session expired | Login refresh failed, pods may still run | Sign in again |
| Degraded | Daemon reachable but one subsystem failed | Open Settings -> Daemon, run Doctor/logs |
| Offline | TytusOS cannot reach local daemon | start tray daemon, check localhost port |

## Updates

About should show the installed TytusOS/daemon version and update state when available. Manual update checks belong in About or Daemon, not hidden in Tower.

## Theme rule for contributors

Use shared semantic tokens for foreground/background/border/accent. Never hard-code black icons or text into product UI; it breaks dark mode. New components must be checked in both light and dark mode before shipping.
