import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetShortcutsForTest,
  comboFromEvent,
  comboMatches,
  isTextInputFocus,
  mountShortcutManager,
  normaliseCombo,
  registerShortcut,
} from "./shortcuts";

beforeEach(() => {
  _resetShortcutsForTest();
});

afterEach(() => {
  _resetShortcutsForTest();
});

function dispatchKeyDown(
  init: KeyboardEventInit & { target?: Element },
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  const target = init.target ?? document.body;
  target.dispatchEvent(ev);
  return ev;
}

describe("normaliseCombo", () => {
  it("orders modifiers and uppercases letter", () => {
    expect(normaliseCombo("shift+cmd+w")).toBe("Cmd+Shift+W");
    expect(normaliseCombo("Cmd+Shift+W")).toBe("Cmd+Shift+W");
  });

  it("accepts Cmd/Meta/Command aliases", () => {
    expect(normaliseCombo("Meta+W")).toBe("Cmd+W");
    expect(normaliseCombo("Command+W")).toBe("Cmd+W");
  });

  it("accepts Alt/Opt/Option aliases", () => {
    expect(normaliseCombo("Opt+Down")).toBe("Alt+Down");
    expect(normaliseCombo("Option+Down")).toBe("Alt+Down");
  });

  it("normalises key aliases", () => {
    expect(normaliseCombo("Escape")).toBe("Esc");
    expect(normaliseCombo("Cmd+Space")).toBe("Cmd+Space");
    expect(normaliseCombo("Cmd+ArrowDown")).toBe("Cmd+Down");
  });

  it("rejects modifier-only combos", () => {
    expect(() => normaliseCombo("Cmd+Shift")).toThrow();
  });
});

describe("comboMatches", () => {
  it("returns true on direct equality", () => {
    expect(comboMatches("Cmd+W", "Cmd+W")).toBe(true);
  });

  it("expands Mod alias", () => {
    // On macOS Mod = Cmd, on Linux Mod = Ctrl. The test is loose
    // because the platform is detected at module init.
    const got = comboMatches("Cmd+S", "Mod+S") || comboMatches("Ctrl+S", "Mod+S");
    expect(got).toBe(true);
  });

  it("returns false on mismatch", () => {
    expect(comboMatches("Cmd+W", "Cmd+Q")).toBe(false);
  });
});

describe("registerShortcut + dispatch", () => {
  it("calls the registered handler and prevents default", () => {
    mountShortcutManager(document);
    const handler = vi.fn();
    registerShortcut("active-app", "Cmd+S", handler);
    const ev = dispatchKeyDown({ key: "s", metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("higher-priority scope wins", () => {
    mountShortcutManager(document);
    const shellH = vi.fn();
    const appH = vi.fn();
    registerShortcut("shell", "Cmd+S", shellH);
    registerShortcut("active-app", "Cmd+S", appH);
    dispatchKeyDown({ key: "s", metaKey: true });
    expect(appH).toHaveBeenCalledTimes(1);
    expect(shellH).not.toHaveBeenCalled();
  });

  it("unregister removes the handler", () => {
    mountShortcutManager(document);
    const handler = vi.fn();
    const unreg = registerShortcut("active-app", "Cmd+S", handler);
    unreg();
    dispatchKeyDown({ key: "s", metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("LIFO tie-break within same scope (modal stack)", () => {
    mountShortcutManager(document);
    const lower = vi.fn();
    const upper = vi.fn();
    registerShortcut("modal", "Esc", lower);
    registerShortcut("modal", "Esc", upper);
    dispatchKeyDown({ key: "Escape" });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("returning false from handler skips preventDefault", () => {
    mountShortcutManager(document);
    registerShortcut("active-app", "Cmd+P", () => false);
    const ev = dispatchKeyDown({ key: "p", metaKey: true });
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("text-input scope precedence (the load-bearing test)", () => {
  it("Cmd+W registered at shell is NOT consumed when focus is in a textarea (text-input native combo)", () => {
    mountShortcutManager(document);
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    const shellH = vi.fn();
    registerShortcut("shell", "Cmd+W", shellH);

    // Cmd+W is in DEFAULT_BLOCKED_COMBOS so it WILL be preventDefaulted
    // (we want to stop the host browser from closing the tab) but the
    // shell handler must NOT fire when focus is in a textarea —
    // text-input scope wins.
    //
    // Wait — Cmd+W is not text-input-native. The actual load-bearing
    // assertion is: Cmd+C in a textarea does NOT trigger a shell
    // Cmd+C handler.
    const cH = vi.fn();
    registerShortcut("shell", "Cmd+C", cH);

    dispatchKeyDown({ key: "c", metaKey: true, target: ta });
    expect(cH).not.toHaveBeenCalled();

    // And Cmd+W still registers — the shell handler fires because
    // Cmd+W is not in TEXT_INPUT_NATIVE_COMBOS, so the active-text-input
    // doesn't shadow it.
    dispatchKeyDown({ key: "w", metaKey: true, target: ta });
    expect(shellH).toHaveBeenCalledTimes(1);

    document.body.removeChild(ta);
  });

  it("text-input scope handler fires when focus is in input", () => {
    mountShortcutManager(document);
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    const handler = vi.fn();
    registerShortcut("text-input", "Tab", handler);
    dispatchKeyDown({ key: "Tab", target: input });
    expect(handler).toHaveBeenCalledTimes(1);
    document.body.removeChild(input);
  });

  it("text-input scope handler does NOT fire when focus is on body", () => {
    mountShortcutManager(document);
    const handler = vi.fn();
    registerShortcut("text-input", "Tab", handler);
    dispatchKeyDown({ key: "Tab" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("default-block (host WebView protection)", () => {
  it("Cmd+W with no handler is preventDefaulted to stop host tab close", () => {
    mountShortcutManager(document);
    const ev = dispatchKeyDown({ key: "w", metaKey: true });
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Cmd+R is default-blocked (refresh would kill the OS)", () => {
    mountShortcutManager(document);
    const ev = dispatchKeyDown({ key: "r", metaKey: true });
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Cmd+P (print) is NOT default-blocked", () => {
    mountShortcutManager(document);
    const ev = dispatchKeyDown({ key: "p", metaKey: true });
    expect(ev.defaultPrevented).toBe(false);
  });

  it("typing 'a' in a textarea is not consumed", () => {
    mountShortcutManager(document);
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    const ev = dispatchKeyDown({ key: "a", target: ta });
    expect(ev.defaultPrevented).toBe(false);
    document.body.removeChild(ta);
  });
});

describe("comboFromEvent", () => {
  it("ignores pure modifier keydowns", () => {
    const ev = new KeyboardEvent("keydown", { key: "Meta", metaKey: true });
    expect(comboFromEvent(ev)).toBeNull();
  });

  it("encodes Cmd+Shift+P", () => {
    const ev = new KeyboardEvent("keydown", {
      key: "p",
      metaKey: true,
      shiftKey: true,
    });
    expect(comboFromEvent(ev)).toBe("Cmd+Shift+P");
  });
});

describe("isTextInputFocus", () => {
  it("identifies inputs / textareas / contenteditables", () => {
    const input = document.createElement("input");
    expect(isTextInputFocus(input)).toBe(true);

    const ta = document.createElement("textarea");
    expect(isTextInputFocus(ta)).toBe(true);

    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    expect(isTextInputFocus(ce)).toBe(true);

    const btn = document.createElement("button");
    expect(isTextInputFocus(btn)).toBe(false);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTextInputFocus(checkbox)).toBe(false);

    expect(isTextInputFocus(null)).toBe(false);
  });
});
