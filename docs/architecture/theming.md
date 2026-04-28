# Theming

TytusOS supports dark and light modes plus 8 accent colors. The implementation is pure CSS — no theme-provider, no JS recomputation.

## How it works

Two layers:

1. **CSS custom properties** in `app/src/index.css` that define every design token (background, text, border, accent, shadow, etc.).
2. **A `.light` class** on the root `<div>` in `App.tsx` that overrides those tokens for light mode.

```css
/* index.css */
:root {
  --bg-desktop: #1a1a1a;
  --bg-window: #1f1f1f;
  --bg-panel: rgba(45, 45, 45, 0.85);
  --text-primary: #e0e0e0;
  --text-secondary: #9e9e9e;
  --accent-primary: #7c4dff;
  /* ... */
}

.light {
  --bg-desktop: #f5f5f5;
  --bg-window: #ffffff;
  --bg-panel: rgba(245, 245, 245, 0.85);
  --text-primary: #212121;
  /* ... */
}
```

`App.tsx`:

```tsx
<div className={state.theme.mode === 'light' ? 'light' : ''} style={{ width: '100vw', height: '100vh' }}>
```

Toggling `state.theme.mode` flips the class. Every `var(--*)` reference re-evaluates instantly. No re-render needed.

## The `cn()` helper

`app/src/lib/utils.ts`:

```ts
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...args) => twMerge(clsx(args));
```

Use this for conditional classes — it deduplicates Tailwind classes correctly:

```tsx
<button className={cn('px-3 py-1.5 rounded', isActive && 'bg-purple-500 text-white')}>
```

## Accent colors

Eight presets in `Settings.tsx`:

| Name | Hex |
|---|---|
| Purple (default) | `#7C4DFF` |
| Blue | `#2196F3` |
| Teal | `#009688` |
| Green | `#4CAF50` |
| Yellow | `#FBC02D` |
| Orange | `#FF9800` |
| Red | `#F44336` |
| Pink | `#E91E63` |

Switching accent updates `state.theme.accent`, which Settings then writes to `--accent-primary` via inline style on document root. Components using `var(--accent-primary)` (focus rings, dock dots, primary buttons, the boot logo) update automatically.

## Wallpaper

Default: `/public/wallpaper-default.jpg`.

Stored in `state.theme.wallpaper`. Settings → Background panel offers a few preset images and an upload field (TODO: drag-and-drop).

The wallpaper is rendered as a fixed-position layer at z-index 0 in `App.tsx`, behind every other layer.

## Inline styles vs Tailwind

Rule of thumb:

- **Tailwind classes** for static styles — padding, sizing, layout. These have IDE autocomplete and stay in the design system.
- **Inline `style={{}}`** for dynamic values — colors from theme tokens, sizes from state, animations driven by props.

Don't mix the two for the same property:

```tsx
// ❌ confusing
<div className="bg-red-500" style={{ background: 'blue' }} />

// ✅ clear
<div style={{ background: isError ? '#F44336' : 'var(--accent-primary)' }} />
```

## Animations

Defined inline as `<style>` blocks within the component that uses them — keeps animation rules close to their consumers and avoids global pollution. Examples in `BootSequence.tsx`, `LoginScreen.tsx`, `Dock.tsx`.

For shared animations (fade-in, slide-up), they live in `index.css`.

## Fonts

Two fonts loaded from Google Fonts at the top of `index.css`:

- **Inter** (300, 400, 500, 600, 700, 800) — UI
- **JetBrains Mono** (400, 500, 600) — code, terminal

The `@import url(...)` is the only outbound network request the app makes by default. (Self-hosting these is a Phase 6 polish for offline-friendliness.)

## Adding a new theme variable

1. Add `--my-token: value;` to `:root` in `index.css`.
2. Add an override under `.light` if it should differ in light mode.
3. Use it as `var(--my-token)` in any component's inline style or Tailwind arbitrary value (`bg-[var(--my-token)]`).
4. Don't forget to update Settings → Appearance if you want it user-controllable.

## Border-radius scale

Use the radius tokens consistently — the visual hierarchy depends on it.

| Token | Value | Use for |
|---|---|---|
| `--radius-sm` / `rounded-sm` | 4px | tight chips, in-menu items, inline tags, micro-buttons |
| `--radius-md` / `rounded-md` | 8px | buttons, input fields, dropdowns, tooltips |
| `--radius-lg` / `rounded-lg` | 12px | window frames, notification toasts, larger cards |
| `--radius-xl` / `rounded-xl` | 16px | dialogs, app launcher cards, dock, login card |
| `--radius-full` / `rounded-full` | pill | avatars, dot indicators, search bars, badges |

Concrete anchors in the shell:

- TopPanel buttons → `rounded-md` (8px), `h-6` (24px) — the panel itself is 28px so 24px buttons leave 2px breathing room above and below the hover background.
- Window frame → 12px (corners only — bottom is square because it sits inside the body).
- Dock → 16px (all corners). Lifted 6px from the bottom edge so the frame floats and the active-app dot inside the dock is never clipped against the viewport.
- App launcher cards → `rounded-2xl` (16px) — visually distinct grid tiles.
- Login card → `rounded-2xl` (16px).
- Context menu items → 4px inside an 8px container.
- Notification toasts → 12px.

If you find yourself reaching for a radius outside this scale, ask why first.

## Spacing anchors

A few magic constants are coupled across the shell — change one and you must change all of them. They live in code:

| Constant | Source | Used by |
|---|---|---|
| `TOP_PANEL_HEIGHT = 28` | `WindowFrame.tsx` | maximized window top + drag-clamp + Desktop top inset |
| Dock `bottom = 6`, `height = 56` | `Dock.tsx` | maximized window height calc + Desktop bottom inset |
| Reserved bottom = 68 | `WindowFrame.tsx`, `Desktop.tsx` | `bottom - 68` keeps content above the lifted dock |

The maximized window is sized as `calc(100vh - 28px - 68px)` so it never runs under the dock.
