# Tytus OS — Integration Deep-Dive

**Date:** 2026-04-28
**Question:** how do we collapse Tytus Tower (vanilla-JS page in `tytus-cli`) into the new web-OS shell at `services/tytus-os/app/`?

---

## TL;DR — Verdict

**Option A executed as a strangler-port (codex calls it "Option D").**

- Each Tower tab becomes one or more native OS apps in tytus-os.
- Daemon API (~40 endpoints) is the load-bearing contract — DO NOT change it.
- Tray fragment deep-links (`#chat`, `#/pod/02/restart`, …) are mapped to `os://launch/<app>?...` intents inside the OS shell. Until a given OS app reaches Tower-parity, that fragment falls back to opening the legacy Tower page.
- Tower stays alive in `tytus-cli` until *every* surface has parity. Then Tower is deleted.

**Why not B (iframe Tower inside the OS):** Mac-in-a-Mac. Two visual languages, one window. The seam is visible in 0.5 seconds. Operator-tier customers ($149/mo) will read it as broken.

**Why not C (pure clean rebuild):** "Throw it all out and design from zero" is a multi-week vaporware trap. Solo dev. Ship beats ship-prettier.

---

## What Tower Actually Does (the reality)

Inventory from the discovery audit (full version: see audit memory). The contract surface tytus-os must consume:

### Routes (8)
| Hash | Purpose |
|---|---|
| `#chat` | Pod chat list + "Talk to this AI" launcher |
| `#files` | Per-pod inbox + Downloads folder |
| `#channels` | Per-pod messenger bindings (Telegram + 20 more) |
| `#settings` | Plan/units strip, agent catalog + install wizard, autostart toggles |
| `#help` | Doctor, daemon lifecycle, log tail, wizard replay |
| `#/pod/NN/overview` | Per-pod card: env vars, URLs, copy buttons |
| `#/pod/NN/output` | Streamed subprocess view (restart/uninstall/revoke) |
| `#/pod/NN/channels` | Pod channels manager + token modal |

### Daemon endpoints (load-bearing — keep ALL)
- `GET /api/state` — auth + pod list + plan + units + included slots
- `GET /api/catalog` — agent catalog (cache-bust `?refresh=1`)
- `POST /api/install` — start install, returns `job_id`
- `GET /api/jobs/<id>/stream` — SSE: stdout / stderr / exit
- `POST /api/pod/<n>/run-streamed` `{action: restart|uninstall|revoke|stop-forwarder|ls-inbox|doctor}`
- `POST /api/pod/open?pod=NN` — opens pod's OpenClaw URL in user's browser
- `POST /api/pod/refresh-creds?pod=NN`
- `GET/POST /api/channels`, `/api/channels/add`, `/api/channels/remove`, `/api/channels/catalog`
- `POST /api/shared-folders/{pick-folder|bind|run-streamed|open-cache}`, `GET /api/shared-folders/list`
- `POST /api/settings/{autostart-tunnel|autostart-tray}`
- `POST /api/{daemon/start|stop|restart|status|connect|disconnect|configure|logout|doctor|test|launch}`
- `GET /api/{logs|launchers}`

**Critical invariant:** every long-running action spawns a subprocess, returns `{job_id}`, and streams via SSE on `/api/jobs/<id>/stream`. The new OS apps must speak this protocol natively.

### Tray bridge (must NOT break)
Tray deep-links Tower via hash fragments AND calls daemon endpoints directly. Both must keep working. The new tytus-os router accepts the same fragments and routes them to the right OS app.

```
Tray fragment                              →  tytus-os intent
#chat                                      →  open Chat app (no pod arg)
#files                                     →  open Files app
#channels                                  →  open Channels app
#/run/test                                 →  open Pod Inspector → Run Health Test
#/run/doctor                               →  open Pod Inspector → Run Doctor
#/pod/02/restart                           →  open Pod Inspector for pod 02 → fire restart
#/pod/02/channels?action=add&type=telegram →  open Channels app on pod 02 → token modal type=telegram
```

The nonce query (`?n=<nanos>`) keeps `hashchange` firing even on identical fragments — preserve it.

---

## What the Skeleton Actually Delivers

Audit verdict: **shell is READY. Backend is ABSENT.**

### Shell scorecard (12/12 READY)
Boot, Login, Desktop, TopPanel, Dock, WindowFrame (drag/resize/min/max/focus), WindowManager, AppLauncher (search + 9 categories), ContextMenu, NotificationSystem, NotificationCenter, OSStore (useReducer with 25+ action types). Keyboard shortcuts (Meta, Ctrl+Alt+T, Alt+Tab, Ctrl+W, Esc) wired. Drag-snap on desktop icons + localStorage persistence.

