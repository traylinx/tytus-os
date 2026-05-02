# System Settings

Open from the dock (gear icon), the desktop shortcut, or the launcher → **Settings**. The Settings hash deep-link family (`#/settings/<panel>`) is also addressable from anywhere in the OS — top-panel chips, tray menus, and zero-pods overlays all use them.

## Sidebar layout

The sidebar groups panels in two halves separated by a divider:

- **Tytus** — your private AI pod product configuration. Live, wired to the local daemon.
- **System** — OS-feel preferences. All real and persisted (Sprint A retired the long list of decorative-only panels).

Search the sidebar with the **Search settings…** input at the top — the filter flattens both groups into a single result list. The active panel persists across reloads under `localStorage.tytus_settings_active_category`.

## Tytus panels

| Panel | What it covers |
|---|---|
| **Account** | Email, current tier, units used / units limit. Red **Sign out** button → confirmation modal that warns sign-out revokes every allocated pod. |
| **Plan & Units** | Current tier, unit-budget bar, breakdown by pod (e.g. *Pod 02 · nemoclaw — 1 unit*). External **Upgrade plan** CTA, **Refresh** button. |
| **Pods** | List of allocated pods. Each row exposes copy + reveal affordances on `api_url`, `public_url`, `ui_url` (token-masked), and `user_key` (Secret-masked). Status dot per pod from the lazy `/api/pod/ready` probe. **+ Allocate** jumps to the Agents panel. **Refresh** re-pulls daemon state. |
| **Agents** | Catalog grid with tier + unit-budget gating. Already-running agents show an *"Already running on pod NN"* badge. **Install** opens a wizard modal: confirm → SSE stream pane → success or **Retry**. One-click install via the `#/settings/agents?install=auto` deep link. |
| **Daemon** | Start / Stop / Restart buttons, autostart-tray + autostart-tunnel toggles, status pill (PID, uptime, tunnel state, keychain health). |
| **Sharing** | Garage shared-folder bindings — bind a Mac folder to one or more pods, configure per-binding auto-sync, see live sync indicators. |

## System panels

All System panels are real and persistent. Most preferences flow through the theme normalizer (`lib/theme/normalize.ts`) so old `tytus_settings` blobs upgrade automatically.

| Panel | What it covers |
|---|---|
| **Background** | Wallpaper picker — bundled presets, upload your own, or set a solid color. **Match lock screen** toggle mirrors the lock/login surface to the desktop wallpaper. |
| **Appearance** | Dark mode, accent color (8 presets + custom hex), font scale (50–150%), light/dark schedule, reduce-motion override. |
| **Dock** | Position (bottom / left / right), size (small / medium / large), auto-hide, **Reset Dock order** to restore default pinned apps. |
| **Languages** | Switch UI locale; install / remove official packs from `traylinx/tytus-os-language-index`; sideload third-party packs by URL or file with checksum verification. |
| **Notifications** | Recent notifications list (5 most recent). **System sounds** toggle. |
| **Privacy** | **Reset clipboard permission** escape hatch + privacy-statement copy + **Lock Screen Now** button. |
| **About** | Tytus OS version, daemon PID + version + uptime, update-status banner + link to release notes. |

## Appearance — every control

The most-used System panel. Everything in here re-renders every CSS variable instantly (no reload).

### Dark Mode
Toggle the global theme. Persists to `state.theme.darkMode`.

### Accent Color
- **8 presets**: Purple (default), Blue, Teal, Green, Yellow, Orange, Red, Pink.
- **Custom**: a small color-swatch button next to the presets opens a native color picker. Any 6-digit hex is accepted. The custom value persists separately so you can switch back to a preset and recover the custom one.

The accent ripples through buttons, focus rings, dock indicators, the boot logo, the App Launcher highlight, and the snap overlay during window drags.

### Text Size (font scale)
A slider from **50% to 150%**, step 5%. Applies as a CSS variable on `html` so every rem-based dimension scales live. **Reset** button restores 100%.

### Light / Dark Schedule
Four modes:
- **Manual** — only the Dark Mode toggle changes the theme.
- **Always Light**
- **Always Dark**
- **Auto** — light from 06:00 to 18:00 local time, dark otherwise. The schedule re-evaluates on the minute.

