# Testing

Tytus OS has two automated test passes today, both Playwright-based:

| Script | What it does | When to run |
|---|---|---|
| `npm run test:smoke` | 14-step interaction smoke (drag, resize, dock stickiness, launcher) | Every commit that touches `components/`, `hooks/`, or `apps/` |
| `node scripts/sweep.mjs` | Opens all 52 apps, captures runtime errors per app | Before tagging a release, or after big refactors |

Both require a running dev server (`npm run dev` on `$TYTUS_BASE`).

## Running the smoke

```bash
# Terminal 1
npm run dev                   # http://localhost:4242

# Terminal 2
TYTUS_BASE=http://localhost:4242 node scripts/smoke.mjs
```

Or `npm run test:smoke` if Playwright is installed locally (it isn't a dep yet — install separately with `npm install --save-dev playwright`).

## What the smoke covers

```
1. boot → login screen visible
2. click "Log in as Guest" → desktop visible
3. open Pod Inspector via desktop dbl-click
4. drag title bar 220×90 → window moved
5. resize SE corner +120×+100 → window grew
6. click X → window closed
7. open Chat → close → open Files (dock-stickiness regression)
   → assert Chat dock icon Y didn't drift
   → assert Chat dot disappeared, Files dot appeared
8. minimize Files → window hidden
9. click Files in dock → restored
10. maximize → window 1440×824
11. close
12. open launcher → Esc closes it
13. open Settings, Calculator, Notes via launcher search
14. assert zero console errors throughout
```

Each check is fast (< 0.5 s); the whole pass is ~10 s.

## What the sweep covers

`scripts/sweep.mjs` iterates through every app discovered in the launcher grid. For each app it:

1. Opens the launcher
2. Searches for the app by name
3. Clicks the first matching card
4. Waits for `[data-app-id="..."]` to appear
5. Captures any `pageerror` or `console.error` events
6. Closes the window
7. Reports pass / fail per app

End-state: pass count, fail count, errors per failed app.

```
$ TYTUS_BASE=http://localhost:4242 node scripts/sweep.mjs
navigate http://localhost:4242
discovered 52 apps in launcher
  Pod Inspector          ✓ (pod-inspector)
  Channels               ✓ (channels)
  Help                   ✓ (help)
  System Settings        ✓ (settings)
  ...
summary: 52 pass · 0 fail · 52 total
```

The sweep is skeleton-level — it doesn't test app-specific behavior, only that opening and closing each one doesn't crash.

## Stable selectors

Window frames carry `data-app-id`, `data-window-id`, and `data-window-title`. Always select windows by these attributes, never by content text:

```js
// ✅ stable
await page.waitForSelector('div[data-app-id="settings"]');

// ❌ breaks when content changes
await page.waitForSelector('h2:has-text("System Settings")');
```

Window controls have `aria-label`s:

```js
await page.click('button[aria-label="Close"]');
await page.click('button[aria-label="Minimize"]');
await page.click('button[aria-label="Maximize"]');
await page.click('button[aria-label="Show applications"]');
await page.click('button[title="Pod Inspector"]');     // dock buttons
```

## Adding a smoke step

Append to `scripts/smoke.mjs` before the "ALL CHECKS PASS" line. Pattern:

```js
console.log('NN. brief description');
await page./* set up */;
const before = await page./* measure */;
await page./* perform action */;
await page.waitForTimeout(300);
const after = await page./* measure */;
if (/* condition fails */) throw new Error('REGRESSION: ...');
console.log('   ✓ asserted');
```

Each step:
- Logs its number + intent
- Performs one action
- Asserts one thing (and throws if it fails)
- Logs a ✓

## Manual testing

For UI you can't easily script (visual polish, animation feel, font rendering):

1. `npm run dev`
2. Open in real browsers: Chrome, Safari, Firefox
3. Walk the smoke flow manually
4. Resize the window to mobile width — note: Tytus OS is desktop-only by design, mobile is unsupported

## Future testing layers

- **Unit tests for the reducer** — `osReducer(state, action)` is pure; testable with vitest in 50 lines. Not done yet but should be.
- **Storybook** for shadcn primitives — useful when we customize them.
- **Visual regression** (Percy / Chromatic) — only worth it once design is more stable.
- **CI** (GitHub Actions) — once the test scripts are reliable, gate PRs on them.