Net: visually ship-grade for the operator tier. Drag, resize, focus, minimize, alt-tab — all real.

### What's missing — must be built before any porting
1. **Daemon client layer.** Zero network code today. We need `lib/daemon.ts` — single `fetch` wrapper that auto-discovers the random tytus-cli port (currently written to `/tmp/tytus/tray-web.port`), retries on disconnect, surfaces typed errors.
2. **Typed domain models.** `types/Pod.ts`, `types/Plan.ts`, `types/Channel.ts`, `types/Job.ts`. Right now only OS-shell types exist.
3. **SSE/job hook.** `useJobStream(jobId)` — wraps EventSource, handles reconnect, cancellation, exit-code parsing.
4. **Deep-link router.** Read incoming `#fragment`, dispatch `OPEN_WINDOW` with payload. Backwards-compat shim for legacy Tower fragments.
5. **Real auth bridge.** LoginScreen ignores password today; replace with `GET /api/state` → if unauthenticated, redirect to tray's `tytus login` flow. Operator already authenticates via the tray — the OS just reads the daemon's session.

### What CAN'T survive contact
The fake VFS in `useFileSystem.ts` and the fake `Terminal.tsx` will break the moment they meet a real pod. Either swap or delete them in v1 — no half-measures.

---

## App Registry Diet (codex + me agree)

The unzipped skeleton ships **56 apps**. The product is **pod management**, not Solitaire. Trim ruthlessly.

### Keep (8) — the real product
| App | Origin | Purpose |
|---|---|---|
| **Chat** | existing stub | Pod chat — wired to OpenClaw URL or in-app chat over `/api/pod/open` |
| **Files** | rename `FileManager` | Per-pod inbox + downloads + garage shared folders |
| **Channels** | NEW | Telegram/Discord/Slack/iMessage/Matrix bindings per pod |
| **Settings** | existing stub | Plan/units, agent catalog, install wizard, autostart toggles, sign-out |
| **Pod Inspector** | NEW | Per-pod card: env vars, URLs, copy buttons, restart/uninstall/revoke, run-streamed log view |
| **Help** | NEW | Doctor, daemon lifecycle, log tail, troubleshoot, wizard replay |
| **Terminal** | existing stub (rebuilt) | Real `tytus exec --pod NN <cmd>` against pod containers |
| **Browser** | existing | Used to deep-link to GitHub docs, agent homepages, Tower-equivalent web targets |

### Delete (48)
Every game (10), every creative app (4), Spreadsheet, MarkdownPreview, RegexTester, JsonFormatter, Calculator, Calendar, Clock, Notes, Todo, Reminders, Contacts, PasswordManager, Whiteboard, Email, Weather, RssReader, FtpClient, NetworkTools, MusicPlayer, VideoPlayer, ImageViewer, ImageGallery, PhotoEditor, VoiceRecorder, ScreenRecorder, MediaConverter, ArchiveManager, SystemMonitor, CodeEditor, GitClient, ApiTester, Base64Tool, ColorPalette, ColorPicker, AsciiArt, DocumentViewer.

Cleaner registry = clearer product. We can re-introduce *real* productivity apps later if there's a story for them, but they shouldn't be in the v1 grid as fakes.

---

## Phase Plan (6 phases)

Sized for solo Sebastian + Claude. Each phase is a shippable increment.

### Phase 1 — Foundation cleanup (1-2 days)
- Trim app registry to the 8 keepers; delete the 48 stub `.tsx` files
- Wire dev server (`npm run dev` smoke test)
- Strip fake VFS from useFileSystem.ts; mark Terminal `coming-soon`
- Add `vite.config.ts` proxy → tytus-cli daemon port
- Smoke screen: empty OS, real boot/login, only the 8 dock apps

### Phase 2 — Daemon client + types + auth bridge (2-3 days)
- `lib/daemon.ts`: port discovery (`/tmp/tytus/tray-web.port`), typed `fetch`, retry, error model
- `types/`: Pod, Plan, Channel, Job, Catalog, StateSnapshot, BindingRow
- `hooks/useDaemonState.ts`: react-query-style live `/api/state`
- `hooks/useJobStream.ts`: EventSource wrapper for SSE
- LoginScreen → reads `/api/state`; if unauthenticated, deep-link `tytus login` and poll until auth flips
- **Done = login screen is real, OS knows the user's plan + units + pod list**

### Phase 3 — Settings + Pod Inspector (3-4 days, the most load-bearing apps)
- Settings: plan/units strip, agent catalog with install wizard, autostart toggles, sign-out — all `/api/state`-driven
- Pod Inspector: per-pod card, copy env/URL buttons, restart/uninstall/revoke buttons that invoke `run-streamed` and stream into a built-in log pane
- Tray deep-link router: `#/pod/NN/restart` → opens Pod Inspector + auto-fires
- **Done = the tray's most-used menu items now route into the OS shell, not Tower**

