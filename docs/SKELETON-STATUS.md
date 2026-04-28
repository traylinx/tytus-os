# Skeleton Status

A snapshot of what's working in TytusOS as of **2026-04-28**, end of Phase 1.

## Verified (52/52 apps green)

The 52-app sweep (`node scripts/sweep.mjs`) opens every app from the launcher and captures runtime errors. Today all 52 pass with zero console errors.

```
summary: 52 pass · 0 fail · 52 total
```

## Window manager

| Capability | Status | Verified by |
|---|---|---|
| Drag window from title bar | ✅ | smoke step 6 (dx=220, dy=90) |
| Resize from any edge | ✅ | smoke step 7 (dw=120, dh=100 from SE corner) |
| Resize from any corner | ✅ | manual + WindowFrame code path |
| Close button removes window | ✅ | smoke step 8 |
| Minimize hides window | ✅ | smoke step 10 |
| Click dock icon restores | ✅ | smoke step 11 (new in commit 378ae8d) |
| Maximize fills viewport | ✅ | smoke step 12 (1440×804 — top 28 + dock 68 reserved) |
| Double-click title to maximize | ✅ | manual |
| Focus on click | ✅ | manual + Z-index increments |
| Z-index stacking | ✅ | manual |
| Alt+Tab cycle | ✅ | manual + App.tsx keyboard handler |
| Alt+Tab overlay | ✅ | manual |
| Min size enforced | ✅ | 320×200 in code |
| Boundaries (top panel, viewport edges) | ✅ | code review |

## Dock

| Capability | Status |
|---|---|
| Pinned apps render | ✅ |
| Unpinned-but-open apps appear | ✅ |
| Click opens new window | ✅ |
| Click for minimized window restores it | ✅ (new) |
| Active dot indicator (focused = accent, unfocused = grey) | ✅ |
| Hover tooltip shows app name | ✅ |
| Bounce animation on launch | ✅ (local state, 400ms — bug fixed in 378ae8d) |
| `aria-label` on every button | ✅ (new in 378ae8d) |
| Trash icon | ✅ (placeholder action) |

## Launcher

| Capability | Status |
|---|---|
| ⌘ key toggles | ✅ |
| Click apps-grid button toggles | ✅ |
| Search filter (name + description) | ✅ |
| Clear search × button | ✅ |
| Categories: Favorites, All, System, Internet, Productivity, Media, DevTools, Creative, Games | ✅ |
| Frequently Used row (when not searching) | ✅ |
| Click-outside closes | ✅ |
| Esc closes | ✅ |
| App click opens + closes launcher | ✅ |

## Desktop

| Capability | Status |
|---|---|
| 8 default icons render | ✅ |
| Drag icons (snap to 80×90 grid) | ✅ |
| Double-click opens app | ✅ |
| Right-click context menu | ✅ |
| Selection highlight | ✅ |
| Position persists in localStorage | ✅ |
| Right-click empty space context menu | ✅ |
| Wallpaper renders | ✅ |

## Boot + Login

| Capability | Status |
|---|---|
| 4-phase boot animation | ✅ (~4s) |
| Logo, progress bar, transition | ✅ |
| TytusOS branding (no UbuntuOS leftovers) | ✅ (verified by grep) |
| Login screen with blurred wallpaper | ✅ |
| Unlock button (any password) | ✅ |
| Log in as Guest | ✅ |
| Power / Suspend / Logout buttons | ⚠️ decorative (no logic wired) |

## Top Panel

| Capability | Status |
|---|---|
| Apps button → launcher | ✅ |
| Live clock | ✅ (updates every 1s) |
| Date tooltip on hover | ✅ |
| Click clock → notification center | ✅ |
| System tray icons (wifi, volume, battery, accessibility, keyboard) | ✅ visual only |
| Power menu popover | ✅ |
| Power menu → Lock / Logout dispatches LOGOUT | ✅ |

