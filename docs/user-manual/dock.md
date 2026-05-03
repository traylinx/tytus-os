# Dock

The dock is the floating app bar at the bottom-center of the screen. It launches Tytus apps and shows running-window state.

## Default pins

Typical production pins:

1. Show Applications
2. Pod Inspector
3. Channels
4. System Settings
5. Files
6. Terminal
7. Chat
8. Running/unpinned apps
9. Trash

The exact order can change by release; the behavior is stable.

## Active indicator

Open apps show a small dot inside the dock:

- Accent dot: focused app
- Grey/subtle dot: open but not focused
- No dot: no window open

## Click behavior

| State | Click result |
|---|---|
| No window open | Opens the app |
| Window minimized | Restores and focuses it |
| Window already open | Focuses most recent window |
| Multiple windows | Focuses most-recently-active window |

## Customization

Use **Settings -> Dock** for size, position, auto-hide, order reset, and future pinning controls.

## Trash

Trash is a product affordance, not a fake animation. File deletion/recovery belongs to Files and must respect root-anchored source safety.
