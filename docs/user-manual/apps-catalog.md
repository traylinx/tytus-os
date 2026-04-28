# Apps Catalog

Every app installed in TytusOS today. The Tytus surfaces (Pod Inspector, Settings, Help, Chat, Files, Channels, Browser) are now wired to the daemon — no more placeholders.

## System (8)

| App | What it does |
|---|---|
| **Pod Inspector** | Fleet Overview + per-pod tabs. Sort by *Needs attention* or *Pod ID*; search by `pod_id` or `agent_type`. Each row shows a status pill, an **Open agent UI** button, and click-through to the per-pod tab. The per-pod tab shows a status header, URLs grid, **Pin / Unpin**, an action row (**Open / Restart / Doctor / Stop forwarder / Refresh creds**), and a destructive section (**Uninstall… / Revoke…**). Streaming actions render an inline log pane. Pinned pods sort to top. **Restart all** appears when 2+ pods are allocated. |
| **System Settings** | Tytus product config (Account, Plan & Units, Pods, Agents, Daemon) plus OS-feel preferences. See [Settings](settings.md). |
| **Help** | Sidebar tabs: **Doctor**, **Health test**, **Logs**, **About**. Doctor + Test each have a **Run** button, an SSE log pane, and a *"Last run: Xm ago · exit 0"* status line. Logs polls `/api/logs` every 2s with **Pause / Resume** and auto-scroll-when-pinned. About shows daemon PID, formatted uptime, and GitHub links. |
| **Files** | Pods sidebar plus three tabs: **Inbox** (run-streamed `ls-inbox`), **Downloads** (opens `~/Downloads/tytus/pod-NN/` via `postFilesOpenDownloads`), and **Shared** (bind a Mac folder to one or more pods via Garage — folder picker, bucket validation, auto-sync toggle). |
| **Terminal** | Simulated bash today. Real `tytus exec` into pod containers in a later phase. |
| **System Monitor** | CPU, memory, disk, network — host today, pods later. |
| **Archive Manager** | Create and extract ZIP / TAR / 7Z archives. |
| **Channels** | Pods sidebar plus **Available** and **Configured** columns. **Add** opens a modal with a `type=password` input — the token travels in the request body, never in the URL. **Remove** asks for confirmation. |

## Internet (4)

| App | What it does |
|---|---|
| **Chat** | Pods sidebar plus a main pane showing *"Pod NN ready to chat"* and an **Open Pod NN in browser** button (launches the agent UI). Inline chat planned for v1.1. |
| **Browser** | URL bar with scheme validation, registered launchers from `getLaunchers`, plus **Quick Actions** (Tytus dashboard / Provider / GitHub). |
| **Weather** | Forecast with locations. |
| **RSS Reader** | Feed reader with default subscriptions. |

## Productivity (10)

| App | What it does |
|---|---|
| **Notes** | Quick notes with folders. localStorage-backed. |
| **Todo** | Tasks with priorities, projects, due dates. |
| **Reminders** | Time-based reminders + system notification on fire. |
| **Calendar** | Monthly view with events. |
| **Calculator** | Standard 4-function with history. |
| **Clock** | World clock, alarms, timer, stopwatch. |
| **Spreadsheet** | Basic grid with formulas. |
| **Text Editor** | Plain-text editor. Reads/writes the virtual filesystem. |
| **Document Viewer** | PDF and document viewer. |
| **Markdown Preview** | Live markdown rendering with GitHub styling. |

## Media (8)

| App | What it does |
|---|---|
| **Image Viewer** | Single-image view with zoom and slideshow. |
| **Image Gallery** | Browse and organize collections. |
| **Photo Editor** | Crop, filter, adjust. |
| **Music Player** | Audio playback with playlists. |
| **Video Player** | Video playback with controls. |
| **Voice Recorder** | Microphone capture, playback, export. |
| **Screen Recorder** | Browser screen capture (uses native API). |
| **Media Converter** | Format conversion utility. |

## DevTools (6)

| App | What it does |
|---|---|
| **Code Editor** | Syntax-highlighted multi-tab editor. |
| **API Tester** | Postman-clone — real HTTP requests against any URL. Headers, body, params, history, saved endpoints. |
| **JSON Formatter** | Format, validate, beautify, tree view. |
| **Regex Tester** | Test patterns against sample text live. |
| **Base64 Tool** | Encode / decode Base64 + URL strings. |
| **Color Palette** | Generate complementary color schemes. |

## Creative (3)

| App | What it does |
|---|---|
| **Drawing** | Canvas-based drawing app with brushes. |
| **Whiteboard** | Infinite canvas for sketches. |
| **Color Picker** | Pick colors, build palettes. |

## Demo apps (hidden by default)

The 11 Games plus **ASCII Art** and **Matrix Rain** are gated by the **Show demo apps** toggle in **Settings → Display** (default OFF — manifest AN8 demo-apps gate). Flip it on to expose:

- **Minesweeper**, **Snake**, **Tetris**, **Tic-Tac-Toe**, **2048**, **Sudoku**, **Chess**, **Memory**, **Pong**, **Solitaire**, **Flappy Bird**
- **ASCII Art** — generate ASCII text art and diagrams
- **Matrix Rain** — animated falling characters (the green movie effect)

## Shell-level surfaces

Beyond windowed apps, TytusOS now exposes pod state directly from the shell:

- **Top Panel — Daemon status pill** — green / yellow / red / grey. Click opens **Settings → Daemon**.
- **Top Panel — Fleet Health chip** (next to the daemon pill) — pod count + active jobs, color-coded. Click opens **Pod Inspector**.
- **Desktop — Reserved Pods Zone** — top-left 4×2 grid for pinned pods. Click → opens **Pod Inspector** with that pod's tab focused. Right-click → **Unpin**. Stale pins (revoked elsewhere) render at 50% opacity.
- **Desktop — Zero-pods overlay** — appears when `state.agents = []`. CTA jumps to **Settings → Agents**.

## Window state persistence

Open windows persist across reloads — positions, sizes, minimized and maximized state. Focus order and z-index reset on reload.

## Permanently dropped (won't ship)

These were in the original Kimi seed but were cut because they imply product promises we can't keep:

- **Contacts** — fake address book (no real integration)
- **Email** — fake "send mail" creates a real safety risk
- **FtpClient** — fake FTP, dials nothing
- **GitClient** — fake git ops, misleading
- **NetworkTools** — fake ping/traceroute, dangerous
- **PasswordManager** — fake password storage, security misrepresentation

If you need any of these, use the real OS-level tool instead.