## Notification system

| Capability | Status |
|---|---|
| Toast appears on `addNotification` dispatch | ✅ |
| Auto-dismiss after 5s | ✅ |
| Hover pauses progress bar | ✅ |
| Stack of up to 5 toasts | ✅ |
| Notification Center slide-out | ✅ |
| Calendar inside center | ✅ |
| Clear All | ✅ |
| Empty state | ✅ |

## Theming

| Capability | Status |
|---|---|
| Dark mode (default) | ✅ |
| Light mode toggle | ✅ |
| 8 accent colors | ✅ |
| Theme persists to localStorage | ✅ |
| Wallpaper picker | ✅ (preset images) |
| Wallpaper persists | ✅ |
| Border-radius scale (sm 4 / md 8 / lg 12 / xl 16 / full) consistently applied | ✅ (audit pass 2026-04-28) |
| TopPanel buttons fit inside 28 px panel (h-6 = 24 px) | ✅ |
| Dock floats 6 px from viewport, full 16 px corners on all sides | ✅ |
| Active-app dot sits inside dock (no edge clipping) | ✅ |

## Apps verified in sweep (all 52)

**System (8):** Pod Inspector, Channels, Help, System Settings, Files, Terminal, System Monitor, Archive Manager

**Internet (4):** Chat, Browser, Weather, RSS Reader

**Productivity (10):** Notes, Todo, Reminders, Calendar, Calculator, Clock, Spreadsheet, Text Editor, Document Viewer, Markdown Preview

**Media (8):** Image Viewer, Image Gallery, Photo Editor, Music Player, Video Player, Voice Recorder, Screen Recorder, Media Converter

**DevTools (6):** Code Editor, API Tester, JSON Formatter, Regex Tester, Base64 Tool, Color Palette

**Creative (5):** Drawing, Whiteboard, Color Picker, ASCII Art, Matrix Rain

**Games (11):** Minesweeper, Snake, Tetris, Tic-Tac-Toe, 2048, Sudoku, Chess, Memory Game, Pong, Solitaire, Flappy Bird

## Build numbers

| Metric | Value |
|---|---|
| Source files | 80+ TS/TSX |
| Apps | 52 |
| Source LOC | ~12,000 |
| Bundle (build) | 1.54 MB JS / 94 KB CSS |
| Bundle (gzip) | 363 KB JS / 16 KB CSS |
| Cold install | ~45 s |
| Cold dev start | < 1 s |
| Build time | ~6 s |
| Smoke duration | ~10 s |
| Sweep duration | ~3 min (52 × 3 s) |

## Known gaps (intentional)

| Gap | Phase to fix |
|---|---|
| No daemon connection | Phase 2 |
| Pod Inspector / Channels / Help are placeholders | Phase 3-4 |
| Login password isn't validated | Phase 2 |
| Wi-Fi / Bluetooth / Power panels in Settings are decorative | Phase 3 |
| Terminal commands are simulated | Phase 6 |
| Tower deep-link fragment routing | Phase 3 (router) |
| Boot bundle eagerly loads all 50 apps | Future polish (`React.lazy`) |
| No CI gating on PRs | Future |
| No reducer unit tests | Future |
| No multi-monitor / window snapping | Future |
| No PWA / offline | Future |

## What this status doc gates

The skeleton is **complete enough** to:

- ✅ Land a daemon client (Phase 2) without breaking anything
- ✅ Build out Pod Inspector / Settings (Phase 3) on top
- ✅ Onboard a new contributor — they can read the docs, run the sweep, see green
- ✅ Demo the look-and-feel to anyone (Sebastian's "real OS feel" mandate)

What it does **not** gate:

- ❌ Public release (logo + naming + license + landing page still TBD)
- ❌ Operator-tier sale (needs the daemon-wired surfaces from Phases 2–5)
- ❌ Apple code signing (deferred until paying customers — see Tytus v0.6 audit)
