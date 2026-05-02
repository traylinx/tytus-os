# Troubleshooting

Common issues and how to fix them.

## Boot screen never finishes

**Symptom:** the Tytus OS logo + progress bar stays forever.

**Cause:** JavaScript error during boot (rare). The boot phase machine is `off → logo → loading → transition → desktop`; an early error stalls it.

**Fix:**
1. Open browser DevTools → Console. Look for red errors.
2. Reload the page (**Ctrl+R** / **⌘+R**).
3. If it persists: `localStorage.clear()` in the console + reload.
4. If still broken: file an issue with the console output.

## My desktop layout is gone after refresh

Layout persists in `localStorage` under `tytus_desktop_icons`. It resets if:
- You cleared site data
- You're in incognito / private browsing
- A different browser profile

To export your layout: copy the JSON from the `tytus_desktop_icons` key in DevTools → Application → Local Storage.

## A window won't close

**Symptom:** the **×** button doesn't dismiss the window.

**Causes:**
- Modal `<dialog>` open inside the app — close that first
- The app is mid-drag — release the mouse first

**Fix:** Press **Ctrl+W** while the window is focused, or **⌘+D** to minimize all and reopen.

## Can't drag a window

**Symptom:** mouse-down on the title bar does nothing.

**Cause:** another window is on top of yours — its hit zone is intercepting the click. The window you see may not be the one with the highest Z-index.

**Fix:** click anywhere on the body of your window first to focus it, then drag.

## App icon stays "raised" in the dock after closing

**Already fixed** in commit `378ae8d`. If you see this on a deployed build, hard-reload to fetch the latest assets.

## Cmd+V does nothing on the Desktop

**Symptom:** copying an image in macOS Preview, then Cmd+V on the Desktop, doesn't paste anything.

**Cause:** the host browser denied clipboard access, or the API isn't available.

**Fix:**
1. Look for a "Clipboard access denied" notification toast.
2. **Settings → Privacy → Reset clipboard permission**, then Cmd+V again — Tytus will re-prompt.
3. If your browser doesn't expose `navigator.clipboard.read()` (Firefox), only **text** is supported. Use Chrome / Edge / Safari for image paste.
4. Permission was probably granted but the cache is stale: the **Reset** button forces a fresh prompt on the next paste.

## Drag a file out to Finder doesn't download

**Symptom:** dragging a file from the Files window onto Finder leaves no file behind.

**Cause:** the host browser doesn't honour the `DownloadURL` drag MIME (Firefox, Safari prior to 17).

**Fix:** use Chromium / Chrome / Edge / Tytus's bundled WebView. Or right-click the row → Download.

## Window animations look glitchy / jumpy

**Symptom:** open / close / snap transitions stutter on a slow machine.

**Fix:** **Settings → Appearance → Reduce motion** turns off the CSS animations live. Tytus also auto-respects the OS-level "Reduce motion" preference, so toggling that in macOS System Settings has the same effect.

## Notification chime doesn't play

**Symptom:** a notification appears but no sound.

**Cause:** browser autoplay policy blocks audio until the user has interacted with the page.

**Fix:**
1. Click anywhere in the OS once after page load — that registers a user-gesture and unblocks audio.
2. Confirm **Settings → Notifications → System sounds** is on.
3. Confirm OS volume isn't muted.

## A window snapped and won't unsnap

**Symptom:** a window stuck in left-half / right-half mode.

**Fix:** drag its title bar more than ~24 px away from the snap target — Tytus restores the previous floating frame at the cursor. Or double-click the title bar to maximize then double-click again to fully restore.

## Settings don't persist

Settings (theme, accent color, etc.) save to `localStorage` under `tytus_settings`. They survive reload but reset if:
- Browser is in private mode
- Site storage is cleared
- localStorage quota is exceeded (very rare — Tytus uses < 1 MB)

## API Tester says CORS error

The browser blocks cross-origin requests by default. API Tester is a real `fetch()` and is subject to standard CORS rules.

**Fix:**
- Test against APIs that send `Access-Control-Allow-Origin: *`
- Or run a local proxy
- Or enable CORS in your dev server

## Voice / Screen Recorder asks for permission

The browser requires explicit microphone / screen permission. Click **Allow** when prompted. If you said deny, reset the site permission in browser settings.

## Games don't respond to keys

Click into the game window first to focus it. Keyboard events go to the focused window. Some games (Tetris, Snake, Pong) require window focus to receive arrow keys.

## Boot logo says something other than "Tytus OS"

You're on a stale build. HMR usually picks up branding edits, but a hard reload (**⌘+Shift+R** / **Ctrl+Shift+F5**) forces a re-fetch.

## I see a `Maximum update depth exceeded` console error

**Already fixed** in commit `3e81059`. If you still see this, you're on an old build — pull latest + rebuild.

## How do I reset everything?

In DevTools console:

```js
localStorage.clear();
location.reload();
```

This wipes desktop icons, notes, todos, calendar, settings, recordings, all of it. The boot animation will run again.

## Where does Tytus OS store data?

Everything is in your browser's `localStorage`, keyed under `tytus_*`:

| Key | What |
|---|---|
| `tytus_desktop_icons` | Icon positions on the desktop |
| `tytus_settings` | Theme, accent color, panel preferences |
| `tytus_notes` | Notes |
| `tytus_note_folders` | Notes folder structure |
| `tytus_todos` | Tasks |
| `tytus_todo_projects` | Custom Todo projects |
| `tytus_calendar_events` | Calendar events |
| `tytus_chat` | Chat history |
| `tytus_browser_bookmarks` | Browser bookmarks |
| `tytus_filesystem` | Virtual file tree |
| `tytus_archives` | Archive Manager state |
| `tytus_passwords` | (none — PasswordManager was dropped) |
| `tytus_contacts` | (none — Contacts was dropped) |
| ... | (more per app) |

Nothing leaves your machine — Tytus OS does not phone home. The only network requests are:
- Vite dev server (during development)
- Google Fonts CDN (Inter + JetBrains Mono webfonts)
- Whatever you explicitly send via API Tester or Browser

## Reporting bugs

Open an issue at <https://github.com/traylinx/tytus-os/issues> with:
- Browser + version
- Steps to reproduce
- Console output (red errors)
- Screenshot if visual
