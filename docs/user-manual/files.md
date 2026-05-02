# Files

Tytus OS has two parallel file backends. Knowing the difference makes the
selection / drag / paste behaviour predictable.

## Two backends

| Backend | Where bytes live | Used by | Lifetime |
|---|---|---|---|
| **vfs** | `localStorage` (`tytus_filesystem`) | Desktop icons, in-OS-only files | Browser-local. Cleared with site data. |
| **daemon** | The Tytus daemon's filesystem (`~/Tytus/...`, shared folders, pod workspaces) | Files window, real OS-level files | Real disk. Survives reload. |

A **FileRef** (in code: `lib/files/fileRef.ts`) is a tagged pointer that says
which backend a file is in plus enough info to reach it. Every file action
(move, copy, delete, paste) flows through this typed reference so a vfs
icon and a daemon row are interchangeable to the user.

## The Files window (daemon-backed)

Open **Files** from the dock or App Launcher. Browse, search, double-click directories, and use right-click for the per-row menu.

### Selection

| Action | What happens |
|---|---|
| Click a row | Select that one row. |
| **Cmd+Click** (Ctrl+Click) | Toggle selection — keep the rest. |
| **Shift+Click** | Select range from the last clicked row. |
| **Cmd+A** | Select every row currently visible (search-respecting). |
| **Esc** | Clear selection. |

Selected rows tint with the accent color. The selection set is component-local — closing the window clears it.

### Drag inside Tytus

- Drag one or more rows to the **Desktop** to create shortcut icons.
- Drag onto the **Trash icon** in the Dock to send to trash.
- Drag a track row from MusicCreator onto **MusicPlayer** to start playback.

The drag ghost shows a small badge with the count when more than one item is selected.

### Drag OUT to the host (Chromium build)

Drag a file row OUT of Tytus onto the macOS Finder, another browser tab,
or a desktop folder. Tytus emits a `DownloadURL` MIME alongside the typed
file payload so the host browser kicks off a download on drop.

- **Chromium / Chrome / Edge**: works.
- **Firefox / Safari < 17**: not supported — use the row's right-click "Download" instead.
- Single-file drags only (the `DownloadURL` envelope can't carry a multi-file download).

## Drop external files INTO Tytus

Drop one or more files from the macOS Finder (or another browser tab)
anywhere in Tytus that accepts files:

- **Desktop** — accepts file drops; the upload pipeline runs and an icon appears.
- **Files window** — accepts native files into the current pane.
- **Dock app icons** — accepts files routed to that app's open-with handler.

Tytus detects external files via `e.dataTransfer.files.length > 0` and
short-circuits the typed-payload path so external drops always win.

## Paste from the host clipboard (Cmd+V)

After copying an image (e.g. macOS Preview → ⌘+C) or text on the host
side, **Cmd+V** anywhere in Tytus that isn't a focused text input
attempts a clipboard read:

1. The first time you press Cmd+V the browser shows a permission prompt.
2. Granted → image becomes a file (`pasted-YYYYMMDD-HHMMSS.png`); text becomes a notification toast.
3. Denied → a single toast with the browser name; no permission re-prompt loop.

The permission state is cached in `state.clipboardPermission`. If you previously denied and want to re-prompt: **Settings → Privacy → Reset clipboard permission**.

Browser support matrix: see [troubleshooting/clipboard.md](../troubleshooting/clipboard.md).

## Conflict resolution

Move / copy / paste operations that hit a name collision present a dialog with four options:

- **Replace** — overwrite the destination.
- **Keep both** — append a deterministic suffix `name (2).ext`. The
  suffix is computed against the destination's actual case-insensitive
  contents (HFS+ semantics) so you never get duplicates.
- **Skip** — leave the destination alone.
- **Cancel all** — abort the entire batch. Items already moved stay.

The dialog has an **Apply to all** checkbox so a 50-item paste with
multiple conflicts only asks once.

## Partial-failure semantics

A multi-item move / copy / delete returns a `PerItemResult[]` array.
The summary toast tells you how many succeeded and surfaces failure
reasons (`not-found`, `read-only`, `quota-exceeded`, `network-error`)
with a per-item Retry button for transient failures.

## Trash

Items deleted from vfs live in localStorage trash; daemon items will
move to `~/Tytus/.Trash/` when the daemon endpoints land (deferred).

- Drag any file or icon onto the **Trash** in the Dock to send it.
- The Trash icon shows a count badge.
- Empty trash from Trash's right-click menu — plays the empty-trash chime.

## Undo

**Cmd+Z** undoes the last reversible file operation. Tytus keeps a 5-deep
ring (most recent on top). The undo entry is per-operation, so a 7-item
move-with-3-failures undo only reverses the 7 that succeeded.

## Internals

- `lib/files/fileRef.ts` — the discriminated union + helpers.
- `lib/files/fileOps.ts` — the unified API (move / copy / delete / rename / paste).
- `lib/files/conflict.ts` — case-insensitive collision detection + name suggestions.
- `lib/repo/trash.ts` — the trash façade.
- `lib/clipboard.tsx` — internal Tytus clipboard.
- `lib/hostClipboard.ts` — host browser clipboard wrapper.
- `lib/undo.ts` — the undo ring.