### Reduce Motion
Disables window open / close animations and snap-resize tweens. Tytus also auto-respects `prefers-reduced-motion: reduce` from your OS — the in-Tytus toggle is an explicit override that survives changes to your OS preference.

### Show Demo Apps
Reveals optional OS-feel demo apps (Games + ASCII Art + Matrix Rain) in the App Launcher. Off by default in production builds. Tytus product surfaces stay visible either way. See [apps-catalog.md](apps-catalog.md) for the full demo list.

## Dock panel

| Control | Effect |
|---|---|
| **Position** | bottom (default) / left / right. Re-anchors the dock and rotates the indicators. |
| **Size** | small / medium / large. Changes icon size, padding, and the dock's footprint on the wallpaper. |
| **Auto-hide** | Dock hides off-screen when no window touches it; reveals when the cursor approaches the screen edge it lives on. |
| **Drag-and-reorder** | Click-hold-drag any dock app to reorder. Persists immediately. |
| **Reset Dock order** | Restores the default 6 pinned apps in the original order. |

## Notifications panel

- **Recent notifications** — the 5 most recent toasts, in card form (title, message). Useful when you missed a transient toast.
- **System sounds** — toggle the bundled sound theme (notification chime, error beep, empty-trash whoosh, screenshot click). When OFF, all `playSound(...)` calls are no-ops. The toggle stores in `state.theme.soundEnabled` (default ON unless `prefers-reduced-motion: reduce` *and* the OS has no media output, in which case Tytus boots with sound off).

## Privacy panel

- **Reset clipboard permission** — flips the cached `state.clipboardPermission` back to `'prompt'`. Use this if you previously denied browser-clipboard access via Cmd+V and want Tytus to ask again. Status line shows `Granted`, `Denied`, or `Will ask`.
- **Private AI shell** — informational copy. Tytus OS does not expose browser-side telemetry or fake device controls — daemon and pod state come from the local daemon only.
- **Lock Screen Now** — instantly transitions the OS to the Login phase. Useful when stepping away.

## About panel

- **Tytus OS** version and update status (banner: *up to date* / *update available*).
- **Daemon** PID, version, started-at, uptime.
- Buttons: **Run Doctor** (jumps to Help → Doctor), **Open release notes**, **GitHub**.

## Where settings live on disk

| Key (localStorage) | What it stores |
|---|---|
| `tytus_settings` | The full theme blob (dark mode, accent, custom accent, font scale, schedule, reduce motion, sound). Hydrated through `lib/theme/normalize.ts` so older blobs forward-upgrade. |
| `tytus_settings_active_category` | Last-active panel id |
| `tytus_dock` | Dock position, size, auto-hide, app order |
| `tytus_wallpaper` | Wallpaper kind + value (preset / upload / solid color) |
| `tytus_lock_match_wallpaper` | Lock/login wallpaper match toggle |
| `tytus_clipboard_permission` | Cached clipboard permission verdict (`granted` / `denied` / `prompt`) |
| `tytus_window_snap` | Per-window snap state (current snap kind + frame to restore on un-snap) |
| `tytus_window_geometry` | Per-app reopen geometry (cross-session) |
| `tytus_filesystem` | The vfs file tree (Desktop icons, Notes data, etc.) |
| `tytus_locale` + `tytus_lang_packs` | UI language + installed third-party packs |

Clear browser data → settings reset to factory defaults.

## Hash deep-links

Every panel is addressable directly so other surfaces can link straight to a specific control:

- `#/settings/account`
- `#/settings/plan`
- `#/settings/pods`
- `#/settings/agents`
- `#/settings/agents?install=auto` — open the install wizard immediately
- `#/settings/daemon`
- `#/settings/sharing`
- `#/settings/background`
- `#/settings/appearance`
- `#/settings/dock`
- `#/settings/language`
- `#/settings/notifications`
- `#/settings/privacy`
- `#/settings/about`

Tray menus, top-panel chips, the zero-pods overlay, and the in-OS Help app all use these links to deep-jump.
