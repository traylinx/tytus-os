# Desktop

The desktop is the area between the top panel and the dock. It hosts the wallpaper and your icons.

## Default icons

8 shortcuts on the left:

- **Pods** → Pod Inspector
- **Files** → File Manager
- **Terminal** → Terminal
- **Settings** → System Settings
- **Chat** → Chat
- **Channels** → Channels
- **Browser** → Browser
- **Help** → Help

## Icon actions

| Action | What happens |
|---|---|
| **Double-click** | Opens the app |
| **Click and drag** | Moves the icon (snaps to 80 × 90 grid) |
| **Right-click** | Context menu (Open / Cut / Copy / Rename / Move to Trash) |
| **Single click** | Selects the icon (purple dashed outline) |

Icon positions persist in `localStorage` under the key `tytus_desktop_icons`. They survive page reload but reset if you clear browser data.

## Right-click on empty desktop

| Item | Action |
|---|---|
| **New Folder** | (placeholder) |
| **New Document** | (placeholder) |
| **Open in Terminal** | Launches Terminal |
| **Change Background** | Launches Settings → Background |
| **Arrange Icons** | Auto-aligns to grid |
| **Display Settings** | Launches Settings → Display |

## Wallpaper

The default wallpaper is `/wallpaper-default.jpg` (a ~2 MB abstract image bundled with the app). Change it from **Settings → Background**.

The wallpaper is rendered as a fixed-position layer behind everything. It scrolls with the desktop and is covered by windows + dock.

## Selection

Click an icon to select it; click empty desktop space to deselect. Selected icons get a translucent purple background and a dashed outline.

Selection is purely visual — there's no multi-select today.

## Trash

The trash icon lives at the right end of the dock (not the desktop). Drag desktop icons there to "trash" them — for now this just removes them from the desktop layout. (Real recoverable trash is part of [the FileManager phase](../development/roadmap.md).)
