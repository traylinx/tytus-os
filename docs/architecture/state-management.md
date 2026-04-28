# State Management

TytusOS uses a single React `useReducer` wrapped in a Context provider. No Redux, no Zustand, no Jotai. Why: every action and slice is < 100 lines; the reducer fits on one screen; there's no async middleware to layer.

## The store

`app/src/hooks/useOSStore.tsx`:

```tsx
const OSContext = createContext<{
  state: OSState;
  dispatch: React.Dispatch<OSAction>;
}>(null);

export const OSProvider: FC<{ children }> = ({ children }) => {
  const [state, dispatch] = useReducer(osReducer, initialState);
  return <OSContext.Provider value={{ state, dispatch }}>{children}</OSContext.Provider>;
};

export const useOS = () => useContext(OSContext);
```

## State shape

```ts
interface OSState {
  bootPhase: 'off' | 'logo' | 'loading' | 'transition' | 'desktop' | 'login' | 'complete';
  auth: { isAuthenticated: boolean; isGuest: boolean; userName: string };
  windows: Window[];           // every open window
  apps: AppDefinition[];       // every installed app (= APP_REGISTRY)
  desktopIcons: DesktopIcon[]; // icons on the desktop
  theme: { mode: 'dark' | 'light'; accent: string; wallpaper: string };
  notifications: Notification[];
  dockItems: DockItem[];       // one per app, with isPinned / isOpen / isFocused / bounce flags
  contextMenu: { visible, x, y, type, items, contextData? };
  appLauncherOpen: boolean;
  notificationCenterOpen: boolean;
  activeWindowId: string | null;
  nextZIndex: number;
  isAltTabbing: boolean;
  altTabIndex: number;
}
```

Full type: `app/src/types/index.ts`.

## Actions

The reducer accepts a discriminated-union `OSAction`. All actions live in one place:

| Category | Actions |
|---|---|
| **Boot / Auth** | `SET_BOOT_PHASE`, `LOGIN`, `LOGOUT` |
| **Windows** | `OPEN_WINDOW`, `CLOSE_WINDOW`, `MINIMIZE_WINDOW`, `MAXIMIZE_WINDOW`, `RESTORE_WINDOW`, `FOCUS_WINDOW`, `MOVE_WINDOW`, `RESIZE_WINDOW`, `SET_ACTIVE_WINDOW` |
| **Launcher** | `TOGGLE_APP_LAUNCHER`, `SET_APP_LAUNCHER` |
| **Notifications** | `TOGGLE_NOTIFICATION_CENTER`, `ADD_NOTIFICATION`, `REMOVE_NOTIFICATION`, `CLEAR_NOTIFICATIONS`, `MARK_NOTIFICATION_READ` |
| **Desktop** | `ADD_DESKTOP_ICON`, `REMOVE_DESKTOP_ICON`, `UPDATE_DESKTOP_ICON_POSITION`, `SELECT_DESKTOP_ICON` |
| **Theme** | `SET_THEME`, `TOGGLE_THEME` |
| **Dock** | `PIN_DOCK_ITEM`, `UNPIN_DOCK_ITEM`, `BOUNCE_DOCK_ITEM` |
| **Context menu** | `SHOW_CONTEXT_MENU`, `HIDE_CONTEXT_MENU` |
| **Alt+Tab** | `START_ALT_TAB`, `CYCLE_ALT_TAB`, `END_ALT_TAB` |
| **Window arrangement** | `CASCADE_WINDOWS`, `MINIMIZE_ALL` |

## Reducer rules

The reducer in `useOSStore.tsx` follows three rules:

1. **Pure.** Every case returns a new state object — never mutates.
2. **Side-effect-free**, except for direct `localStorage.setItem` calls for persistence (desktop icons, etc.). No async, no fetch, no setTimeout inside the reducer.
3. **Cross-action consistency.** Opening a window updates `windows` + `dockItems` + `activeWindowId` + `nextZIndex` in a single dispatch. Components see one consistent snapshot.

## Persistence

- `tytus_desktop_icons` — saved on every `ADD/REMOVE/UPDATE_DESKTOP_ICON_*`
- Other slices (notes, todos, calendar, etc.) persist inside their own apps, *not* in the OS store. This keeps the store small and the apps autonomous.

## Convenience hooks

Re-exported from `useOSStore.tsx`:

- `useWindows()` — `{ windows, openWindow, closeWindow, minimizeWindow, ... }`
- `useNotifications()` — `{ notifications, addNotification, removeNotification, clearNotifications }`

Both wrap dispatch in `useCallback` so consumers don't re-render.

## Why not Redux / Zustand?

- **Redux** — too much boilerplate (action creators, reducers, slices, middleware) for ~25 actions
- **Zustand** — great, but adds a dependency we don't need
- **Jotai / Recoil** — fine-grained re-renders matter when state is huge; ours fits in 30 KB

If the store grows past ~50 actions or async middleware appears (Phase 2's daemon connector might pressure this), reconsider.

## Common pitfalls

### Adding a useEffect that dispatches based on state

This was the **bouncing infinite loop bug** (commit `378ae8d`). If you write:

```tsx
useEffect(() => {
  if (someState) dispatch({ type: 'X' });
}, [someState]);
```

…and the action you dispatch causes `someState` to change again, you've made an infinite loop. Either:
- Have the reducer **clear** the trigger flag, or
- Use a ref to deduplicate, or
- Move the side effect out of the global store entirely (the fix in our case).

### Stale closures in callbacks

If you `useCallback` something that reads state, the callback captures the *current* state. Either:
- Add the state to the deps array, or
- Use the dispatch's `(prev) => …` form (functional update — only works for React's `useState`, not our reducer)

### Forgetting to focus a new window

`OPEN_WINDOW` already sets `isFocused: true` and updates `activeWindowId`. Don't dispatch `FOCUS_WINDOW` after — it'll bump the z-index pointlessly.
