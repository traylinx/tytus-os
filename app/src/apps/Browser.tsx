// ============================================================
// Browser app — Phase 5 (support infra)
// ============================================================
//
// Owned capabilities (manifest §10):
//   A14.1 — Registered launchers (GET /api/launchers)
//   A14.2 — Open external URL    (POST /api/open-external)
//
// This is NOT a real web browser. Web sandbox forbids rendering remote
// pages. Instead it surfaces:
//   - A URL bar that hands a user-typed URL to the host's default browser
//     via the daemon's open-external endpoint.
//   - The list of registered launchers reported by the daemon
//     (currently editors discovered on PATH + an optional terminal flag).
//   - A small set of hardcoded quick actions (dashboard / provider / repo).

import {
  type FC,
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  Globe,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Search,
  BookOpen,
  Github,
} from 'lucide-react';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import type { Launchers } from '@/types/daemon';

// ---- URL validation ----
//
// The daemon will reject anything weirder than this anyway, but we want a
// readable inline message before we even round-trip. Accepts:
//   - http(s)://...
//   - any scheme://... (catches openclaw://, tg://, discord://, slack://, …)
//
// Rejects: bare strings, schemes without "://", whitespace.
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

const isAllowedUrl = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (/\s/.test(trimmed)) return false;
  return URL_SCHEME_RE.test(trimmed);
};

const URL_HELP =
  'Invalid URL — must start with http://, https://, or a known scheme.';

// ---- Quick actions (hardcoded per manifest §10.2) ----
interface QuickAction {
  label: string;
  url: string;
  icon: typeof Globe;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Tytus dashboard', url: 'https://tytus.traylinx.com', icon: BookOpen },
  { label: 'Provider', url: 'https://tytus.traylinx.com', icon: Globe },
  { label: 'GitHub', url: 'https://github.com/traylinx', icon: Github },
];

// ============================================================
// Component
// ============================================================

