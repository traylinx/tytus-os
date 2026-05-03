# Desktop

The desktop is the space below the top menu bar and above the dock. It shows the active wallpaper and product shortcuts.

## Default icons

The default production shortcuts are Tytus surfaces, not fake OS controls:

- **Pod Inspector** — fleet, gateway, readiness, pod actions
- **Channels** — messenger/channel setup
- **System Settings** — account, daemon, sharing, theme, dock, updates
- **Help** — user manual, troubleshooting, diagnostics
- **Chat** — open agent chat surfaces
- **Terminal** — host-backed Tytus terminal
- **Files** — Tytus Home, shared folders, pod workspaces
- **Browser** — registered web/app launchers

## Icon actions

| Action | What happens |
|---|---|
| Double-click | Opens the app |
| Click and drag | Moves the icon on the desktop grid |
| Right-click | Opens the app/context menu when available |
| Single click | Selects the icon |

Icon positions persist in browser storage and survive reloads.

## Empty desktop menu

The desktop context menu should only expose actions backed by real product behavior:

| Item | Action |
|---|---|
| Open Terminal | Opens Terminal in `~/Tytus` |
| Change Background | Opens Settings -> Background |
| Arrange Icons | Aligns icons to the grid |
| Open Help | Opens Help -> Getting Started |

Do not add decorative Display/Wi-Fi/Bluetooth/Printer-style controls unless they are wired to real Tytus behavior.

## Wallpaper

The default wallpaper comes from the TytusOS design pack. Change it from **Settings -> Background**.

## Trash

The trash icon lives at the right end of the dock. Trash/recoverable file operations must be implemented through the Files app and daemon-safe roots; do not simulate destructive behavior.
