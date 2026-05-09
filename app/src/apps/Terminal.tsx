// ============================================================
// Terminal — real host PTY through the Tytus tray daemon
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { Terminal as XTermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useCurrentWindow, useCurrentWindowArgs } from '@/hooks/useCurrentWindow';
import { useOS } from '@/hooks/useOSStore';
import { useShellMenuRegistration } from '@/hooks/useShellMenu';
import type { ShellMenuModel } from '@/lib/shellMenu';

type TerminalStart = {
  command?: 'shell' | 'tytus';
  args?: string[];
  cols?: number;
  rows?: number;
};

type TerminalStartResponse = { id: string } | { error: string };
type TerminalReadResponse = {
  id: string;
  output: string;
  alive: boolean;
  exit_code: number | null;
} | { error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

class TerminalRequestError extends Error {
  readonly status: number;
  readonly terminalMissing: boolean;

  constructor(message: string, status: number, terminalMissing = false) {
    super(message);
    this.name = 'TerminalRequestError';
    this.status = status;
    this.terminalMissing = terminalMissing;
  }
}

const terminalErrorMessage = (parsed: unknown, fallback: string): string =>
  isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : fallback;

async function startTerminal(body: TerminalStart): Promise<string> {
  const res = await fetch('/api/terminal/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({})) as unknown;
  if (!res.ok || !isRecord(parsed) || typeof parsed.id !== 'string') {
    throw new TerminalRequestError(
      terminalErrorMessage(parsed, `terminal start failed (${res.status})`),
      res.status,
    );
  }
  return parsed.id;
}

async function readTerminal(id: string): Promise<TerminalReadResponse> {
  const res = await fetch(`/api/terminal/session?id=${encodeURIComponent(id)}`);
  const parsed = await res.json().catch(() => ({})) as unknown;
  if (!res.ok) {
    const message = terminalErrorMessage(parsed, `terminal read failed (${res.status})`);
    throw new TerminalRequestError(message, res.status, message === 'terminal_not_found');
  }
  return parsed as TerminalReadResponse;
}

async function writeTerminal(id: string, data: string): Promise<void> {
  const res = await fetch(`/api/terminal/session/write?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({})) as unknown;
    const message = terminalErrorMessage(parsed, `terminal write failed (${res.status})`);
    throw new TerminalRequestError(message, res.status, message === 'terminal_not_found');
  }
}

function resizeTerminal(id: string, cols: number, rows: number): void {
  void fetch(`/api/terminal/session/resize?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  }).catch(() => undefined);
}

function stopTerminal(id: string): void {
  void fetch(`/api/terminal/session?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    .catch(() => undefined);
}


function modifierForPlatform(e: KeyboardEvent<HTMLDivElement>): boolean {
  // macOS uses Command; Windows/Linux use Ctrl. Browser still reports Ctrl on
  // Mac for Ctrl-C, which must remain a terminal SIGINT path.
  return navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey;
}

export default function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const sessionRef = useRef<string | null>(null);
  const fitRef = useRef<((notifyBackend?: boolean) => void) | null>(null);
  const fontSizeRef = useRef(12);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting');
  const windowArgs = useCurrentWindowArgs();
  const currentWindow = useCurrentWindow();
  const { dispatch } = useOS();

  const start = useMemo<TerminalStart>(() => {
    const requested = windowArgs?.terminal;
    if (requested?.command === 'tytus') {
      return { command: 'tytus', args: requested.args ?? [] };
    }
    return { command: 'shell' };
  }, [windowArgs?.terminal]);

  const sessionKey = JSON.stringify(start);

  const copySelection = () => {
    const term = termRef.current;
    if (!term || !term.hasSelection()) return;
    void navigator.clipboard?.writeText(term.getSelection());
  };

  const pasteClipboard = () => {
    const id = sessionRef.current;
    if (!id) return;
    void navigator.clipboard?.readText().then((text) => {
      if (text) void writeTerminal(id, text).catch(() => undefined);
    });
  };

  const changeFontSize = (delta: number) => {
    const term = termRef.current;
    if (!term) return;
    const next = Math.min(24, Math.max(9, fontSizeRef.current + delta));
    fontSizeRef.current = next;
    term.options.fontSize = next;
    window.requestAnimationFrame(() => fitRef.current?.());
  };

  const resetFontSize = () => {
    const term = termRef.current;
    if (!term) return;
    fontSizeRef.current = 12;
    term.options.fontSize = 12;
    window.requestAnimationFrame(() => fitRef.current?.());
  };

  const menuModel = useMemo<ShellMenuModel | null>(() => {
    if (!currentWindow?.id) return null;
    return {
      appLabel: 'Terminal',
      groups: [
        {
          id: 'shell',
          label: 'Shell',
          items: [
            { id: 'new-terminal', label: 'New Terminal Window', actionId: 'open-terminal' },
            { id: 'clear', label: 'Clear Screen', onSelect: () => termRef.current?.clear() },
            { id: 'reset', label: 'Reset Terminal', onSelect: () => termRef.current?.reset() },
          ],
        },
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { id: 'copy', label: 'Copy', onSelect: copySelection },
            { id: 'paste', label: 'Paste', onSelect: pasteClipboard },
            { id: 'select-all', label: 'Select All', onSelect: () => termRef.current?.selectAll() },
          ],
        },
        {
          id: 'view',
          label: 'View',
          items: [
            { id: 'font-bigger', label: 'Increase Font Size', onSelect: () => changeFontSize(1) },
            { id: 'font-smaller', label: 'Decrease Font Size', onSelect: () => changeFontSize(-1) },
            { id: 'font-reset', label: 'Reset Font Size', onSelect: resetFontSize },
            { id: 'scroll-top', label: 'Scroll to Top', onSelect: () => termRef.current?.scrollToTop() },
            { id: 'scroll-bottom', label: 'Scroll to Bottom', onSelect: () => termRef.current?.scrollToBottom() },
          ],
        },
        {
          id: 'window',
          label: 'Window',
          items: [
            { id: 'minimize', label: 'Minimize Window', actionId: 'minimize-window' },
            { id: 'close', label: 'Close Window', actionId: 'close-window' },
          ],
        },
        {
          id: 'help',
          label: 'Help',
          items: [{ id: 'tytus-help', label: 'Tytus Help', actionId: 'open-help' }],
        },
      ],
    };
  }, [currentWindow?.id]);

  useShellMenuRegistration(currentWindow?.id, menuModel);

  const enqueueTerminalWrite = (term: XTermTerminal, data: string) => {
    // xterm.write is async internally. Serializing writes prevents a resize from
    // interleaving with a half-applied TUI frame. Ghostty does the equivalent
    // with terminal/renderer locks and mailboxes; this is the xterm version.
    writeQueueRef.current = writeQueueRef.current.then(() => new Promise<void>((resolve) => {
      term.write(data, () => {
        term.scrollToBottom();
        resolve();
      });
    }));
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let pollTimer: number | null = null;
    let resizeTimer: number | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let titleDisposable: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    setStatus('connecting');

    const term = new XTermTerminal({
      cursorBlink: true,
      // Full-screen CLIs (Claude, vim, htop, etc.) rely on exact VT cursor
      // control. convertEol mutates terminal output and corrupts TUIs on
      // resize/redraw; leave bytes exactly as the PTY produced them.
      convertEol: false,
      cols: 120,
      rows: 32,
      scrollback: 10000,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      theme: {
        background: '#050606',
        foreground: '#E5E7EB',
        cursor: '#7C4DFF',
        selectionBackground: '#3B2A72',
        black: '#111827',
        red: '#EF4444',
        green: '#22C55E',
        yellow: '#F59E0B',
        blue: '#60A5FA',
        magenta: '#A78BFA',
        cyan: '#2DD4BF',
        white: '#E5E7EB',
        brightBlack: '#6B7280',
        brightRed: '#F87171',
        brightGreen: '#86EFAC',
        brightYellow: '#FCD34D',
        brightBlue: '#93C5FD',
        brightMagenta: '#C4B5FD',
        brightCyan: '#67E8F9',
        brightWhite: '#F9FAFB',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    container.replaceChildren();
    term.open(container);

    const fit = (notifyBackend = true): { cols: number; rows: number } | null => {
      try {
        fitAddon.fit();
        term.scrollToBottom();
        const geometry = { cols: term.cols, rows: term.rows };
        const id = sessionRef.current;
        if (notifyBackend && id) resizeTerminal(id, geometry.cols, geometry.rows);
        return geometry;
      } catch {
        // Container may be temporarily hidden while a window is opening/minimizing.
        return null;
      }
    };
    fitRef.current = fit;


    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      // Do one final geometry update after the user stops dragging. Sending
      // every intermediate pixel-size to CLI TUIs causes redraw spam in
      // primary-buffer apps; Ghostty coalesces renderer work similarly.
      resizeTimer = window.setTimeout(() => fit(true), 140);
    });
    resizeObserver.observe(container);

    term.focus();

    const markTerminalLost = (message: string, color = '31') => {
      if (cancelled) return;
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
      dataDisposable?.dispose();
      dataDisposable = null;
      titleDisposable?.dispose();
      titleDisposable = null;
      sessionRef.current = null;
      term.writeln(`\r\n\x1b[${color}m${message}\x1b[0m`);
      setStatus(color === '90' ? 'closed' : 'error');
    };

    const poll = async (id: string) => {
      if (cancelled) return;
      try {
        const parsed = await readTerminal(id);
        if (cancelled) return;
        if ('error' in parsed) {
          term.writeln(`\r\n\x1b[31m${parsed.error}\x1b[0m`);
          setStatus('error');
          return;
        }
        if (parsed.output) enqueueTerminalWrite(term, parsed.output);
        if (!parsed.alive) {
          if (parsed.exit_code !== null) {
            term.writeln(`\r\n\x1b[90m[process exited: ${parsed.exit_code}]\x1b[0m`);
          }
          setStatus('closed');
          return;
        }
        pollTimer = window.setTimeout(() => void poll(id), 90);
      } catch (err) {
        if (!cancelled) {
          term.writeln(`\r\n\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m`);
          setStatus('error');
        }
      }
    };

    window.requestAnimationFrame(() => {
      if (cancelled) return;
      // Fit before spawning the child process. Real terminal apps hand the
      // initial PTY size to the child; starting at 120x32 and resizing after
      // Claude/vim painted causes duplicated box-drawing artifacts.
      const geometry = fit(false) ?? { cols: term.cols, rows: term.rows };

      void startTerminal({ ...start, cols: geometry.cols, rows: geometry.rows })
      .then((id) => {
        if (cancelled) {
          stopTerminal(id);
          return;
        }
        sessionRef.current = id;
        setStatus('connected');
        term.reset();
        fit();
        dataDisposable = term.onData((data) => {
          void writeTerminal(id, data).catch((err) => {
            const missing = err instanceof TerminalRequestError && err.terminalMissing;
            markTerminalLost(
              missing
                ? 'Terminal session ended because Tytus restarted. Open a new Terminal window.'
                : err instanceof Error ? err.message : String(err),
            );
          });
        });
        titleDisposable = term.onTitleChange((title) => {
          if (currentWindow?.id && title.trim()) {
            dispatch({ type: 'UPDATE_WINDOW_TITLE', windowId: currentWindow.id, title: title.trim() });
          }
        });
        void poll(id);
      })
      .catch((err) => {
        if (!cancelled) {
          term.writeln(`\r\n\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m`);
          term.writeln('\x1b[90mRestart the Tytus tray if this endpoint is missing.\x1b[0m');
          setStatus('error');
        }
      });
    });

    return () => {
      cancelled = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      dataDisposable?.dispose();
      titleDisposable?.dispose();
      if (fitRef.current === fit) fitRef.current = null;
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) stopTerminal(id);
      term.dispose();
      if (termRef.current === term) termRef.current = null;
    };
  }, [currentWindow?.id, dispatch, sessionKey, start]);

  const handleClipboardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const term = termRef.current;
    const id = sessionRef.current;
    if (!term || !id || !modifierForPlatform(e) || e.altKey) return;

    const key = e.key.toLowerCase();
    if (key === 'c') {
      if (term.hasSelection()) {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard?.writeText(term.getSelection());
      }
      return;
    }
    if (key === 'v') {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard?.readText().then((text) => {
        if (text) void writeTerminal(id, text).catch(() => undefined);
      });
      return;
    }
    if (key === 'a') {
      e.preventDefault();
      e.stopPropagation();
      term.selectAll();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const id = sessionRef.current;
    if (!id) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    void writeTerminal(id, text).catch(() => undefined);
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#050606]"
      data-tytus-terminal="true"
      onKeyDownCapture={handleClipboardKeyDown}
      onPasteCapture={handlePaste}
    >
      <div ref={containerRef} className="h-full w-full" />
      {status === 'connecting' && (
        <div className="pointer-events-none absolute right-3 top-2 rounded-md bg-black/50 px-2 py-1 text-[10px] text-white/60">
          connecting
        </div>
      )}
    </div>
  );
}