### Phase 4 — Chat + streamed runs (2-3 days)
- Chat app: per-pod conversation list; "Talk to this AI" → POST `/api/pod/open` opens browser; OR future inline chat via daemon proxy
- Health/Doctor surfaced as Pod Inspector tabs
- **Done = `#chat` and `#/run/doctor` are tytus-os-native**

### Phase 5 — Files + Channels (3-4 days)
- Files app: per-pod inbox + Downloads + garage shared folders binding form (calls `/api/shared-folders/*`)
- Channels app: per-pod bindings list, "Add channel" with token modal (native HTML `<dialog>` ported to a shadcn Dialog)
- **Done = Tower's last functional tabs are absorbed**

### Phase 6 — Deprecate Tower (1 day)
- Add a banner to the legacy Tower page: "This is now built into Tytus — open the OS"
- Tray menu items still pointing at Tower (`open_tower_at`) get rerouted in tytus-cli to `open_os_at` instead
- Once 2 weeks of zero-traffic on Tower routes, delete the Tower HTML/JS bundles + tower routes from tytus-cli
- **Done = Tower is gone, contract preserved, tray↔OS bridge is the only path**

---

## Bridge Preservation Contract (HARD RULES)

These are the non-negotiables Sebastian called out. They flow into every phase.

1. **Tray↔daemon HTTP contract is frozen.** No endpoint renames, no breaking response shapes. New endpoints OK. Removing endpoints requires Tower being already dead.
2. **Tray deep-link fragments are frozen** (we may add new ones, never break existing). Old fragments map into the OS via `os-router.ts` — at first by punting to Tower, eventually by opening the matching OS app.
3. **The random-port discovery file** (`/tmp/tytus/tray-web.port`) is the only daemon address book. Both Tower and tytus-os read it. Don't replace with hardcoded ports.
4. **The job_id + SSE protocol** (`POST /api/foo` returns `{job_id}` → `GET /api/jobs/<id>/stream` SSE) is the universal long-running-action pattern. New OS apps speak it natively.
5. **The native `<dialog>` token modal** in Tower is browser-security important (tokens stay out of URL bar). Port it as a real React modal that *also* keeps tokens out of URLs.

---

## Biggest Landmine (codex called it)

> "API shape rot. The daemon endpoints were designed for Tower's inline JS, not a typed app ecosystem. If Sebastian 'just fetches everywhere,' the OS becomes Tower with prettier CSS."

The fix: Phase 2 *must* land before any OS-app porting. One typed `daemonClient`, domain types, SSE hook, error model, deep-link router. If we skip Phase 2 we will paint over Tower's bones with Tailwind and discover in Phase 5 we have no architecture.

---

## Open Questions (call before Phase 1 kicks off)

1. **Do we keep Terminal in v1?** It has product appeal (operator-tier customers want shell into pods), but real wiring (`tytus exec` + xterm.js) is its own sprint. **Default: keep as a thin "Coming soon" placeholder, pin to dock, real impl in v1.1.**
2. **Auth flow.** OS reads daemon state; if unauthenticated it deep-links to tray's `tytus login`. But should the OS also have a logout button? **Default: yes, in Settings.** Simple.
3. **Distribution.** tytus-os is a static SPA. Do we serve it from the same tytus-cli tiny_http daemon (replacing Tower's bundle), or as a separate `services/tytus-os/dist/` artifact? **Default: same daemon. Replaces Tower's `include_bytes!` bundle in Phase 6. Avoids new ports, new install steps.**
4. **Naming.** Boot animation today says "UbuntuOS" — clearly placeholder. Brand to "Tytus" with the existing purple/pink dual-orb logo. Phase 1 task.

---

## Codex independent verdict

> *"Port-into-OS. Avoids B's credibility killer (polished OS shell wrapping an old localhost web app — operator tier feels the seam instantly). Avoids C's solo-dev death march. Converts Tower tabs into actual product primitives that match the OS metaphor instead of fighting it."*

Convergent recommendation. Ship Option A as a strangler.

---

## Status

- **Inventory:** complete (Tower routes/actions/endpoints/deep-links — 3 tables)
- **Skeleton audit:** complete (shell READY, backend ABSENT, 5 refactors needed)
- **Codex consult:** complete (agrees, picks A; suggests strangler bridge)
- **Recommendation:** Option A as a strangler. 6 phases, ~2-3 weeks for solo dev.

Ready to start Phase 1 when you are.
