# Architecture Overview

TytusOS is a single-page React app pretending to be an operating system.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Build | **Vite 7** | Instant HMR, native ESM, < 1s cold start |
| Framework | **React 19** | Concurrent rendering, no boilerplate, huge ecosystem |
| Language | **TypeScript 5.9** | Catches every prop / action shape mistake at compile time |
| Styling | **Tailwind CSS 3** | Atomic classes, design-token integration |
| Components | **shadcn-style primitives** (Radix UI) | Accessible, unopinionated, copy-paste-able |
| Icons | **lucide-react** | 1500+ open-source SVGs, tree-shakable |
| State | **React Context + useReducer** | Zero deps, full type safety, easy to read |
| Persistence | **localStorage** today | No backend yet; daemon HTTP + SSE in Phase 2 |
| Testing | **Playwright** | Real Chromium, real DOM, catches browser-only bugs |

## Directory map

```
app/
├── index.html                  entry, <title>TytusOS</title>
├── public/
│   ├── favicon.svg             dual-orb logo
│   └── wallpaper-default.jpg
├── vite.config.ts              dev server on :4242, /api proxy stub
├── tailwind.config.js
├── tsconfig.*.json
├── package.json                "tytus-os" private package
├── scripts/
│   ├── smoke.mjs               14-step interaction smoke test
│   └── sweep.mjs               opens every app, checks for runtime errors
└── src/
    ├── main.tsx                createRoot + App
    ├── App.tsx                 shell composition (Boot → Login → Desktop)
    ├── App.css, index.css      design tokens (CSS variables)
    ├── lib/utils.ts            cn() helper
    ├── types/index.ts          OSState, Window, AppDefinition, OSAction, ...
    ├── hooks/
    │   ├── useOSStore.tsx      reducer + context provider — the brain
    │   ├── useFileSystem.ts    virtual FS today, daemon-backed in Phase 5
    │   └── use-mobile.ts
    ├── components/
    │   ├── BootSequence.tsx    4-phase animated boot (logo → loading → transition → desktop)
    │   ├── LoginScreen.tsx     blurred-wallpaper login card
    │   ├── Desktop.tsx         icons + drag + right-click context menu
    │   ├── TopPanel.tsx        Activities button, clock, system tray
    │   ├── Dock.tsx            pinned + open apps, indicator dots, trash
    │   ├── WindowFrame.tsx     drag, resize, focus, title bar with controls
    │   ├── WindowManager.tsx   renders open windows, dispatches via AppRouter
    │   ├── AppLauncher.tsx     full-screen overlay, search, categories, grid
    │   ├── ContextMenu.tsx     right-click menus
    │   ├── NotificationSystem.tsx  toast stack (top-right)
    │   ├── NotificationCenter.tsx  slide-out panel + calendar
    │   └── ui/                 53 shadcn primitives (button, dialog, input, ...)
    └── apps/
        ├── registry.ts         APP_REGISTRY array — every installed app
        ├── AppRouter.tsx       appId → component dispatcher
        ├── AppPlaceholder.tsx  generic "Wires up in Phase N" card
        └── *.tsx               49 app components
```

## Component hierarchy

```
App
└── OSProvider                          state.* + dispatch
    └── AppShell
        ├── BootSequence                until boot complete
        ├── LoginScreen                 until authenticated
        └── Desktop view (layered)
            ├── Wallpaper                background image
            ├── Desktop                  icons (drag, dbl-click, right-click)
            ├── WindowManager            renders state.windows
            │   └── WindowFrame[]
            │       └── AppRouter        appId → <App />
            ├── TopPanel                 activities, clock, tray
            ├── Dock                     pinned + open apps
            ├── AppLauncher              overlay (when open)
            ├── ContextMenu              overlay (when open)
            ├── NotificationSystem       toasts
            ├── NotificationCenter       slide-out panel (when open)
            └── Alt+Tab overlay          (when alt-tabbing)
```

## Who-talks-to-whom

```
                 ┌────────────────────┐
                 │    OSContext        │
                 │  state + dispatch   │
                 └──────────┬─────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  Components             Apps                Hooks
  (read state +     (read state +        (wrap dispatch
   dispatch)         dispatch)             into helpers)
```

Every component reads state from `useOS()` and dispatches actions back through the same context. There's exactly one source of truth.

## Today's network surface

**Zero.** TytusOS has no fetch / WebSocket / EventSource code outside the API Tester (which only fires when a user clicks "Send" on a URL they typed).

Phase 2 introduces:
- `lib/daemon.ts` — typed `fetch` wrapper for `tytus-cli` daemon
- `hooks/useDaemonState.ts` — react-query-style `/api/state` poll
- `hooks/useJobStream.ts` — EventSource wrapper for `/api/jobs/<id>/stream`

## Conventions

- **Functional components only.** No class components anywhere.
- **`memo()` everything** that doesn't need to re-render every parent tick.
- **`useCallback` for every dispatch wrapper.** Prevents reducer storms.
- **Inline styles for dynamic values, Tailwind for static.** No styled-components.
- **CSS variables for design tokens.** See [theming.md](theming.md).
- **Each app is one `.tsx` file** under `src/apps/`. No subfolders per app.

## Bundle size today

```
1.54 MB JS / gzip 363 KB
94 KB CSS / gzip 16 KB
```

Will be code-split in a future polish phase. The 50-app catalog is loaded eagerly today; dynamic `import()` per app could drop the initial bundle to ~150 KB.
