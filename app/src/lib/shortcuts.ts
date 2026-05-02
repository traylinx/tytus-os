// ============================================================
// Shortcut router — single capture-phase keyboard dispatcher
// ============================================================
//
// Why this exists:
//
//   • Tytus OS runs inside a Chromium WebView. Without a global
//     interceptor, Cmd+W closes the *host browser tab*, not the
//     active OS window. Same for Cmd+Q / Cmd+R / Cmd+T. The router
//     attaches at `document` capture phase so every keydown passes
//     through this single point.
//
//   • Multiple subsystems (Desktop, FileManager, App windows, the
//     shell, modals) want to register the same combo (Cmd+C, Cmd+Z,
//     etc.) with different meanings. The router enforces a priority
//     stack so the right handler wins:
//
//                 text-input  > modal > active-app > shell
//
// Combo string convention (a small subset of accepted modifiers):
//
//     "Cmd+W", "Cmd+Shift+P", "Ctrl+C", "Esc", "Enter",
//     "Cmd+Z", "Cmd+Shift+Z", "Mod+S" (Mod = Cmd on macOS, Ctrl else)
//
// Modifiers are case-insensitive but stable order is enforced when
// normalising: Mod / Cmd / Ctrl / Alt(Opt) / Shift / <key>.

export type ShortcutScope = "text-input" | "modal" | "active-app" | "shell";

export const SHORTCUT_SCOPES: readonly ShortcutScope[] = [
  "text-input",
  "modal",
  "active-app",
  "shell",
] as const;

export const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
  "text-input": 4,
  modal: 3,
  "active-app": 2,
  shell: 1,
};

/** Handler return value:
 *   • true (or void)  → router calls preventDefault + stopPropagation
 *   • false          → router does NOT preventDefault (let the event
 *                      keep bubbling to native handlers)
 */
export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

interface Registration {
  scope: ShortcutScope;
  combo: string; // already normalised
  handler: ShortcutHandler;
  /** Monotonic id; tie-breaker when two registrations share scope+combo. */
  id: number;
}

/**
 * Combos the host browser would normally consume in the WebView.
 * The router default-blocks these (`preventDefault`) so nothing
 * inside the OS accidentally kills the chrome of the host. Apps
 * are still free to *register* their own handler for these combos
 * — the registration wins over the default-block.
 */
export const DEFAULT_BLOCKED_COMBOS: readonly string[] = [
  "Cmd+W",
  "Cmd+Q",
  "Cmd+R",
  "Cmd+T",
  "Cmd+N",
  "Ctrl+W",
  "Ctrl+R",
  "Ctrl+T",
  "Ctrl+N",
] as const;

/**
 * Combos that are *natively owned* by text inputs (selection, copy,
 * paste, undo, redo, navigation). When focus is inside an input /
 * textarea / contenteditable, the router won't dispatch a lower-
 * scope handler for these combos — the browser's native behaviour
 * wins. Apps that want to override (e.g. Markdown editor with
 * custom Cmd+B) register at `text-input` scope explicitly.
 */
export const TEXT_INPUT_NATIVE_COMBOS: ReadonlySet<string> = new Set([
  "Cmd+A",
  "Cmd+C",
  "Cmd+V",
  "Cmd+X",
  "Cmd+Z",
  "Cmd+Shift+Z",
  "Cmd+Y",
  "Ctrl+A",
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+X",
  "Ctrl+Z",
  "Ctrl+Shift+Z",
  "Ctrl+Y",
  "Mod+A",
  "Mod+C",
  "Mod+V",
  "Mod+X",
  "Mod+Z",
  "Mod+Shift+Z",
  "Mod+Y",
]);

// --------------------------------------------------------
// Registry
// --------------------------------------------------------

const registry: Registration[] = [];
let nextId = 1;
let installed = false;
let installedTarget: Document | null = null;

/**
 * Register a shortcut. Returns an unregister function. Handlers are
 * called in scope-priority order; the first one to handle the event
 * (returning anything other than `false`) consumes it.
 */
export function registerShortcut(
  scope: ShortcutScope,
  combo: string,
  handler: ShortcutHandler,
): () => void {
  const reg: Registration = {
    scope,
    combo: normaliseCombo(combo),
    handler,
    id: nextId++,
  };
  registry.push(reg);
  return () => {
    const idx = registry.indexOf(reg);
    if (idx >= 0) registry.splice(idx, 1);
  };
}

/**
 * Mount the shortcut router on the document. Idempotent; calling
 * twice is a no-op. Returns a cleanup function that detaches the
 * listener (used by tests + StrictMode).
 */
export function mountShortcutManager(target: Document = document): () => void {
  if (installed && installedTarget === target) {
    return () => unmountShortcutManager();
  }
  if (installed) unmountShortcutManager();
  installedTarget = target;
  installed = true;
  target.addEventListener("keydown", onKeyDown, true);
  return () => unmountShortcutManager();
}

function unmountShortcutManager(): void {
  if (!installed || !installedTarget) {
    installed = false;
    installedTarget = null;
    return;
  }
  installedTarget.removeEventListener("keydown", onKeyDown, true);
  installed = false;
  installedTarget = null;
}

/** Test/debug helper — clears all registrations. */
export function _resetShortcutsForTest(): void {
  registry.length = 0;
  unmountShortcutManager();
  nextId = 1;
}

// --------------------------------------------------------
// Dispatch
// --------------------------------------------------------

