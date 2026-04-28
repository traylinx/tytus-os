# Getting Started

TytusOS is a web-based desktop. It runs entirely in your browser and looks like a real operating system: boot screen, login, desktop, dock, draggable windows, app launcher, notifications.

## First launch

```bash
cd app
npm install
npm run dev
```

Open **http://localhost:4242** in your browser.

You'll see four phases:

1. **Boot** (~4s) — black screen with the TytusOS logo (purple/orange/pink dual orb), then a progress bar, then a circle-iris transition reveals the wallpaper.
2. **Login** — blurred wallpaper with a centered card. Click **Unlock** (any password works at this stage) or **Log in as Guest**.
3. **Desktop** — wallpaper, top panel, icons on the left, dock at the bottom.
4. **Apps** — click any icon or use the launcher.

## The desktop in 30 seconds

- **Top panel** (28 px tall) — `Activities` button on the left, clock + date in the middle, system tray on the right (Wi-Fi, volume, battery, power menu).
- **Wallpaper** — replaceable from Settings → Background.
- **Desktop icons** — 8 by default (Pods, Files, Terminal, Settings, Chat, Channels, Browser, Help). Drag to rearrange (snaps to 80×90 grid). Right-click for the context menu.
- **Dock** (bottom) — apps grid button on the far left, then 6 pinned apps, then any unpinned-but-open apps, then the trash. Open apps show a small dot below their icon.

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
| **⌘ / Win** | Toggle app launcher |
| **⌘+D** | Minimize all windows |
| **Alt+Tab** | Switch between open windows |
| **Ctrl+Alt+T** | Open Terminal |
| **Ctrl+W** | Close focused window |
| **Esc** | Close launcher / notification center |

Full reference: [keyboard-shortcuts.md](keyboard-shortcuts.md).

## What's not real (yet)

TytusOS today is a **shell** — it looks and feels like an OS, but most apps are visual placeholders or use fake (browser-local) data. The real magic lands when TytusOS connects to your private AI pod via the `tytus-cli` daemon. That's the [phase plan](../development/roadmap.md).

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
