# TytusOS — desktop shell

The visual layer of Tytus. A web-OS metaphor (Boot → Login → Desktop + Dock + WindowManager) that hosts pod-management apps and replaces the legacy Tytus Tower bundled in `tytus-cli`.

## Stack

- Vite 7 + React 19 + TypeScript 5.9
- Tailwind CSS 3 + shadcn-style primitives (Radix UI)
- lucide-react icons
- localStorage for shell state; daemon API (HTTP + SSE) for product data

No telemetry, no analytics, no external SDKs. The dev server proxies `/api/*` to the local `tytus-cli` daemon.

## Apps in v1 (8 placeholders today; wire up per phase)

| App | Phase | Purpose |
|---|---|---|
| Pod Inspector | 3 | Pod state, copy env/URL, restart/uninstall/revoke, streamed logs |
| Settings | 3 | Plan, units, agent catalog + install, autostart, sign-out |
| Chat | 4 | Talk to your pod AI |
| Help | 4 | Doctor, daemon lifecycle, log tail |
| Files | 5 | Per-pod inbox, downloads, garage shared folders |
| Channels | 5 | Telegram / Slack / iMessage / Matrix bindings |
| Terminal | 6 | Real shell into pod containers via `tytus exec` |
| Browser | 6 | Open pod URLs, agent docs, GitHub |

Every other "OS app" you might have seen in the seed (games, calculator, calendar, etc.) was deleted on 2026-04-28 — TytusOS is a product surface, not a Linux replica.

## Run

```bash
npm install
npm run dev      # http://127.0.0.1:3000
npm run build    # tsc -b && vite build → dist/
npm run typecheck
```

## Phase plan

See `../INTEGRATION-DEEPDIVE.md` (one level up). Six phases, strangler-port from Tytus Tower into TytusOS native apps. The `tytus-cli` daemon (~40 endpoints, SSE jobs, tray fragment deep-links) is the load-bearing contract — the OS frontend talks to it; nothing about the daemon changes.

## Layout

```
app/
├── index.html, vite.config.ts, tsconfig.*, tailwind.config.js, postcss.config.js
├── public/
│   ├── favicon.svg            (Tytus dual-orb logo)
│   └── wallpaper-default.jpg
└── src/
    ├── main.tsx               entry
    ├── App.tsx                shell composition (Boot/Login/Desktop)
    ├── App.css, index.css     theme tokens
    ├── types/index.ts         OSState, Window, Notification, AppDefinition...
    ├── lib/utils.ts           cn() helper
    ├── hooks/
    │   ├── useOSStore.tsx     reducer + provider (boot, auth, windows, dock)
    │   └── use-mobile.ts
    ├── components/
    │   ├── BootSequence.tsx, LoginScreen.tsx
    │   ├── Desktop.tsx, TopPanel.tsx, Dock.tsx
    │   ├── WindowManager.tsx, WindowFrame.tsx
    │   ├── AppLauncher.tsx, ContextMenu.tsx
    │   ├── NotificationSystem.tsx, NotificationCenter.tsx
    │   └── ui/                shadcn primitives
    └── apps/
        ├── registry.ts        APP_REGISTRY (8 entries)
        ├── AppRouter.tsx      appId → component dispatcher
        └── AppPlaceholder.tsx generic "Wires up in Phase N" card
```

## What this is NOT

- A general-purpose Linux/Ubuntu replica
- A productivity-app store
- A toy
- A place for Tytus Tower's HTML to be iframed

## What it IS

- A native-feeling shell for managing private AI pods
- The end state of the Tytus Tower migration
- A SPA that ships inside `tytus-cli`'s tiny_http server (Phase 6 swap)
