# App System

How apps are declared, dispatched, and rendered.

## Three files

```
app/src/apps/
├── registry.ts          APP_REGISTRY (declarative metadata)
├── AppRouter.tsx        appId → component dispatcher
├── AppPlaceholder.tsx   generic "Wires up in Phase N" card
└── *.tsx                each individual app
```

## Registry

`registry.ts` is the **source of truth**. Adding an entry here makes the app discoverable in the launcher, dock, and Alt+Tab.

```ts
export const APP_REGISTRY: AppDefinition[] = [
  {
    id: 'pod-inspector',
    name: 'Pod Inspector',
    icon: 'Box',                      // lucide-react icon name
    category: 'System',
    description: 'Inspect, restart, uninstall, revoke pods. Live job logs.',
    defaultSize: { width: 880, height: 600 },
    minSize:     { width: 520, height: 400 },
    phase: 3,                         // optional — placeholder until phase ships
  },
  // ... 51 more entries
];
```

### `AppDefinition` contract

| Field | Required | Notes |
|---|---|---|
| `id` | ✅ | Lowercase kebab-or-camel. Used in `state.windows[].appId`, dock items, URLs. **Don't change once shipped.** |
| `name` | ✅ | Display name. Shows in title bar, launcher, tooltips. |
| `icon` | ✅ | A lucide-react component name (e.g. `'Folder'`, `'Settings'`). |
| `category` | ✅ | `'System' \| 'Internet' \| 'Productivity' \| 'Media' \| 'DevTools' \| 'Creative' \| 'Games'` |
| `description` | ✅ | One-line. Shows in placeholder cards and (some) tooltips. |
| `defaultSize` | ✅ | The window's size when first opened. |
| `minSize` | ✅ | Resize floor. Falls back to 320×200 if smaller. |
| `phase` | ❌ | If present, AppPlaceholder shows "Wires up in Phase N" instead of trying to render the real component. |

### Helpers

```ts
getAppById(id: string): AppDefinition | undefined
getAppsByCategory(cat: string): AppDefinition[]
getDefaultDockApps(): string[]   // which apps are pinned by default
```

## Router

`AppRouter.tsx` is a `switch` on `appId`. It's deliberately verbose (no map lookup, no dynamic require) so TypeScript catches missing dispatches and bundlers can tree-shake unused apps.

```tsx
const AppRouter: FC<{ appId: string; windowId: string }> = ({ appId }) => {
  switch (appId) {
    case 'pod-inspector':
    case 'channels':
    case 'help':
      return <AppPlaceholder appId={appId} />;     // not yet implemented

    case 'settings':       return <Settings />;
    case 'filemanager':    return <FileManager />;
    // ... 47 more cases
    default:               return <AppPlaceholder appId={appId} />;
  }
};
```

## Placeholder

`AppPlaceholder.tsx` renders a centered card with the app's icon, name, description, and a small "Wires up in Phase N" pill. Used for apps not yet built (Pod Inspector, Channels, Help) and as the default for any unknown ID.

The placeholder reads from `getAppById(appId)`. If the registry knows about it, the card looks branded; if not, the card is generic.

## How a window opens

```
User clicks dock / desktop icon / launcher
     │
     ▼
dispatch({ type: 'OPEN_WINDOW', appId: 'notes' })
     │
     ▼
osReducer:
  - createWindow(state, 'notes') → { id, position, size, zIndex, ... }
  - state.windows.push(win)
  - state.dockItems[notes].isOpen = true, isFocused = true, bounce = true
     │
     ▼
WindowManager re-renders:
  state.windows.filter(...).map(w => <WindowFrame window={w}><AppRouter appId={w.appId} /></WindowFrame>)
     │
     ▼
AppRouter('notes') → <Notes />
     │
     ▼
Notes mounts, reads its own localStorage, renders content
```

## Adding a new app

See [development/adding-an-app.md](../development/adding-an-app.md).

## Dropping an app

1. Remove the entry from `registry.ts`.
2. Remove the case from `AppRouter.tsx`.
3. Delete the `.tsx` file.
4. Search the codebase for the `id` string and remove any leftover references (default dock pins, hard-coded shortcuts, tests).

That's it. The dock, launcher, Alt+Tab will all stop showing it on the next render.

## Why a `switch` and not a map?

Considered:

```ts
const APP_COMPONENTS: Record<string, FC> = {
  notes: Notes, todo: Todo, ...
};
```

…but a `switch` is:
- Type-safe (TypeScript narrows correctly)
- Tree-shakable (unused apps actually drop)
- Searchable (grep finds the dispatch line for any app)
- Trivial to read

The maintenance cost (one extra line per app) is negligible against the reading cost.

## Code splitting (future)

When the bundle pressure justifies it, swap eager imports for `React.lazy()`:

```tsx
const Notes = React.lazy(() => import('./Notes'));
// ...
case 'notes': return <Suspense fallback={<AppPlaceholder appId="notes" />}><Notes /></Suspense>;
```

This drops first-paint by ~80% (boot bundle becomes the shell + only-pinned apps). Not done yet — current bundle is 363 KB gzip which is fine.
