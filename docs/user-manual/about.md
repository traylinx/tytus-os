# About TytusOS

TytusOS is the desktop interface for Tytus, the private AI pod product by Traylinx. It turns the local tray daemon, pod fleet, included gateway, files, channels, and app workflows into one browser desktop.

## Names

- **TytusOS** — the desktop UI.
- **Tytus** — the product family and CLI/tray daemon.
- **Tytus Home** — the local workspace at `~/Tytus`.
- **Pod** — a private agent runtime allocated by Tytus.
- **All LLM Gateway** — included OpenAI-compatible gateway, free/included and not counted against pod units.
- **Tower** — legacy web UI. Use only as rollback while cutover finishes.

## What users should open

- Tray menu -> **Open TytusOS**
- `tytus open`
- local URL served by the tray daemon, normally `http://localhost:<tray-port>`

## What belongs in TytusOS

- Pod readiness and install progress
- Gateway URLs and env copy formats
- Files and shared folders
- Channels and messenger setup
- Terminal and streamed command output
- Settings, updates, session expiry, daemon health
- Help/manuals/support flows

## Documentation surfaces

- In-app Help / docs registry
- `tytus os-docs`
- `tytus link [DIR]`
- Central handbook: `~/Documents/TYTUS-OS/`

## Built with

- Vite + React + TypeScript
- Tray daemon HTTP/SSE bridge from `tytus-cli`
- Browser terminal through local daemon shell bridge
- CSS theme tokens for dark/light/accent consistency
