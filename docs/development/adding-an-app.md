# Adding an App

End-to-end: from "I want a Pomodoro timer in TytusOS" to a fully wired, dock-pinnable, launcher-discoverable app.

## 1. Create the component

`app/src/apps/Pomodoro.tsx`:

```tsx
import { memo, useState } from 'react';

const Pomodoro = memo(function Pomodoro() {
  const [seconds, setSeconds] = useState(25 * 60);
  // ... your app logic

  return (
    <div className="w-full h-full p-6 flex flex-col items-center justify-center"
      style={{ background: 'var(--bg-window)', color: 'var(--text-primary)' }}>
      <h2 className="text-2xl font-semibold">Pomodoro</h2>
      <div className="text-5xl font-mono mt-4">
        {String(Math.floor(seconds / 60)).padStart(2, '0')}:
        {String(seconds % 60).padStart(2, '0')}
      </div>
    </div>
  );
});

export default Pomodoro;
```

**Conventions:**
- Default-export a `memo()`'d component
- Take no props (apps are self-contained — they read their own localStorage if they need state)
- Fill `100% / 100%` width and height (the parent `WindowFrame` controls actual sizing)
- Use `var(--bg-window)` and `var(--text-primary)` (theme-aware)
- Never render your own scrollbars unless content actually overflows

## 2. Register it

`app/src/apps/registry.ts`:

```ts
{
  id: 'pomodoro',
  name: 'Pomodoro',
  icon: 'Timer',                        // any lucide-react icon
  category: 'Productivity',
  description: '25/5 work-rest timer.',
  defaultSize: { width: 360, height: 480 },
  minSize:     { width: 280, height: 400 },
},
```

Pick an `id` — it's the URL/state slug. Use lowercase, no spaces, no special chars. Once shipped, **don't change it** (existing user state would orphan).

## 3. Dispatch it

`app/src/apps/AppRouter.tsx`:

```tsx
import Pomodoro from './Pomodoro';

// inside the switch:
case 'pomodoro': return <Pomodoro />;
```

That's it. The launcher, dock (if pinned), and Alt+Tab will all discover it on next render.

## 4. (Optional) Pin to dock

`app/src/apps/registry.ts`:

```ts
export const getDefaultDockApps = (): string[] => [
  'pod-inspector',
  'settings',
  'chat',
  'filemanager',
  'channels',
  'terminal',
  'pomodoro',          // add here
];
```

Or leave it unpinned — it'll still appear when launched.

## 5. (Optional) Persist state

If your app needs persistence:

```tsx
const [tasks, setTasks] = useState(() => {
  try {
    const raw = localStorage.getItem('tytus_pomodoro_history');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
});

useEffect(() => {
  localStorage.setItem('tytus_pomodoro_history', JSON.stringify(tasks));
}, [tasks]);
```

**Always prefix with `tytus_`** so users can clear app data without clobbering anything else.

## 6. (Optional) Send notifications

```tsx
import { useNotifications } from '@/hooks/useOSStore';

const { addNotification } = useNotifications();
// when timer fires:
addNotification({
  appId: 'pomodoro',
  appName: 'Pomodoro',
  appIcon: 'Timer',
  title: 'Break time',
  message: 'Step away for 5 minutes.',
});
```

The toast appears top-right and auto-dismisses after 5 s. Notifications also accumulate in the Notification Center (clock click on the top panel).

## 7. (Optional) Hook a keyboard shortcut

Global shortcuts live in `App.tsx`. Add yours there:

```tsx
// inside the keydown handler in App.tsx
if (e.ctrlKey && e.altKey && e.key === 'p') {
  e.preventDefault();
  dispatch({ type: 'OPEN_WINDOW', appId: 'pomodoro' });
  return;
}
```

Document it in [user-manual/keyboard-shortcuts.md](../user-manual/keyboard-shortcuts.md).

## 8. (Optional) Verify with smoke

The app sweep (`npm run test:smoke`) won't auto-cover your specific app interactions. To add coverage, extend `app/scripts/smoke.mjs`:

```js
console.log('15. open Pomodoro and verify timer renders');
await page.click('button[aria-label="Show applications"]');
await page.fill('input[placeholder*="search applications"]', 'Pomodoro');
await page.locator('div[style*="auto-fill"] > button').first().click();
await page.waitForSelector('div[data-app-id="pomodoro"]', { timeout: 5000 });
const text = await page.textContent('div[data-app-id="pomodoro"]');
if (!text.match(/\d+:\d+/)) throw new Error('Timer not rendered');
console.log('   ✓ Pomodoro timer renders');
```

The 52-app sweep (`npm run sweep`) will pick up your app automatically — it discovers from the launcher grid.

## 9. Document it

Add a one-liner to [apps-catalog.md](../user-manual/apps-catalog.md) under the right category.

## 10. Commit

```bash
git add app/src/apps/Pomodoro.tsx app/src/apps/registry.ts app/src/apps/AppRouter.tsx \
        docs/user-manual/apps-catalog.md
git commit -m "Add: Pomodoro app

A 25/5 work-rest timer in the Productivity category. Persists history
to tytus_pomodoro_history. Sends a notification when the timer fires.
"
```

## Things to avoid

- **Don't import the OS store from inside the app body** unless you really need to dispatch global actions (e.g., to open another window). Apps should be largely self-contained.
- **Don't render absolute-positioned modals at the document root.** Use shadcn `<Dialog>` from `components/ui/dialog.tsx` — it portal-renders correctly and respects window stacking.
- **Don't request permissions on mount.** The browser will deny if the user hasn't interacted yet. Wait for an explicit click.
- **Don't poll at high frequency.** Use `requestAnimationFrame` for animations, not `setInterval(... 16)`.

## A cheat sheet

```
1. Component  →  app/src/apps/<Name>.tsx
2. Registry   →  app/src/apps/registry.ts
3. Router     →  app/src/apps/AppRouter.tsx
4. (Pin)      →  registry.ts → getDefaultDockApps()
5. (Persist)  →  localStorage.setItem('tytus_<key>', ...)
6. (Notify)   →  useNotifications().addNotification({...})
7. (Shortcut) →  App.tsx keydown handler
8. (Test)     →  scripts/smoke.mjs
9. (Docs)     →  docs/user-manual/apps-catalog.md
10. Commit
```
