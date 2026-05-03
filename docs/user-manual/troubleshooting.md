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
