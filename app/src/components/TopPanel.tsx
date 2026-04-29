// ============================================================
// TopPanel — Activities button, clock, system tray, daemon status pill
// ============================================================

import { useState, useEffect, useCallback, memo, useRef, useMemo } from 'react';
import { format } from 'date-fns';
import { Power, Box } from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { computePill } from '@/lib/statusPill';

const PILL_BG: Record<string, string> = {
  green: 'rgba(76, 175, 80, 0.16)',
  yellow: 'rgba(255, 193, 7, 0.18)',
  red: 'rgba(244, 67, 54, 0.18)',
  gray: 'rgba(158, 158, 158, 0.16)',
};
const PILL_DOT: Record<string, string> = {
  green: '#4CAF50',
  yellow: '#FFC107',
  red: '#F44336',
  gray: '#9E9E9E',
};
const PILL_TEXT: Record<string, string> = {
  green: '#A5D6A7',
  yellow: '#FFE082',
  red: '#FFCDD2',
  gray: '#E0E0E0',
};

const TopPanel = memo(function TopPanel() {
  const { state, dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const pill = computePill(daemon.status, daemon.state, daemon.error);

  const [time, setTime] = useState(new Date());
  const [sysMenuOpen, setSysMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!sysMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSysMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sysMenuOpen]);

  const handleActivities = useCallback(() => {
    dispatch({ type: 'TOGGLE_APP_LAUNCHER' });
  }, [dispatch]);

  const handleClockClick = useCallback(() => {
    dispatch({ type: 'TOGGLE_NOTIFICATION_CENTER' });
  }, [dispatch]);

  const handleSignOut = useCallback(async () => {
    setSysMenuOpen(false);
    setSigningOut(true);
    setSignOutError(null);
    const r = await client.postLogout();
    setSigningOut(false);
    if (!r.ok) {
      setSignOutError(r.error.message);
      return;
    }
    dispatch({ type: 'LOGOUT' });
    daemon.refresh();
  }, [client, dispatch, daemon]);

  const formattedTime = format(time, 'EEE h:mm a');
  const formattedDate = format(time, 'EEEE, MMMM d, yyyy');
  const userLabel = daemon.state?.email ?? state.auth.userName;

  // Fleet health summary — small clickable chip next to the daemon
  // pill. Per manifest §2.2 the strip should reflect aggregate pod
  // status; v1 derives from state.agents/included counts + active
  // jobs because /api/state.agents has no per-pod status field. Color
  // logic: any active job → blue (in progress); all good → green;
  // no pods → grey (still clickable, opens Pod Inspector).
  const fleet = useMemo(() => {
    if (!daemon.state) return null;
    const agents = daemon.state.agents.length;
    const included = daemon.state.included.length;
    const totalPods = agents + included;
    const activeJobs = Object.values(daemon.state.active_jobs_per_pod).reduce(
      (sum, jobs) => sum + (Array.isArray(jobs) ? jobs.length : 0),
      0,
    );
    let color: 'green' | 'yellow' | 'gray' = 'gray';
    if (totalPods > 0) color = activeJobs > 0 ? 'yellow' : 'green';
    return { agents, included, totalPods, activeJobs, color };
  }, [daemon.state]);

  const openPodInspector = useCallback(() => {
    dispatch({ type: 'OPEN_WINDOW', appId: 'pod-inspector' });
  }, [dispatch]);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[200] grid items-center px-2 text-xs font-medium select-none"
      style={{
        height: 28,
        gridTemplateColumns: '1fr auto 1fr',
        background: 'var(--bg-panel)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Left: Apps + status pill */}
      <div className="flex items-center justify-self-start gap-2">
        <button
          onClick={handleActivities}
          aria-label="Open app launcher"
          title="Open app launcher (Super)"
          className="h-6 px-2.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors text-xs font-medium flex items-center"
        >
          Apps
        </button>

        {/* Daemon status pill — green/yellow/red/gray */}
        <button
          onClick={() => dispatch({ type: 'OPEN_WINDOW', appId: 'settings' })}
          title={pill.detail}
          aria-label={`Daemon ${pill.label}: ${pill.detail}`}
          className="h-6 pl-1.5 pr-2 rounded-md flex items-center gap-1.5 transition-colors"
          style={{
            background: PILL_BG[pill.color],
            color: PILL_TEXT[pill.color],
          }}
        >
          <span
            className="w-2 h-2 rounded-full inline-block"
            style={{ background: PILL_DOT[pill.color] }}
            aria-hidden="true"
          />
          <span className="text-[11px] font-semibold">{pill.label}</span>
        </button>

        {/* Fleet Health strip — only when daemon is online; suppressed
            during offline since DaemonOfflineBanner already covers that
            state at the shell level. */}
        {fleet && pill.color !== 'red' && (
          <button
            onClick={openPodInspector}
            title={
              fleet.totalPods === 0
                ? 'No pods yet — click to allocate'
                : `${fleet.agents} allocated · ${fleet.included} included · ${fleet.activeJobs} active job${fleet.activeJobs === 1 ? '' : 's'}`
            }
            aria-label="Open Pod Inspector"
            className="h-6 pl-1.5 pr-2 rounded-md flex items-center gap-1.5 transition-colors"
            style={{
              background: PILL_BG[fleet.color],
              color: PILL_TEXT[fleet.color],
            }}
          >
            <Box size={11} aria-hidden="true" />
            <span className="text-[11px] font-semibold">
              {fleet.totalPods === 0
                ? 'No pods'
                : `${fleet.totalPods} pod${fleet.totalPods === 1 ? '' : 's'}`}
              {fleet.activeJobs > 0 && (
                <span className="opacity-90"> · {fleet.activeJobs} job{fleet.activeJobs === 1 ? '' : 's'}</span>
              )}
            </span>
          </button>
        )}
      </div>

      {/* Center: Clock */}
      <button
        onClick={handleClockClick}
        aria-label={`${formattedTime} — open notification center`}
        className="h-6 px-2 rounded-md hover:bg-[var(--bg-hover)] transition-colors text-xs font-medium group relative whitespace-nowrap justify-self-center flex items-center"
      >
        <span>{formattedTime}</span>
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 rounded-sm bg-[var(--bg-tooltip)] text-[var(--text-primary)] text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[5000]">
          {formattedDate}
        </div>
      </button>

      {/* Right: System menu */}
      <div className="flex items-center gap-1 justify-self-end">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setSysMenuOpen(!sysMenuOpen)}
            aria-label="System menu"
            aria-expanded={sysMenuOpen}
            className="h-6 px-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors flex items-center"
          >
            <Power size={14} />
          </button>

          {sysMenuOpen && (
            <div
              className="absolute top-full right-0 mt-1 py-2 rounded-xl z-[5000]"
              style={{
                background: 'var(--bg-context-menu)',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--border-default)',
                width: 280,
                animation: 'menuAppear 120ms cubic-bezier(0, 0, 0.2, 1)',
              }}
            >
              <div className="flex items-center gap-2 px-3 py-2 mb-1">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7C4DFF, #4A148C)' }}>
                  <span className="text-white text-xs font-bold">
                    {userLabel.slice(0, 1).toUpperCase()}
                  </span>
                </div>
                <span className="text-sm font-medium flex-1 truncate">{userLabel}</span>
                <button
                  className="w-7 h-7 rounded-sm flex items-center justify-center hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setSysMenuOpen(false);
                    dispatch({ type: 'OPEN_WINDOW', appId: 'settings' });
                  }}
                  aria-label="Open Settings"
                >
                  <span className="text-xs">⚙</span>
                </button>
              </div>

              <div className="my-1 mx-2" style={{ height: 1, background: 'var(--border-subtle)' }} />

              <div className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: PILL_DOT[pill.color] }}
                  />
                  <span className="font-semibold" style={{ color: PILL_TEXT[pill.color] }}>
                    {pill.label}
                  </span>
                </div>
                <div className="text-[10px] opacity-80 mt-0.5">{pill.detail}</div>
              </div>

              <div className="my-1 mx-2" style={{ height: 1, background: 'var(--border-subtle)' }} />

              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-hover)] transition-colors text-left"
                onClick={() => { setSysMenuOpen(false); dispatch({ type: 'LOCK' }); }}
              >
                <span>🔒</span>
                Lock screen
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-hover)] transition-colors text-left disabled:opacity-60"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                <span>🚪</span>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
              {signOutError && (
                <div className="px-3 py-1 text-[10px]" style={{ color: '#FFCDD2' }}>
                  {signOutError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes menuAppear {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
});

export default TopPanel;
