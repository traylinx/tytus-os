# System Settings

Open from the dock (gear icon), the desktop shortcut, or the launcher → **Settings**.

## Panels

The left sidebar lists every settings category:

| Panel | What's in it |
|---|---|
| **Wi-Fi** | Network list (decorative — Pod network panel arrives in a later phase) |
| **Bluetooth** | Paired devices (decorative) |
| **Background** | Wallpaper picker |
| **Appearance** | Dark mode toggle · 8 accent colors |
| **Notifications** | Enable / disable system toasts |
| **Sound** | Master volume, output device |
| **Power** | Sleep / battery (decorative on web) |
| **Display** | Scaling, resolution (decorative on web) |
| **Mouse & Touchpad** | Pointer speed (decorative on web) |
| **Keyboard** | Layout (decorative on web) |
| **Printers** | (decorative) |

Search the sidebar with the **Search settings…** input at the top.

## Appearance

The most-used panel.

- **Dark Mode** — toggle the global theme. Updates every CSS variable instantly.
- **Accent Color** — eight presets (purple default, blue, teal, green, yellow, orange, red, pink). Affects buttons, focus rings, dock indicators, the boot logo.

Settings persist to `localStorage` under `tytus_settings`. They survive reloads. Clear browser data to reset.

## Coming in Phase 3

When the daemon connector lands, Settings will gain a top strip showing:

- Your **plan tier** (Explorer / Creator / Operator)
- **Units used / total**
- An "**Upgrade**" button
- An **Agent catalog** with one-click install
- **Autostart** toggles for the Tytus tray + tunnel

The decorative Wi-Fi / Bluetooth panels will be either swapped for "Pod network" status or hidden — see [the roadmap](../development/roadmap.md).