const Browser: FC = () => {
  const client = useDaemonClient();

  // URL bar.
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // Launchers.
  const [launchers, setLaunchers] = useState<Launchers | null>(null);
  const [launchersLoading, setLaunchersLoading] = useState(true);
  const [launchersErr, setLaunchersErr] = useState<string | null>(null);

  // Track which row is mid-open so we can disable just that one.
  const [openingTarget, setOpeningTarget] = useState<string | null>(null);

  // ---- Load launchers on mount ----
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      const r = await client.getLaunchers(ac.signal);
      if (cancelled) return;
      if (!r.ok) {
        setLaunchersErr(r.error.message);
        setLaunchers(null);
      } else {
        setLaunchersErr(null);
        setLaunchers(r.value);
      }
      setLaunchersLoading(false);
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [client]);

  const onSubmitUrl = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = urlInput.trim();
      if (!isAllowedUrl(trimmed)) {
        setUrlError(URL_HELP);
        return;
      }
      setUrlError(null);
      setOpening(true);
      const r = await client.postOpenExternal(trimmed);
      setOpening(false);
      if (!r.ok) setUrlError(r.error.message);
    },
    [client, urlInput],
  );

  const onClickQuick = useCallback(
    async (action: QuickAction) => {
      const key = `quick:${action.label}`;
      setOpeningTarget(key);
      const r = await client.postOpenExternal(action.url);
      setOpeningTarget(null);
      if (!r.ok) {
        setUrlError(`Couldn't open ${action.label}: ${r.error.message}`);
      }
    },
    [client],
  );

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--bg-window)' }}
    >
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <Globe size={18} style={{ color: 'var(--accent-primary)' }} />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Browser
          </h2>
          <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
            Hands URLs and registered launchers off to your host's default
            browser. TytusOS doesn't render remote pages itself.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        {/* URL bar */}
        <section>
          <form onSubmit={onSubmitUrl} className="flex items-stretch gap-2">
            <label
              htmlFor="browser-url"
              className="flex items-center px-2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              URL
            </label>
            <input
              id="browser-url"
              type="text"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder="https://github.com/traylinx/tytus-cli"
              className="flex-1 px-3 py-2 rounded-md text-sm outline-none"
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
              }}
            />
            <button
              type="submit"
              disabled={opening || urlInput.trim().length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors disabled:opacity-60"
              style={{ background: 'var(--accent-primary)' }}
            >
              {opening ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ExternalLink size={14} />
              )}
              Open
            </button>
          </form>
          {urlError && (
            <div
              className="mt-2 p-2.5 rounded-md text-xs flex items-start gap-2"
              style={{
                background: 'rgba(244,67,54,0.10)',
                border: '1px solid rgba(244,67,54,0.30)',
                color: '#FFCDD2',
              }}
            >
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{urlError}</span>
            </div>
          )}
        </section>

        <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

        {/* Registered launchers */}
        <section>
          <h3
            className="text-[11px] uppercase tracking-wider font-semibold mb-3"
            style={{ color: 'var(--text-secondary)' }}
          >
            Registered launchers
          </h3>

          {launchersLoading && (
            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Loader2 size={14} className="animate-spin" />
              <span>Loading registered launchers…</span>
            </div>
          )}

          {!launchersLoading && launchersErr && (
            <div
              className="p-2.5 rounded-md text-xs flex items-start gap-2"
              style={{
                background: 'rgba(244,67,54,0.10)',
                border: '1px solid rgba(244,67,54,0.30)',
                color: '#FFCDD2',
              }}
            >
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>Couldn't load launchers: {launchersErr}</span>
            </div>
          )}

          {!launchersLoading && !launchersErr && launchers && (
            <LauncherList launchers={launchers} />
          )}
        </section>

        <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

        {/* Quick actions */}
        <section>
          <h3
            className="text-[11px] uppercase tracking-wider font-semibold mb-3"
            style={{ color: 'var(--text-secondary)' }}
          >
            Quick actions
          </h3>
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((q) => {
              const key = `quick:${q.label}`;
              const busy = openingTarget === key;
              const Icon = q.icon;
              return (
                <button
                  key={q.label}
                  onClick={() => onClickQuick(q)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-60"
                  style={{
                    background: 'var(--bg-hover, rgba(255,255,255,0.04))',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                  title={q.url}
                >
                  {busy ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Icon size={12} />
                  )}
                  {q.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

// ============================================================
// LauncherList — informational list of editors / terminal flag
// ============================================================
//
// The daemon's Launchers shape is `{ editors: string[]; terminal_available }`
// — names only, no URL/path. There's no per-launcher open endpoint, so
// rows are informational. If the daemon ever adds a structured launcher
// type with a URL field, switch the rows to `Open ↗` buttons that call
// postOpenExternal.

const LauncherList: FC<{ launchers: Launchers }> = ({ launchers }) => {
  const editors = launchers.editors ?? [];

  if (editors.length === 0 && !launchers.terminal_available) {
    return (
      <div
        className="px-3 py-4 rounded-md text-xs text-center"
        style={{
          background: 'var(--bg-card, rgba(255,255,255,0.03))',
          border: '1px dashed var(--border-subtle)',
          color: 'var(--text-secondary)',
        }}
      >
        No launchers registered.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {editors.map((name) => (
        <LauncherRow key={`editor:${name}`} name={name} kind="editor" />
      ))}
      {launchers.terminal_available && (
        <LauncherRow name="terminal" kind="available" />
      )}
    </div>
  );
};

const LauncherRow: FC<{ name: string; kind: string }> = ({ name, kind }) => (
  <div
    className="flex items-center gap-3 px-3 py-2 rounded-md"
    style={{
      background: 'var(--bg-card, rgba(255,255,255,0.03))',
      border: '1px solid var(--border-subtle)',
    }}
  >
    <Search size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
    <span
      className="flex-1 truncate font-mono text-xs"
      style={{ color: 'var(--text-primary)' }}
    >
      {name}
    </span>
    <span
      className="text-[10px] uppercase tracking-wider"
      style={{ color: 'var(--text-disabled)' }}
    >
      {kind}
    </span>
  </div>
);

export default Browser;
