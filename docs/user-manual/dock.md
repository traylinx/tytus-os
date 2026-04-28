# Dock

The dock is the floating bar at the bottom-center of the screen.

```
┌─────────────────────────────────────────────────────┐
│  ⊞ │ 📦 ⚙️ 💬 📁 ✈️ ⌨ │ 🌐 │ 🗑️                    │
└─────────────────────────────────────────────────────┘
   1     2 - 7        8     9
```

1. **Show Applications** — opens the app launcher (same as ⌘ key)
2-7. **Pinned apps** — Pod Inspector, Settings, Chat, Files, Channels, Terminal (default)
8. **Open unpinned apps** — appear here while running, vanish when closed
9. **Trash**

## Active indicator

Open apps show a small dot below their icon:
- **Accent-colored dot** (purple by default) when the window is focused
- **Grey dot** when open but not focused
- **No dot** when no window of that app is open

## Click behavior

- **No window open** → opens a new window (icon bounces 400 ms)
- **Window minimized** → restores and focuses it
- **Window already open** → focuses it
- **Multiple windows** → focuses the most-recently-active one

## Hover

Hover any icon to see its name in a tooltip above the dock.

## Trash

Click to open Files (placeholder — will become the recoverable Trash app in a later phase).

## Customizing pins

Today the pinned set is fixed in code (`getDefaultDockApps()` in `app/src/apps/registry.ts`). User-configurable pinning ships in a later phase.

To change the defaults right now, edit:

```ts
// app/src/apps/registry.ts
export const getDefaultDockApps = (): string[] => [
  'pod-inspector',
  'settings',
  'chat',
  'filemanager',
  'channels',
  'terminal',
];
```
