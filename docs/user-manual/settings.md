# System Settings

Open from the dock (gear icon), the desktop shortcut, or the launcher → **Settings**.

The sidebar is split into two groups by a divider:

- **Tytus** — your private AI pod product configuration. Live, wired to the daemon.
- **System** — OS-feel preferences. Most are decorative on the web today; one (Display) gates demo apps.

Search the sidebar with the **Search settings…** input at the top. The filter flattens both groups into a single result list. The active panel persists across reloads in `localStorage` under `tytus_settings_active_category`.

## Tytus panels

| Panel | What's in it |
|---|---|
| **Account** | Email, current tier, units used / limit. Red **Sign out** button — opens a confirmation modal explaining that signing out revokes every allocated pod. |
| **Plan & Units** | Current tier, unit-budget bar, breakdown by pod (e.g. *Pod 02 · nemoclaw — 1 unit*). External **Upgrade plan** CTA, **Refresh** button. |
| **Pods** | List of allocated agents. Each row exposes copy/reveal affordances on `api_url`, `public_url`, `ui_url` (token-masked), and `user_key` (Secret-masked). Status dot per pod (lazy `/api/pod/ready` probe). **+ Allocate** jumps to the Agents panel. **Refresh** re-pulls state. |
| **Agents** | Catalog grid with tier + unit-budget gating. Already-running agents show an *"Already running on pod NN"* badge. **Install** opens a wizard modal: confirm step → SSE stream pane → success or **Retry**. One-click install via the deep link `#/settings/agents?install=auto`. |
| **Daemon** | Start / Stop / Restart buttons, autostart-tray + autostart-tunnel toggles, status pill (PID, uptime, tunnel state, keychain health). |

## System panels

OS-feel preferences. Most are decorative on the web today.

| Panel | What's in it |
|---|---|
| **Wi-Fi** | Network list (decorative) |
| **Bluetooth** | Paired devices (decorative) |
| **Background** | Wallpaper picker |
| **Appearance** | Dark mode toggle · 8 accent colors |
| **Notifications** | Enable / disable system toasts |
| **Sound** | Master volume, output device |
| **Power** | Sleep / battery (decorative on web) |
| **Display** | Scaling, resolution, **Show demo apps** toggle (default OFF — gates Games, ASCII Art, Matrix Rain) |
| **Mouse** | Pointer speed (decorative on web) |
| **Keyboard** | Layout (decorative on web) |
| **Printers** | (decorative) |
| **Removable Media** | (decorative) |
| **Date & Time** | (decorative) |
| **Users** | (decorative) |
| **Default Apps** | (decorative) |
| **Privacy** | (decorative) |
| **About** | Tytus OS build info |

## Appearance

The most-used System panel.

- **Dark Mode** — toggle the global theme. Updates every CSS variable instantly.
- **Accent Color** — eight presets (purple default, blue, teal, green, yellow, orange, red, pink). Affects buttons, focus rings, dock indicators, the boot logo.

Settings persist to `localStorage` under `tytus_settings`. They survive reloads. Clear browser data to reset.

## Hash deep-links

Every panel is addressable directly:

- `#/settings/account`
- `#/settings/plan`
- `#/settings/pods`
- `#/settings/agents`
- `#/settings/agents?install=auto` — opens the install wizard immediately
- `#/settings/daemon`
- `#/settings/appearance`
- `#/settings/display`

Tray menus, top-panel chips, and the zero-pods overlay all use these links to deep-jump.
