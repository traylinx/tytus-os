# Windowing

The window manager is the single most important part of TytusOS. If windows don't behave like windows, nothing else matters.

## Two pieces

- **`WindowManager`** (`app/src/components/WindowManager.tsx`) — renders every visible window. Tiny: just a `.map()` over `state.windows.filter((w) => w.state !== 'minimized')`.
- **`WindowFrame`** (`app/src/components/WindowFrame.tsx`) — the chrome around each app. Title bar, body, drag, resize, controls.

## The frame

```tsx
<div data-app-id={win.appId} data-window-id={win.id} data-window-title={win.title}
  className="absolute flex flex-col select-none"
  style={{ left, top, width, height, zIndex }}
  onMouseDown={focusOnClick}
>
  <TitleBar />
  <Body><AppRouter appId={win.appId} /></Body>
  {!isMaximized && <ResizeHandles />}
</div>
```

The data-attributes are critical — both for tests (selector stability) and for future debugging (you can pick a window from DevTools by ID).

## Drag

Title bar `onMouseDown` captures the start coordinates. A global `mousemove` listener (on `window`) updates `state.windows[id].position` via `MOVE_WINDOW` until `mouseup`.

```tsx
const handleTitleMouseDown = (e) => {
  if (isMaximized) return;
  if (e.target.closest('button')) return;  // ignore clicks on min/max/close
  dragRef.current = { startX: e.clientX, ..., origX: win.position.x, ... };
  setIsDragging(true);
};
```

The `target.closest('button')` guard is what allows you to drag by clicking the icon or title text but not by clicking the window controls.

## Resize

8 small invisible divs along the edges and corners. Each has its own cursor and own `onMouseDown` that records which edge was grabbed:

```tsx
{showHandles && (
  <>
    <div onMouseDown={startResize('n')} style={{ position:'absolute', top:0, left:CORNER, right:CORNER, height:HANDLE, cursor:'n-resize', zIndex:50 }} />
    <div onMouseDown={startResize('s')} ... />
    <div onMouseDown={startResize('w')} ... />
    <div onMouseDown={startResize('e')} ... />
    <div onMouseDown={startResize('nw')} ... cursor:'nw-resize', zIndex:51 ... />
    {/* ne, sw, se */}
  </>
)}
```

**Important:** these are *separate* divs with their own footprints. Earlier versions used a single `absolute inset-0 z-50` wrapper that covered the entire window — which caught every click intended for the title bar. The fix (commit `3e81059`) made each handle a small standalone element.

The global `mousemove` then computes `dx`, `dy` and dispatches `RESIZE_WINDOW` (and `MOVE_WINDOW` for north/west edges since those resize-from-the-other-side).

## Min size

`MIN_W = 320`, `MIN_H = 200`. Enforced in the resize handler — you can't drag below these.

## Max position bounds

- Top: respects the 28 px top panel
- Side: at least 100 px must remain on-screen (you can't drag a window fully off the right edge)

## Focus and Z-index

Click anywhere in a window to dispatch `FOCUS_WINDOW`. The reducer:

```ts
case 'FOCUS_WINDOW': {
  const nextZ = state.nextZIndex + 1;
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === action.windowId ? { ...w, isFocused: true, zIndex: nextZ } : { ...w, isFocused: false }
    ),
    activeWindowId: action.windowId,
    nextZIndex: nextZ,
    dockItems: ..., // also update dock focus indicator
  };
}
```

Each focus increments `nextZIndex`, so the most-recently-focused window is always on top.

## Title bar buttons

Three: **Minimize**, **Maximize/Restore**, **Close**.

```tsx
<button onClick={handleMinimize} onMouseDown={(e) => e.stopPropagation()} ...>
  <Minus />
</button>
```

The `onMouseDown stopPropagation` is what allows the *frame's* `onMouseDown` (which focuses) to still fire — but the *title bar's* `onMouseDown` (which starts drag) to *not* fire. Without it, clicking close would also briefly start a drag.

Each button has `aria-label` for screen readers and Playwright selectors.

## Maximize / Restore

```ts
case 'MAXIMIZE_WINDOW': {
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === action.windowId ? {
        ...w,
        state: 'maximized',
        prevPosition: { ...w.position },
        prevSize: { ...w.size },
        position: { x: 0, y: TOP_PANEL_HEIGHT },
        size: { width: vw, height: vh - TOP_PANEL_HEIGHT - 48 },  // 48px = dock
      } : w
    ),
  };
}
```

Restore reverses by reading `prevPosition` and `prevSize`.

## Minimize

Sets `state: 'minimized'`, hides the window from `WindowManager` (which filters non-minimized), and updates the dock indicator dot.

For pinned dock apps, `isOpen` stays `true` even when minimized — that's macOS-correct behavior.

## Restore from dock

Click a dock icon for a minimized window:

```ts
const minimized = state.windows.find((w) => w.appId === appId && w.state === 'minimized');
if (minimized) {
  dispatch({ type: 'RESTORE_WINDOW', windowId: minimized.id });
  dispatch({ type: 'FOCUS_WINDOW', windowId: minimized.id });
}
```

If multiple minimized windows of the same app exist, the *first one found* is restored. (A "show all" UI for picking among many is a later polish.)

## Alt+Tab

Hold Alt → `START_ALT_TAB` opens the overlay. Tap Tab → `CYCLE_ALT_TAB` advances the index. Release Alt → `END_ALT_TAB` focuses the selected window.

The overlay uses CSS `clip-path` for a smooth fade-in.

## Tested behavior

The 14-step Playwright smoke (`app/scripts/smoke.mjs`) verifies the entire window lifecycle on every commit:

- Drag (delta ≥ 100 px)
- Resize SE corner (delta ≥ 50×30)
- Close button removes the window
- Minimize hides the window
- Click dock icon restores it
- Maximize fills the viewport
- Dock dot indicators are correct after open/close cycles
