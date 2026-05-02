# Windows

Every app in Tytus OS runs in a window. Windows behave like a real OS: drag, resize, focus, minimize, maximize, restore.

## Anatomy

```
┌──────────────────────────────────────┐  ← 1 px border (brighter when focused)
│ 📁 App Name              −  □  ×    │  ← title bar (36 px tall, drag handle)
├──────────────────────────────────────┤
│                                      │
│            App content               │
│                                      │
│                                      │
└──────────────────────────────────────┘  ← rounded 12 px corners (square when maximized)
```

Edges and corners are invisible 6 px / 14 px hit zones — your cursor changes to indicate which direction will resize.

## Move a window

- **Click and drag** the title bar (anywhere except buttons or the icon).
- A grabbing-hand cursor confirms you're dragging.
- Windows can't go above the top panel (28 px) or fully off-screen — at least 100 px stays visible.

## Resize a window

- **Drag any edge or corner**. The cursor shows the direction.
- Minimum size: **320 × 200 px**.
- Edges resize one dimension; corners resize both.
- Maximized windows can't be resized — restore them first.

## Close · Minimize · Maximize

The three buttons on the right side of the title bar:

| Button | Hover effect | Action |
|---|---|---|
| **−** | grey | Hides the window. Click its dock icon to bring it back. |
| **□** | grey | Fills the available space (between top panel and dock — top 28 px + dock space 68 px reserved). Click again to restore. |
| **×** | turns red | Closes the window. State is lost. |

You can also **double-click the title bar** to maximize/restore.

## Focus

Click any window to bring it to the front. The focused window has:
- A brighter border
- A darker title bar background (`#1A1A1A` vs `#141414`)
- The accent-colored dot below its dock icon

## Alt+Tab

Hold **Alt** and tap **Tab** to cycle through open windows. Release Alt to commit. The overlay shows window thumbnails with the currently selected one highlighted.

Minimized windows don't appear in Alt+Tab — click their dock icon to restore.

## Snap to edges

While dragging a window's title bar, drag the cursor near a viewport edge to see a translucent overlay showing the snap target:

- **Left edge** → snap to left half
- **Right edge** → snap to right half
- **Top edge** → maximize

Release the mouse to commit. The unsnapped frame is remembered, so dragging the snapped window away from its half (more than ~24 px) restores the prior size at the cursor position.

Two windows of the same app can be snapped independently — left half + right half work as expected for, e.g., comparing two Files panes.

Snap state persists across reload.

## Keyboard shortcuts for windows

| Combo | Action |
|---|---|
| **Cmd+W** (Ctrl+W) | Close active window. **Does not** close the host browser tab — Tytus intercepts the keypress. |
| **Cmd+Q** (Ctrl+Q) | Close every window of the active app. |
| **Cmd+Space** | Toggle the App Launcher. |
| **Alt+Tab** | Cycle visible windows. |
| **Esc** | Close any open modal or menu. |
| **double-click title** | Maximize / restore. Snap-aware: if snapped, restore returns to the original floating frame, not the half. |

See [keyboard-shortcuts.md](./keyboard-shortcuts.md) for the full list.

## Animations and "Reduce motion"

Open / close / snap-resize transitions are CSS-only and short (120–150 ms). Tytus respects:

- The **system** "Reduce motion" preference (macOS System Settings → Accessibility → Display).
- A **Tytus-level** override at **Settings → Appearance → Reduce motion**.

Either flips animations off live with no reload.

## Restoring a minimized window

Three ways:
1. **Click the dock icon** for the app — restores and focuses
2. Open it via **launcher or desktop icon** — same effect
3. **Alt+Tab** doesn't include minimized windows (intentional)

## Multiple windows of the same app

Open multiple instances by re-launching from the dock or launcher when no window of that app is currently visible. Each gets its own Z-index and its own state.

## Z-index

The most-recently-focused window is on top. Click any other window to bring it forward.

## Edge cases

- **Window stuck off-screen?** Press ⌘+D to minimize all, then click the dock icon to bring it back at default position.
- **Drag won't start?** Make sure you're clicking the title bar background, not the icon, title text, or buttons.
- **Resize jumps?** The minimum size is 320×200 — you can't go smaller.

## Internals

The window chrome lives in `app/src/components/WindowFrame.tsx`. Each window carries `data-app-id`, `data-window-id`, and `data-window-title` attributes so other code (and tests) can find it reliably.

State lives in `useOSStore` under `state.windows`. The reducer actions are `OPEN_WINDOW`, `CLOSE_WINDOW`, `MINIMIZE_WINDOW`, `MAXIMIZE_WINDOW`, `RESTORE_WINDOW`, `FOCUS_WINDOW`, `MOVE_WINDOW`, `RESIZE_WINDOW`.
