// ============================================================
// Help app — Phase 4
// ============================================================
//
// Owned capabilities (manifest §5):
//   A3.1b — Daemon doctor (POST /api/doctor + SSE)
//   A3.2  — Health test  (POST /api/test   + SSE)
//   A3.3  — Daemon log tail (GET /api/logs?name=daemon|startup&offset=N)
//   About — version + daemon PID + uptime + keychain health
//
// Layout: vertical sidebar like Settings, content pane on the right.
// Doctor is the default — that's what users open Help for first.

import {
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Stethoscope,
  Activity,
  ScrollText,
  Info,
  Play,
  Loader2,
  Pause,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useJobStream } from '@/hooks/useJobStream';
import type { LogChunk } from '@/types/daemon';

type TabId = 'doctor' | 'test' | 'logs' | 'about';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'doctor', label: 'Doctor', icon: <Stethoscope size={16} /> },
  { id: 'test', label: 'Health test', icon: <Activity size={16} /> },
  { id: 'logs', label: 'Logs', icon: <ScrollText size={16} /> },
  { id: 'about', label: 'About', icon: <Info size={16} /> },
];

const Help: FC = () => {
  const [active, setActive] = useState<TabId>('doctor');

  return (
    <div className="flex h-full" style={{ background: 'var(--bg-window)' }}>
      <div
        className="w-48 shrink-0 flex flex-col"
        style={{
          background: 'var(--bg-titlebar)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--text-secondary)' }}
        >
          Help
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
            style={{
              background:
                active === t.id ? 'var(--bg-selected)' : 'transparent',
              color:
                active === t.id
                  ? 'var(--accent-primary)'
                  : 'var(--text-primary)',
              borderLeft:
                active === t.id
                  ? '3px solid var(--accent-primary)'
                  : '3px solid transparent',
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {active === 'doctor' && <RunPanel kind="doctor" />}
        {active === 'test' && <RunPanel kind="test" />}
        {active === 'logs' && <LogsPanel />}
        {active === 'about' && <AboutPanel />}
      </div>
    </div>
  );
};

// ============================================================
// RunPanel — shared by Doctor + Health test
// ============================================================

interface RunPanelProps {
  kind: 'doctor' | 'test';
}

const RunPanel: FC<RunPanelProps> = ({ kind }) => {
  const client = useDaemonClient();
  const [job, setJob] = useState<{ id: string; startedAt: number } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{
    finishedAt: number;
    exitCode: number | null;
  } | null>(null);

  const streamUrl = job ? client.jobStreamUrl(job.id) : null;
  const stream = useJobStream({ url: streamUrl });
  const done =
    stream.status === 'success' ||
    stream.status === 'failed' ||
    stream.status === 'lost';

  // Capture finishedAt + exitCode once when the stream resolves.
  const lastRunCapturedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job || !done) return;
    if (lastRunCapturedRef.current === job.id) return;
    lastRunCapturedRef.current = job.id;
    setLastRun({ finishedAt: Date.now(), exitCode: stream.exitCode });
  }, [job, done, stream.exitCode]);

  const onRun = useCallback(async () => {
    setSubmitting(true);
    setSubmitErr(null);
    const r = kind === 'doctor' ? await client.postDoctor() : await client.postTest();
    setSubmitting(false);
    if (!r.ok) {
      setSubmitErr(r.error.message);
      return;
    }
    setJob({ id: r.value.job_id, startedAt: Date.now() });
  }, [client, kind]);

  const title = kind === 'doctor' ? 'Doctor' : 'Health test';
  const description =
    kind === 'doctor'
      ? 'Runs `tytus doctor` for a comprehensive diagnostic: auth state, tunnel reachability, gateway probe, MCP wiring, and pod credentials.'
      : 'Runs `tytus test` — a minimal end-to-end check: auth → tunnel → gateway chat completion.';

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 py-4 flex items-start justify-between gap-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
            {description}
          </p>
          {lastRun && (
            <div className="text-[11px] mt-2">
              <span className="text-[var(--text-secondary)]">Last run: </span>
              <RelativeTime ts={lastRun.finishedAt} /> ·{' '}
              <span
                style={{
                  color: lastRun.exitCode === 0 ? '#A5D6A7' : '#FF8A80',
                }}
              >
                exit {lastRun.exitCode ?? '?'}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onRun}
          disabled={submitting || (job !== null && !done)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: 'var(--accent-primary)' }}
        >
          {submitting || (job !== null && !done) ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Run
        </button>
      </div>

      {submitErr && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: 'rgba(244,67,54,0.10)',
            border: '1px solid rgba(244,67,54,0.30)',
            color: '#FFCDD2',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't start {title.toLowerCase()}: {submitErr}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {!job && !submitErr && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{
                background: 'rgba(124,77,255,0.10)',
                border: '1px solid rgba(124,77,255,0.25)',
              }}
            >
              {kind === 'doctor' ? (
                <Stethoscope size={22} className="text-[var(--accent-primary)]" />
              ) : (
                <Activity size={22} className="text-[var(--accent-primary)]" />
              )}
            </div>
            <div className="text-sm">No {title.toLowerCase()} run yet.</div>
            <div className="text-[11px] mt-1 max-w-[320px]">
              Click <strong>Run</strong> to stream the output here. Each
              run is captured on the daemon side and tagged with an exit
              code.
            </div>
          </div>
        )}

        {job && (
          <div
            className="rounded-md overflow-hidden"
            style={{
              background: '#0A0A0A',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              className="px-3 py-2 flex items-center justify-between text-[11px]"
              style={{
                background: 'rgba(255,255,255,0.02)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span className="text-[var(--text-secondary)]">
                {title} · job{' '}
                <span className="font-mono">{job.id.slice(0, 8)}</span> ·{' '}
                <span
                  style={{
                    color:
                      stream.status === 'success'
                        ? '#A5D6A7'
                        : stream.status === 'failed'
                          ? '#FF8A80'
                          : stream.status === 'lost'
                            ? '#FFB74D'
                            : '#9E9E9E',
                  }}
                >
                  {stream.status}
                  {stream.exitCode !== null && ` (exit ${stream.exitCode})`}
                </span>
              </span>
              {done && (
                <button
                  onClick={() => setJob(null)}
                  className="px-2 py-0.5 rounded text-[10px] transition-colors"
                  style={{
                    background: 'var(--bg-hover, rgba(255,255,255,0.04))',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <pre
              className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap p-3"
              style={{
                color: '#A0E0A0',
                margin: 0,
                maxHeight: 'calc(100vh - 320px)',
                overflowY: 'auto',
              }}
            >
              {stream.lines.length === 0 && stream.status === 'subscribing' && (
                <span className="text-[var(--text-secondary)]">
                  Connecting to job stream…
                </span>
              )}
              {stream.lines.slice(-500).join('\n')}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// LogsPanel — daemon + startup log tail
// ============================================================

type LogName = 'daemon' | 'startup';
const LOG_POLL_MS = 2000;
const LOG_KEEP_BYTES = 64 * 1024; // last 64 KiB rendered

const LogsPanel: FC = () => {
  const client = useDaemonClient();
  const [name, setName] = useState<LogName>('daemon');
  const [paused, setPaused] = useState(false);
  const [content, setContent] = useState('');
  const [offset, setOffset] = useState(0);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

  // Reset on log switch.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setContent('');
    setOffset(0);
    setMissing(false);
    setErr(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [name]);

  // Poll loop.
  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const r = await client.getLogs(name, offset);
      if (cancelled) return;
      if (!r.ok) {
        setErr(r.error.message);
        timer = setTimeout(poll, LOG_POLL_MS);
        return;
      }
      setErr(null);
      const chunk: LogChunk = r.value;
      if (chunk.missing) {
        setMissing(true);
      } else {
        setMissing(false);
        if (chunk.chunk.length > 0) {
          setContent((prev) => {
            const merged = prev + chunk.chunk;
            // Cap retained text so very long sessions don't memory-leak.
            return merged.length > LOG_KEEP_BYTES * 2
              ? merged.slice(-LOG_KEEP_BYTES)
              : merged;
          });
        }
        setOffset(chunk.offset + chunk.chunk.length);
      }
      timer = setTimeout(poll, LOG_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, name, offset, paused]);

  // Auto-scroll only when the user is already pinned to the bottom.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [content]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    stickToBottomRef.current = atBottom;
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 py-4 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Logs
        </h2>
        <select
          value={name}
          onChange={(e) => setName(e.target.value as LogName)}
          className="text-xs rounded-md px-2 py-1 outline-none"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        >
          <option value="daemon">daemon</option>
          <option value="startup">startup</option>
        </select>
        <span className="flex-1" />
        <button
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{
            background: paused
              ? 'rgba(255,193,7,0.12)'
              : 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: paused
              ? '1px solid rgba(255,193,7,0.30)'
              : '1px solid var(--border-default)',
            color: paused ? '#FFE082' : 'var(--text-primary)',
          }}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {missing && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: 'rgba(255,193,7,0.10)',
            border: '1px solid rgba(255,193,7,0.30)',
            color: '#FFE082',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Log file <code className="font-mono">{name}</code> doesn't exist
            on this daemon. Start the daemon at least once to create it.
          </span>
        </div>
      )}

      {err && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: 'rgba(244,67,54,0.10)',
            border: '1px solid rgba(244,67,54,0.30)',
            color: '#FFCDD2',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      <pre
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto custom-scrollbar font-mono text-[11px] leading-relaxed whitespace-pre-wrap p-4 m-0"
        style={{
          background: '#0A0A0A',
          color: '#CFCFCF',
          margin: 16,
          borderRadius: 6,
          border: '1px solid var(--border-subtle)',
        }}
      >
        {content || (
          <span className="text-[var(--text-secondary)]">
            {paused ? 'Paused.' : 'Waiting for log output…'}
          </span>
        )}
      </pre>
    </div>
  );
};

// ============================================================
// AboutPanel
// ============================================================

const AboutPanel: FC = () => {
  const daemon = useDaemonStateContext();
  const state = daemon.state;
  const uptime = state ? formatUptime(state.uptime_secs) : '—';

  return (
    <div className="p-6 overflow-y-auto custom-scrollbar h-full">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        About
      </h2>

      <div className="flex flex-col items-center mt-4 mb-6 py-6 rounded-lg"
        style={{
          background: 'var(--bg-card, rgba(255,255,255,0.03))',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
          style={{
            background: 'linear-gradient(135deg, #7C4DFF, #4A148C)',
          }}
        >
          <span className="text-2xl font-bold text-white">T</span>
        </div>
        <div className="text-base font-semibold text-[var(--text-primary)]">
          TytusOS
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
          Web shell for your private AI pod
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <Row label="Daemon PID" value={state?.daemon_pid?.toString() ?? '—'} />
        <Row label="Daemon uptime" value={uptime} />
        <Row label="Tunnel" value={state?.tunnel_active ? 'active' : 'down'} />
        <Row
          label="Keychain"
          value={state?.keychain_healthy ? 'healthy' : 'unhealthy'}
        />
        <Row
          label="Last refresh error"
          value={state?.last_refresh_error ?? 'none'}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <a
          href="https://github.com/traylinx/tytus-cli"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          <ExternalLink size={11} /> tytus-cli on GitHub
        </a>
        <a
          href="https://github.com/traylinx/tytus-os"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          <ExternalLink size={11} /> tytus-os on GitHub
        </a>
      </div>
    </div>
  );
};

const Row: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className="flex items-center justify-between py-1.5 px-3 rounded-md"
    style={{
      background: 'var(--bg-card, rgba(255,255,255,0.03))',
      border: '1px solid var(--border-subtle)',
    }}
  >
    <span className="text-[var(--text-secondary)]">{label}</span>
    <span className="font-mono text-[var(--text-primary)] truncate ml-3">
      {value}
    </span>
  </div>
);

// ============================================================
// Helpers
// ============================================================

const formatUptime = (secs: number): string => {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
};

const RelativeTime: FC<{ ts: number }> = ({ ts }) => {
  // Re-render every 10s so "5s ago" → "15s ago". `now` is held in
  // state so the renderer stays pure — react-hooks/purity rejects
  // calling Date.now() inline.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  return <span>{formatRel(now - ts)}</span>;
};

const formatRel = (deltaMs: number): string => {
  const s = Math.floor(deltaMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
};

export default Help;
