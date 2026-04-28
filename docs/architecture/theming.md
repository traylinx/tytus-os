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
