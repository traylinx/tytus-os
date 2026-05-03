# Host Clipboard — Per-Browser Behaviour

TytusOS's **Cmd+V on the Desktop** (Sprint B Phase 5.4) reads from the
host browser's clipboard. The browser's `navigator.clipboard` API isn't
uniform across vendors — this doc maps what works where and how Tytus
degrades when something doesn't.

## Quick answer

| Browser | Image paste | Text paste | Permission UX |
|---|---|---|---|
| **Chromium / Chrome / Edge** | ✅ via `navigator.clipboard.read()` | ✅ | One-time prompt, cached per origin. |
| **Safari 17+** | ⚠️ per-call permission, may prompt every paste | ✅ | Permission per call; sometimes denied silently. |
| **Safari < 17** | ❌ `read()` unavailable | ✅ via `readText()` | Text-only fallback. |
| **Firefox** | ❌ `read()` unavailable | ✅ via `readText()` | Text-only fallback; may also prompt per call. |
| **Tytus bundled WebView** (tytus-cli) | ✅ — Chromium-based | ✅ | Pre-granted in the bundled profile. |

## How Tytus reads the clipboard

`app/src/lib/hostClipboard.ts` `readClipboard()`:

1. Probe `navigator.clipboard.read` — present on Chromium / recent Edge /
   recent Safari. If yes:
   - Iterate items; **prefer image/* over text/plain** (most users paste
     an image expecting an image, not a hex blob).
   - On any clipboard `image/png|jpeg|gif|webp`, return an `image` payload
     with a generated filename `pasted-YYYYMMDD-HHMMSS.<ext>`.
   - Else look for `text/plain` and return it.
2. Fall back to `navigator.clipboard.readText()` — Firefox + older Safari.
   Always returns a `text` payload or empty.
3. If neither is exposed, return `unavailable` so Tytus can show
   "Clipboard unavailable" in a toast.

## Permission states

Tytus caches the permission decision in `state.clipboardPermission`:
`'granted' | 'denied' | 'prompt'`. On every Cmd+V:

- **'granted'** → call `read()` directly; if the call returns successfully,
  cache stays `granted`.
- **'denied'** → still attempt the read (browser may have re-granted via
  site settings). On `NotAllowedError`, show one toast — no loop.
- **'prompt'** → the browser surfaces its native dialog. The result
  updates the cache immediately.

**Permission recovery**: a successful read always upgrades the cache to
`'granted'`, even if it was `'denied'` before. So a user who reset their
browser permission via the site-info menu doesn't have to also reset
inside Tytus.

## Manually resetting

If Tytus's cache says `'denied'` but you've granted permission at the
browser level:

1. Open **Settings → Privacy → Reset clipboard permission**.
2. The "Will ask" status appears.
3. Press **Cmd+V** again — Tytus re-attempts and the browser will show
   its current verdict.

## Browser-specific quirks

### Chromium / Chrome / Edge

- The first Cmd+V triggers the browser's clipboard prompt.
- After grant, the `read()` call works for image AND text.
- Permission survives reload via the site setting.
- **Bundled tytus-cli WebView** ships with the permission pre-granted in
  its Chromium profile.

### Safari 17+

- `navigator.clipboard.read()` exists but is permissioned **per call** —
  Safari may prompt every paste depending on user setting.
- Sometimes denies silently if not invoked in a clear user-gesture
  context. Tytus binds Cmd+V directly to the keypress (no async
  trampoline) so Safari sees the gesture.

### Safari < 17

- `read()` doesn't exist; only `readText()` works.
- Image paste returns "unavailable" → toast suggests upgrading.

### Firefox

- `read()` is not implemented as of Firefox 124.
- `readText()` works but may prompt per call.
- The `permissions.query({name: 'clipboard-read'})` call rejects
  ("clipboard-read unknown") — Tytus falls back to `'prompt'` and
  attempts the read at gesture time.

## Settings the user can change

| Setting | Where | Effect |
|---|---|---|
| Clipboard permission | Settings → Privacy | Reset cached permission to `'prompt'` |
| Notifications | Settings → Notifications | Mute the post-paste confirmation toast / chime |

## Internals

- `app/src/lib/hostClipboard.ts` — the wrapper + browser detect.
- `app/src/App.tsx` — Cmd+V handler registered via the shortcut router
  at active-app scope.
- 17 unit tests in `lib/hostClipboard.test.ts` cover all permission paths.
- The internal Tytus clipboard (Cmd+C inside the OS) is separate —
  `app/src/lib/clipboard.tsx`. It never touches `navigator.clipboard`.
