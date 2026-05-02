# Getting Started

Tytus OS is a web-based desktop. It runs entirely in your browser and looks like a real operating system: boot screen, login, desktop, dock, draggable windows, app launcher, notifications.

## First launch

```bash
cd app
npm install
npm run dev
```

Open **http://localhost:4242** in your browser.

You'll see four phases:

1. **Boot** (~4s) — black screen with the Tytus OS logo (purple/orange/pink dual orb), then a progress bar, then a circle-iris transition reveals the wallpaper.
2. **Login** — blurred wallpaper with a centered card. Click **Unlock** (any password works at this stage) or **Log in as Guest**.
3. **Desktop** — wallpaper, top panel, icons on the left, dock at the bottom.
4. **Apps** — click any icon or use the launcher.

## The desktop in 30 seconds

- **Top panel** (28 px tall) — `Apps` button on the left, clock + date in the middle, system tray on the right (Wi-Fi, volume, battery, power menu). Buttons are 24 px tall so the hover background stays inside the panel.
- **Wallpaper** — replaceable from Settings → Background.
- **Desktop icons** — 8 by default (Pods, Files, Terminal, Settings, Chat, Channels, Browser, Help). Drag to rearrange (snaps to 80×90 grid). Right-click for the context menu.
- **Dock** (bottom-center) — floats 6 px from the viewport with rounded corners on all four sides. Apps grid button on the far left, then 6 pinned apps, then any unpinned-but-open apps, then the trash. Open apps show a small dot near the bottom of their icon (inside the dock).

## Opening an app

Three ways:

1. **Double-click** any desktop icon
2. **Click** any dock icon
3. **Press the Super key** (⌘ on Mac, Win on Windows/Linux) to open the app launcher → search or click

The app opens in a draggable window in the middle of the screen.

## Closing an app

- Click the **×** (close) button in the window's title bar
- Or press **Ctrl+W** while the window is focused

## Keyboard shortcuts (the essentials)

| Shortcut | Action |
|---|---|
| **⌘+Space** | Toggle app launcher |
| **⌘+W** | Close focused window |
| **⌘+Q** | Close every window of the focused app |
| **⌘+Z** | Undo the last file operation |
| **⌘+D** | Minimize all windows |
| **Alt+Tab** | Switch between open windows |
| **Ctrl+Alt+T** | Open Terminal |
| **Esc** | Close launcher / notification center / any modal |

Full reference: [keyboard-shortcuts.md](keyboard-shortcuts.md).

## Personalize Tytus in 90 seconds

Open **Settings** (dock icon or Apps → Settings):

1. **Appearance → Accent color** — click any swatch or pick a custom hex. The change ripples instantly across every app.
2. **Appearance → Text size** — slider from 50% to 150%. Tytus rescales its rem-based layouts live.
3. **Appearance → Light/dark schedule** — Manual / Always light / Always dark / Auto (light 06:00–18:00 local).
4. **Appearance → Reduce motion** — flips off the open / close / snap animations. Tytus also auto-respects your OS preference.
5. **Background → Wallpaper** — pick a bundled preset, upload your own, or set a solid color. Toggle "Match lock screen" if you want the lock/login surface to mirror your desktop.
6. **Dock** — change Position (bottom / left / right), Size (small / medium / large), Auto-hide on/off. Drag-and-reorder dock apps directly in the Dock; **Reset Dock order** restores defaults.
7. **Notifications → System sounds** — turn the chime on or off.
8. **Privacy → Reset clipboard permission** — if Cmd+V isn't working after you previously denied it.

Personalization survives reload (it's persisted via the same hydration/normalizer path as everything else).

## Snap, paste, and drag

- **Drag a window** near the **left** / **right** / **top** edge → translucent overlay shows where it'll snap. Release to commit. Drag away (~24 px) to restore the prior frame.
- **Drag a file from the Files window** OUT to Finder (Chromium build) → file downloads on drop.
- **Cmd+V on the Desktop** with an image on your host clipboard → Tytus saves it as `pasted-YYYYMMDD-HHMMSS.png`. First time prompts for permission; cache after.
- **Drag a JULI3TA track** onto an open MusicPlayer window → playback starts.

## What's not real (yet)

Tytus OS today is a **shell** — it looks and feels like an OS, but most apps are visual placeholders or use fake (browser-local) data. The real magic lands when Tytus OS connects to your private AI pod via the `tytus-cli` daemon. That's the [phase plan](../development/roadmap.md).

What *is* real today:
- All window management (drag, resize, focus, min/max/restore, Alt+Tab)
- Desktop icons + dock + launcher
- Theme (dark/light, accent colors)
- localStorage persistence for desktop layout, notes, todos, calendar events, etc.
- API Tester actually sends real HTTP requests
- Calculator, games, image/video viewers, code editor — all real and functional

What's a placeholder:
- Pod Inspector, Channels, Help (waiting for the pod backend)
- Wi-Fi, Bluetooth toggles in Settings (decorative)
- Terminal commands are simulated (real `tytus exec` arrives in Phase 6)

Continue to [windows.md](windows.md) for window controls, or jump to the [apps catalog](apps-catalog.md) to see what's installed.
