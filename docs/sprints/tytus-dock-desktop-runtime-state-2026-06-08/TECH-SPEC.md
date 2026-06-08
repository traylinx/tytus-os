# Tech Spec: Desktop Runtime State for Tytus Dock

Status: planned.

## Design principle

Do **not** treat desktop apps as Tytus OS windows. They are native host processes. The Dock needs a separate runtime overlay:

```ts
const isInternalOpen = item?.isOpen ?? false;
const isDesktopRunning = runningDesktopApps.has(appId);
const isOpening = openingDesktopApps.has(appId);
const showActiveDot = isInternalOpen || isDesktopRunning;
```

This avoids breaking the existing window reducer and persistence model.

## API contract

### `POST /api/apps/runtime`

Request:

```json
{ "app_ids": ["open-design", "openwork", "discord"] }
```

Response:

```json
{
  "results": [
    {
      "id": "open-design",
      "running": true,
      "status": "running",
      "detail": null
    }
  ]
}
```

Statuses:

- `running` — process detected.
- `not_running` — app known/installed but no process detected.
- `not_installed` — catalog app not installed.
- `unsupported` — no runtime detection available for platform/app.
- `error` — detection failed; frontend treats as not running.

Invalid IDs follow existing catalog id guard.

## Catalog metadata

Optional field per app:

```json
"runtime": {
  "macos": { "process_names": ["Open Design"] },
  "linux": { "process_names": ["open-design"] },
  "windows": { "process_names": ["Open Design", "OpenDesign"] }
}
```

Fallback candidate generation:

- `launch[platform].target`
- basename of terminal command target
- normalized variants:
  - strip `.app`
  - strip `.exe`
  - trim spaces

Recommended first metadata targets:

- Open Design: macOS `Open Design`; Linux `open-design`; Windows `Open Design` / `OpenDesign`.
- OpenWork: macOS `OpenWork`; Linux `openwork`; Windows `OpenWork`.
- Discord: macOS/Windows `Discord`; Linux `discord`.
- Telegram Desktop: macOS `Telegram`; Linux `telegram-desktop`; Windows `Telegram`.
- Warp: macOS `Warp`; Linux `warp-terminal`; Windows `warp`.
- Ghostty: macOS `Ghostty`; Linux `ghostty`.

## Backend implementation notes

Candidate pure helpers:

```rust
fn runtime_candidates(entry: &serde_json::Value, platform: &str) -> Vec<String>
fn process_is_running(candidate: &str, platform: &str) -> Result<bool, String>
fn check_app_runtime(entry: &serde_json::Value, platform: &str, arch: &str) -> RuntimeStatus
```

macOS implementation:

```bash
pgrep -x "Open Design"
```

Use `Command` directly, not shell string interpolation. Candidate names come from catalog only.

Linux implementation:

```bash
pgrep -x "open-design"
```

Fallback can scan `/proc/*/comm` if `pgrep` missing.

Windows implementation:

PowerShell:

```powershell
Get-Process -Name "OpenDesign" -ErrorAction SilentlyContinue
```

or Rust/sysinfo later. Keep phase-1 simple.

## Frontend implementation notes

Types:

```ts
export interface StoreAppRuntimeResult {
  id: string;
  running: boolean;
  status: 'running' | 'not_running' | 'not_installed' | 'unsupported' | 'error' | string;
  detail?: string | null;
}

export interface StoreAppRuntimeResponse {
  results: StoreAppRuntimeResult[];
}
```

Dock state:

```ts
const [openingDesktopApps, setOpeningDesktopApps] = useState<Set<string>>(new Set());
const [runningDesktopApps, setRunningDesktopApps] = useState<Set<string>>(new Set());
```

Open flow:

1. If internal app: existing behavior unchanged.
2. If desktop catalog app:
   - add to `openingDesktopApps`
   - call `postAppOpen(appId)`
   - trigger bounce on success
   - poll runtime immediately
   - clear opening on running, error, or timeout

Polling:

- Visible desktop ids = pinned/open Dock app ids with `desktopAppById.has(id)`.
- Poll every 5s by default.
- Poll every 2s if any `openingDesktopApps` exists.
- Poll on focus/visibilitychange.

Visual:

- Active dot condition: `item?.isOpen || runningDesktopApps.has(appId)`.
- Focus dot color remains internal only unless future platform focus detection exists.
- Opening indicator condition: `openingDesktopApps.has(appId) && !runningDesktopApps.has(appId)`.

## No-go decisions

- No Accessibility API requirement for macOS focus detection.
- No native OS window focus integration in this sprint.
- No persisted fake `isOpen` for desktop processes.
- No App Store install changes.
