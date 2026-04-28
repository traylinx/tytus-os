# App Launcher

A full-screen overlay listing every installed app, organized by category.

## Open it

- **Click the apps-grid button** at the far left of the dock
- **Press ⌘** (Super / Win key)

## Close it

- **Press Esc**
- **Click anywhere outside** the search bar / app grid
- **Click an app** — launcher closes and the app opens

## Layout

```
                      ┌─────────────────────────┐
                      │ 🔍 Type to search…      │
                      └─────────────────────────┘

                      FREQUENTLY USED
                      📦  ⚙️  💬  📁  ✈️  ⌨

  Favorites    All    System    Internet    Productivity    Media    DevTools    Creative    Games

                  🗒️    📅    🧮    ⏰    📊    📝    📄    📑    🎵    🎬    🎮    ♟️    …
```

## Sections

- **Frequently Used** — your 6 pinned dock apps (only shown when search is empty)
- **Categories** — `Favorites`, `All`, `System`, `Internet`, `Productivity`, `Media`, `DevTools`, `Creative`, `Games`
- **App grid** — every app matching the active category and search

## Search

Start typing — the grid filters to apps matching by name *or* description. Search clears the category filter (always searches across all apps).

The **×** button inside the search box clears it.

## Categories at a glance

| Category | Apps |
|---|---|
| **Favorites** | Whatever's pinned to the dock right now |
| **System** | Pod Inspector · Settings · Files · Terminal · Help · System Monitor · Archive Manager |
| **Internet** | Chat · Browser · Channels · Weather · RSS Reader |
| **Productivity** | Notes · Todo · Reminders · Calendar · Calculator · Clock · Spreadsheet · Text Editor · Document Viewer · Markdown Preview |
| **Media** | Image Viewer · Image Gallery · Photo Editor · Music Player · Video Player · Voice Recorder · Screen Recorder · Media Converter |
| **DevTools** | Code Editor · API Tester · JSON Formatter · Regex Tester · Base64 Tool · Color Palette |
| **Creative** | Drawing · Whiteboard · Color Picker · ASCII Art · Matrix Rain |
| **Games** | Minesweeper · Snake · Tetris · Tic-Tac-Toe · 2048 · Sudoku · Chess · Memory · Pong · Solitaire · Flappy Bird |

Full list with one-liners: [apps-catalog.md](apps-catalog.md).

## Keyboard

- **Type** to search
- **Esc** to close

(Arrow-key navigation between cards is on the [roadmap](../development/roadmap.md).)
