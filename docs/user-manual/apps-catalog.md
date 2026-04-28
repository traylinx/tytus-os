# Apps Catalog

Every app installed in TytusOS today (52 total). Apps marked **[Tytus]** are placeholders awaiting their phase wiring.

## System (8)

| App | What it does |
|---|---|
| **Pod Inspector** **[Tytus]** | Pod state, env vars, restart, uninstall, revoke, streamed logs. Phase 3. |
| **Help** **[Tytus]** | Doctor, daemon lifecycle, log tail, troubleshooting. Phase 4. |
| **System Settings** | Appearance, display, sound, power, accent color (and pod plan/units in Phase 3). |
| **Files** | Browse local virtual filesystem. Pod inbox + downloads + garage shared folders in Phase 5. |
| **Terminal** | Simulated bash today. Real `tytus exec` into pod containers in Phase 6. |
| **System Monitor** | CPU, memory, disk, network — host today, pods later. |
| **Archive Manager** | Create and extract ZIP / TAR / 7Z archives. |
| **Channels** **[Tytus]** | Telegram / Slack / iMessage / Matrix bindings per pod. Phase 5. |

## Internet (4)

| App | What it does |
|---|---|
| **Chat** | Talks to your pod AI (Phase 4 wires real chat). |
| **Browser** | Lightweight tabbed browser (iframe-based). |
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

## Creative (5)

| App | What it does |
|---|---|
| **Drawing** | Canvas-based drawing app with brushes. |
| **Whiteboard** | Infinite canvas for sketches. |
| **Color Picker** | Pick colors, build palettes. |
| **ASCII Art** | Generate ASCII text art and diagrams. |
| **Matrix Rain** | Animated falling characters (the green movie effect). |

## Games (11)

| App | What it does |
|---|---|
| **Minesweeper** | Classic with 3 difficulty levels. |
| **Snake** | Classic snake with increasing speed. |
| **Tetris** | Block-stacking puzzle. |
| **Tic-Tac-Toe** | 2-player or vs AI. |
| **2048** | Sliding tile puzzle. |
| **Sudoku** | 9 × 9 puzzle, 4 difficulties. |
| **Chess** | vs AI. |
| **Memory** | Card matching. |
| **Pong** | Classic paddle ball. |
| **Solitaire** | Klondike. |
| **Flappy Bird** | Side-scroller. |

## Permanently dropped (won't ship)

These were in the original Kimi seed but were cut because they imply product promises we can't keep:

- **Contacts** — fake address book (no real integration)
- **Email** — fake "send mail" creates a real safety risk
- **FtpClient** — fake FTP, dials nothing
- **GitClient** — fake git ops, misleading
- **NetworkTools** — fake ping/traceroute, dangerous
- **PasswordManager** — fake password storage, security misrepresentation

If you need any of these, use the real OS-level tool instead.
