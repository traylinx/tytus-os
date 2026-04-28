// ============================================================
// CommandPalette — Cmd+K / Ctrl+K spotlight-style command runner
// ============================================================

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
} from 'react';
import {
  Search,
  Box,
  Settings as SettingsIcon,
  LifeBuoy,
  Folder,
  MessageSquare,
  Send,
  RefreshCw,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { navigate } from '@/lib/router';
import type { LucideProps } from 'lucide-react';

type IconComponent = React.ComponentType<LucideProps>;

interface CommandItem {
  id: string;
  label: string;
  section: string;
  icon: IconComponent;
  run: () => void;
}

const isMac = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  // Modern UA-data first, with classic platform string as a fallback for happy-dom.
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  const platform =
    uaData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac/i.test(platform);
};

const CommandPalette = memo(function CommandPalette() {
  const { dispatch } = useOS();
  const daemon = useDaemonStateContext();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build command list dynamically from current daemon + OS state.
  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      {
        id: 'app:settings',
        label: 'Open Settings',
        section: 'Apps',
        icon: SettingsIcon,
        run: () => dispatch({ type: 'OPEN_WINDOW', appId: 'settings' }),
      },
      {
        id: 'app:pod-inspector',
        label: 'Open Pod Inspector',
        section: 'Apps',
        icon: Box,
        run: () => dispatch({ type: 'OPEN_WINDOW', appId: 'pod-inspector' }),
      },
      {
        id: 'app:help',
        label: 'Open Help',
        section: 'Apps',
        icon: LifeBuoy,
        run: () => dispatch({ type: 'OPEN_WINDOW', appId: 'help' }),
      },
      {
        id: 'app:chat',
        label: 'Open Chat',
        section: 'Apps',
        icon: MessageSquare,
        run: () => dispatch({ type: 'OPEN_WINDOW', appId: 'chat' }),
      },
      {
        id: 'app:filemanager',
        label: 'Open Files',
        section: 'Apps',
        icon: Folder,
        run: () => dispatch({ type: 'OPEN_WINDOW', appId: 'filemanager' }),
      },
      {
        id: 'app:channels',
        label: 'Open Channels',
        section: 'Apps',
        icon: Send,
        run: () => dispatch({ type: 'OPEN_WINDOW', appId: 'channels' }),
      },
    ];

    const agents = daemon.state?.agents ?? [];
    for (const a of agents) {
      list.push({
        id: `pod:${a.pod_id}`,
        label: `Open Pod ${a.pod_id} (${a.agent_type})`,
        section: 'Pods',
        icon: Box,
        run: () => {
          dispatch({ type: 'OPEN_WINDOW', appId: 'pod-inspector' });
          navigate({
            kind: 'pod',
            podId: a.pod_id,
            action: 'overview',
            params: new URLSearchParams(),
          });
        },
      });
    }

    list.push(
      {
        id: 'sys:refresh',
        label: 'Refresh daemon state',
        section: 'System',
        icon: RefreshCw,
        run: () => daemon.refresh(),
      },
      {
        id: 'sys:signout',
        label: 'Sign out',
        section: 'System',
        icon: LogOut,
        run: () => {
          navigate({
            kind: 'settings',
            section: 'account',
            params: new URLSearchParams(),
          });
          dispatch({ type: 'OPEN_WINDOW', appId: 'settings' });
        },
      },
    );

    return list;
  }, [dispatch, daemon]);

  // Filter commands by case-insensitive substring on label + section.
  const filtered = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.section.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Group filtered commands by section, preserving insertion order.
  const grouped = useMemo<Array<{ section: string; items: CommandItem[] }>>(
    () => {
      const order: string[] = [];
      const buckets = new Map<string, CommandItem[]>();
      for (const c of filtered) {
        if (!buckets.has(c.section)) {
          buckets.set(c.section, []);
          order.push(c.section);
        }
        buckets.get(c.section)!.push(c);
      }
      return order.map((s) => ({ section: s, items: buckets.get(s)! }));
    },
    [filtered],
  );

  // Cmd+K / Ctrl+K toggle. Esc close. Both registered on window.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mac = isMac();
      const cmdK =
        (mac ? e.metaKey : e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === 'k' || e.key === 'K');
      if (cmdK) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((prev) => !prev);
        return;
      }
      if (open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Reset query + highlight when opening; autofocus input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Keep highlight in range when filter changes.
  useEffect(() => {
    if (filtered.length === 0) {
      if (highlight !== 0) setHighlight(0);
      return;
    }
    if (highlight >= filtered.length) {
      setHighlight(filtered.length - 1);
    }
  }, [filtered, highlight]);

  const execute = useCallback(
    (cmd: CommandItem) => {
      cmd.run();
      setOpen(false);
      setQuery('');
      setHighlight(0);
    },
    [],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (filtered.length === 0) {
        if (e.key === 'Enter') e.preventDefault();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[highlight];
        if (cmd) execute(cmd);
      }
    },
    [filtered, highlight, execute],
  );

  // Scroll the highlighted row into view as the user navigates.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cmd-index="${highlight}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  if (!open) return null;

  // Build a flat index map so per-row data-cmd-index matches `filtered`.
  let flatIdx = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[7000] flex items-start justify-center"
      style={{
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        paddingTop: '15vh',
        animation: 'cmdPaletteFade 150ms ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="w-[560px] max-w-[92vw] flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: 'var(--bg-window)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
          maxHeight: '60vh',
          animation: 'cmdPalettePop 180ms cubic-bezier(0.34,1.2,0.64,1)',
        }}
      >
        {/* Search */}
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <Search size={16} className="text-[var(--text-secondary)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command…"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--text-primary)' }}
            autoFocus
          />
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto custom-scrollbar"
          style={{ maxHeight: 'calc(60vh - 56px)' }}
        >
          {filtered.length === 0 ? (
            <div
              className="px-4 py-8 text-center text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              No commands match.
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.section} className="py-1">
                <div
                  className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.1em]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {group.section}
                </div>
                {group.items.map((cmd) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  const active = idx === highlight;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      data-cmd-index={idx}
                      type="button"
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => execute(cmd)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors"
                      style={{
                        background: active
                          ? 'var(--bg-card, var(--bg-hover))'
                          : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <Icon
                        size={16}
                        className="text-[var(--text-secondary)]"
                      />
                      <span className="flex-1 truncate">{cmd.label}</span>
                      <ChevronRight
                        size={14}
                        className="text-[var(--text-secondary)]"
                        style={{ opacity: active ? 1 : 0 }}
                      />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes cmdPaletteFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cmdPalettePop {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
});

export default CommandPalette;
