# Troubleshooting

## TytusOS says Session expired but the tray says Connected

This means the local daemon is running and pods may still be online, but the browser view has stale auth state.

Fix:

1. Open **Settings -> Daemon**.
2. Click **Sign in again**.
3. Approve the one-time browser login.
4. Click **Check session** or reload TytusOS if the status does not refresh.

Pods are not deleted by this flow.

## Pod shows Not ready but the URL opens

Readiness is stricter than “the browser URL returns something”. TytusOS checks allocation, API health, UI route, shared-storage helper, and smoke/bootstrap status.

If the pod UI opens but status is Not ready:

- Open Pod Inspector -> pod detail.
- Check which readiness row failed.
- Use **Doctor**, **Logs**, **Refresh creds**, or **Restart**.
- If only shared storage is degraded, core chat/API may still work.

## Music Creator or browser fetch gets CORS errors for `/v1/models`

Browser apps should use the Tytus local proxy or included gateway path exposed by the daemon. Direct browser calls to pod public URLs can fail CORS preflight.

Fix for contributors: route browser-side gateway probes through the daemon or same-origin proxy, not directly to `https://pod.tytus.traylinx.com/v1/models`.

## Files shows raw `tytus ls: no such path`

That is a UI bug unless the user explicitly opened a diagnostic log. Missing `Inbox` or `Downloads` should show a friendly empty state with a create/refresh action.

## Terminal output duplicates or breaks after resizing

The terminal must notify the PTY backend of row/column changes and clear/reflow correctly. If output duplicates after resize, test with `stty size`, resize again, and inspect terminal resize events.

## Copy/paste shortcuts do not work in Terminal

Browser shortcuts differ by OS. The terminal should support:

- macOS: Cmd+C/Cmd+V for copy/paste when text selection is active; Ctrl+C goes to the shell process.
- Windows/Linux: Ctrl+Shift+C/Ctrl+Shift+V for terminal copy/paste; Ctrl+C interrupts the shell process.

If this regresses, compare against Ghostty behavior and ensure the terminal app handles platform-specific modifier keys.


## Atomek editor is blank or files are not editable

A blank editor with a normal text file usually means an old Atomek bundle is cached or the file type did not get a text model.

Fix:

1. Hard-refresh TytusOS.
2. Reopen Atomek.
3. Reopen the file from Explorer.
4. Confirm Atomek loads `tytus-app-atomek@v0.4.22` or newer.
5. If still broken, include the file extension and browser console error in the bug report.

## Atomek folder rows do not expand or collapse

Use the folder chevron or click the folder row. If nothing changes, you are likely on an old bundle. Hard-refresh TytusOS and reopen the folder.

## Atomek shows duplicate Agent Team and stale App Skills icons

That was an old app bundle. The current surface has one **Agent Team** activity. Hard-refresh TytusOS and confirm the app comes from `tytus-app-atomek@v0.4.22` or newer.

## Atomek local tools are missing

Open **Atomek -> Agent Team** and click **Refresh capabilities**. If a tool is still missing, install the local CLI first, then refresh again. Atomek only launches allowlisted tools discovered through the host bridge.

## Atomek model list shows an obsolete model

AIL model selection is global. Fix the global AIL configuration or selected route. Do not hardcode a replacement model in Atomek or TytusOS app code.

## `garagetytus-shared` missing inside a pod

Core chat/API may work, but shared S3 bucket access will be degraded.

Fix path:

- Rebuild/restart the pod with the current Tytus agent image.
- Verify the helper exists in the container.
- Re-run Pod Inspector readiness.

## `ail-speech` returns 429

This is provider quota/rate limiting. It is not fixed by restarting TytusOS. Use another model/provider if available or wait for quota recovery.

## Vision works with image URLs but not inline base64

Use public URLs or upload the image first. Inline `data:image/...;base64` may be rejected by the upstream multimodal endpoint.

## Theme looks wrong in dark mode

Hard-coded black icons/text cause this. Capture the screen, identify the component, and replace hard-coded colors with theme tokens.

## Reset local browser state

Only do this when instructed; it resets UI preferences, not your server account:

```js
localStorage.clear()
location.reload()
```

## Support checklist

When reporting a bug, include:

- TytusOS version and daemon version from Settings -> About
- Daemon state from Settings -> Daemon
- Pod Inspector readiness rows
- Browser console error
- Exact route/hash URL
- Whether legacy Tower shows different state

## Shared folder or mission handoff is confusing

Use **Help -> Shared Folders** for the full exchange model. Short version: put raw incoming context in `INBOX.md`, keep transcripts in `runs/`, put generated artifacts in `outputs/`, put proposed edits in `proposals/`, and only move final approved material to `OUTBOX.md`.

## OpenClaw or Hermes does not appear in Atomek

Open **Pod Inspector** first and confirm the agent is allocated and ready. Then return to **Atomek -> Agent Team** and refresh capabilities. Atomek shows real resources only; missing agents are setup work, not UI failure.