function onKeyDown(e: KeyboardEvent): void {
  const combo = comboFromEvent(e);
  if (!combo) return;
  const inText = isTextInputFocus(e.target);
  const nativeOwned = inText && TEXT_INPUT_NATIVE_COMBOS.has(combo);

  // Walk registry in scope-priority order. text-input scope only
  // fires when focus is in a text input. When focus is in a text
  // input AND the combo is text-input-native (Cmd+C/X/V/A/Z/...),
  // lower scopes are shadowed — only a text-input registration can
  // override the browser's native behaviour.
  const eligible = (scope: ShortcutScope): boolean => {
    if (scope === "text-input") return inText;
    if (nativeOwned) return false; // shell/active-app/modal can't steal Cmd+C in a textarea
    return true;
  };

  const candidates = registry
    .filter((r) => eligible(r.scope))
    .filter((r) => comboMatches(combo, r.combo))
    .sort((a, b) => {
      const ds = SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope];
      if (ds !== 0) return ds;
      // Same scope: most-recent registration wins (LIFO) so a modal
      // mounted on top of an app stack handles Esc.
      return b.id - a.id;
    });

  if (candidates.length > 0) {
    const result = candidates[0].handler(e);
    if (result !== false) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  // No registered handler matched. If we're in a text input AND the
  // combo is text-input-native, let the browser run its default
  // (selection / copy / paste / undo). Don't preventDefault.
  if (nativeOwned) {
    return;
  }

  // Default-block: stop the host browser from acting on combos that
  // would otherwise close / refresh / open a new tab inside the WebView.
  if (DEFAULT_BLOCKED_COMBOS.some((c) => comboMatches(combo, c))) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// --------------------------------------------------------
// Combo parsing
// --------------------------------------------------------

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

/** Public helper for callers that want to mirror platform behaviour. */
export function isMacPlatform(): boolean {
  return IS_MAC;
}

export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = normaliseKeyName(e.key);
  if (!key) return null;
  // Pure modifier keydowns are ignored (we wait for the "real" key).
  if (key === "Cmd" || key === "Ctrl" || key === "Alt" || key === "Shift") {
    return null;
  }
  const parts: string[] = [];
  if (e.metaKey) parts.push("Cmd");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/**
 * Normalise a combo string: trims whitespace, fixes modifier order,
 * canonicalises key aliases ("Esc" / "Escape", "Space" / " ").
 */
export function normaliseCombo(combo: string): string {
  const raw = combo.trim().split("+").map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0) {
    throw new Error(`normaliseCombo: empty combo "${combo}"`);
  }
  const mods: string[] = [];
  let key = "";
  for (const part of raw) {
    const lc = part.toLowerCase();
    if (lc === "cmd" || lc === "meta" || lc === "command") {
      mods.push("Cmd");
    } else if (lc === "ctrl" || lc === "control") {
      mods.push("Ctrl");
    } else if (lc === "alt" || lc === "opt" || lc === "option") {
      mods.push("Alt");
    } else if (lc === "shift") {
      mods.push("Shift");
    } else if (lc === "mod") {
      // Mod = Cmd on macOS, Ctrl elsewhere
      mods.push(IS_MAC ? "Cmd" : "Ctrl");
    } else {
      key = normaliseKeyName(part) ?? part;
    }
  }
  if (!key) {
    throw new Error(`normaliseCombo: no non-modifier key in "${combo}"`);
  }
  // Stable order
  const ordered: string[] = [];
  for (const m of ["Cmd", "Ctrl", "Alt", "Shift"]) {
    if (mods.includes(m)) ordered.push(m);
  }
  ordered.push(key);
  return ordered.join("+");
}

function normaliseKeyName(raw: string): string | null {
  if (!raw) return null;
  const k = raw;
  // Single letters → uppercase
  if (k.length === 1) {
    return k.toUpperCase();
  }
  // Modifier names (when received as e.key on modifier-only press)
  if (k === "Meta" || k === "OS") return "Cmd";
  if (k === "Control") return "Ctrl";
  if (k === "Alt" || k === "Option") return "Alt";
  if (k === "Shift") return "Shift";
  // Common aliases
  switch (k) {
    case "Escape":
      return "Esc";
    case " ":
      return "Space";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    default:
      return k;
  }
}

/**
 * True if the runtime combo (from a real KeyboardEvent) matches a
 * registered combo. Handles the `Mod` portability alias: registering
 * `Mod+S` matches `Cmd+S` on Mac and `Ctrl+S` elsewhere.
 */
export function comboMatches(actual: string, registered: string): boolean {
  if (actual === registered) return true;
  // `Mod` in the registered combo expands to platform meta key.
  if (registered.includes("Mod")) {
    const expanded = registered.replace(/Mod/g, IS_MAC ? "Cmd" : "Ctrl");
    if (actual === expanded) return true;
  }
  return false;
}

// --------------------------------------------------------
// Focus detection
// --------------------------------------------------------

export function isTextInputFocus(target: EventTarget | null): boolean {
  if (!target || !(target as Element).tagName) return false;
  const el = target as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    // Buttons / checkboxes / radios are not text inputs.
    const t = (el as HTMLInputElement).type;
    if (t && /^(button|checkbox|radio|range|color|file|submit|reset|hidden)$/i.test(t)) {
      return false;
    }
    return true;
  }
  if (tag === "textarea") return true;
  if (el.getAttribute && el.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}
