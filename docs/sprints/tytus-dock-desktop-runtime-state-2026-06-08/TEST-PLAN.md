# Test Plan: Dock Desktop Runtime State

## Static checks

- `npm run build --workspace app`
- `npm run i18n:check --workspace app`
- Relevant Vitest:
  - daemon client shape guard tests
  - Dock render behavior if existing test harness supports it
- Rust tests for `web_server.rs` runtime helper functions.

## Backend tests

1. Runtime candidate extraction:
   - app with explicit runtime metadata.
   - app without runtime metadata uses launch target fallback.
   - terminal launch command falls back to command basename.
2. Invalid ID rejected.
3. Unknown app returns 404/error shape consistent with existing endpoints.
4. Uninstalled app returns `running=false` / `not_installed`.
5. Supported installed app with no process returns `not_running`.

## Manual macOS test — Sebastian machine

Prereq: Open Design installed and closed.

1. Pin Open Design in Dock.
2. Click Open Design Dock icon.
3. Expected immediately: opening indicator visible.
4. Expected after native app starts: active dot visible.
5. Quit Open Design.
6. Expected within polling interval: active dot disappears.
7. Reopen from App Store card.
8. Expected: Dock state also updates, not only Dock click path.

## Cross-platform verification targets

### macOS

- Process detector: `pgrep -x` exact process name.
- Test with Open Design or Discord.

### Linux

- Process detector: `pgrep -x`; fallback `/proc/*/comm` if needed.
- Test with a Linux app available in catalog, e.g. Ghostty/Discord where installed.

### Windows

- Process detector: PowerShell `Get-Process`.
- Test with Discord/Open Design when installed.

## Regression checks

- Internal app Dock dots still work: Settings/Files/Atomek.
- Dock auto-hide still clickable.
- Dock App Store real logos still render.
- App Store install/open buttons unchanged.
- `Open all installed` unchanged.
