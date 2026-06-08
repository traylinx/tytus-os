# Readiness Gate

Status: **IMPLEMENTED**

## Scope lock

Only touch these areas unless a direct compile/test failure requires more:

- `services/tytus-cli/tray/src/web_server.rs`
- `services/tytus-cli/tray/web/assets/apps.json`
- `services/tytus-os/app/src/lib/daemon.ts`
- `services/tytus-os/app/src/types/daemon.ts` or equivalent daemon types
- `services/tytus-os/app/src/components/Dock.tsx`
- Tests adjacent to these files
- i18n locale files only if new user-visible copy is introduced

Do **not** touch:

- App Store install flow
- SwitchAI Local endpoints
- Atomek mission code
- Provider/Scalesys/DAM
- Desktop app packaging scripts

## Pre-implementation checklist

- [x] Existing Dock behavior inspected.
- [x] Existing desktop App Store open endpoint inspected.
- [x] Existing missing active-dot root cause identified.
- [x] Backend endpoint shape proposed.
- [x] Cross-platform detection plan proposed.
- [x] Test matrix written.
- [x] User approves implementation.
- [x] Implementation completed.
- [x] Focused validation passed.

## Abort conditions

Abort and ask before continuing if implementation requires:

- OS accessibility permissions.
- New native dependencies.
- Changing App Store install behavior.
- Persisting desktop runtime into `dockItems`.
- Broad refactor outside listed files.
