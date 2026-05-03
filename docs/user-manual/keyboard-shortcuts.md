# Keyboard Shortcuts

Every shortcut TytusOS responds to today.

> **Note on Cmd vs Ctrl.** Tytus uses a single binding string `Mod+<key>`
> internally — `Mod` resolves to `Cmd` on macOS and `Ctrl` on Linux/Windows.
> The tables below show the macOS form; substitute Ctrl on other platforms.

## System

| Shortcut | Action |
|---|---|
| **⌘+Space** | Toggle App Launcher |
| **Esc** | Close launcher · Close notification center · Close any modal |
| **⌘+D** | Minimize all windows |
| **⌘+Z** | Undo the last reversible file operation (move / copy / delete / rename / paste). |
| **⌘+V** | Paste from the host browser clipboard (image → save / text → toast). Requires a granted clipboard permission. Inside a text input, the browser's native paste runs instead. |

## Windows

| Shortcut | Action |
|---|---|
| **⌘+W** | Close the focused window. **Does not** close the host browser tab — Tytus intercepts the keypress. |
| **⌘+Q** | Close every window of the focused-window's app. |
| **Alt+Tab** (hold Alt, tap Tab) | Cycle through visible windows. |
| **Release Alt** | Commit the Alt+Tab selection. |
| **Double-click title bar** | Maximize / restore. Snap-aware. |

While dragging a window:
- Drag near the **left** / **right** edge → snap to that half on release.
- Drag near the **top** edge → maximize on release.
- Drag a snapped window > 24 px away from its snap → restore prior frame.

## Files (FileManager + Desktop)

| Shortcut | Action |
|---|---|
| **⌘+A** | Select all icons / rows. |
| **Esc** | Clear selection. |
| **Click** | Select one. |
| **⌘+Click** | Toggle selection. |
| **Shift+Click** | Select range. |
| **Drag in empty area** | Lasso-select. |

## Quick launch

| Shortcut | Action |
|---|---|
| **Ctrl+Alt+T** | Open Terminal |
| **⌘+K** (macOS) / **Ctrl+K** (Linux/Windows) | Open the Command Palette — search-as-you-type, **↑ / ↓** to navigate, **Enter** to execute, **Esc** to close |

## In the App Launcher

| Shortcut | Action |
|---|---|
| **Type** | Search |
| **Esc** | Close launcher |

## In Settings, Notes, Todo, etc.

These apps have their own keyboard shortcuts inside their windows — check each app's interface.

## OS reservations

A handful of combos are intercepted before TytusOS sees them:

- `Cmd+Tab` — handled by macOS itself (system app switcher). Tytus ships **Alt+Tab** as the in-OS alternative.
- `Cmd+R` / `F5` — reloads the page (you'll lose unsaved app state).
- `Cmd+T` / `Cmd+N` — open a browser tab / window.

Tytus's shortcut router default-blocks `Cmd+W`/`Cmd+Q`/`Cmd+R`/`Cmd+T`/`Cmd+N` so those host-browser bindings can't kill the WebView from inside the OS, and registers its own handlers for `Cmd+W` and `Cmd+Q` on top.

## Internals

The shortcut router lives at `app/src/lib/shortcuts.ts`. It dispatches by scope priority `text-input > modal > active-app > shell`, so a focused text field always wins for combos like `Cmd+C`/`Cmd+V`/`Cmd+Z`.
