// ============================================================
// Pod Inspector — Fleet Overview + per-pod tabs (Phase 3b chunk 2)
// ============================================================
//
// Top-level layout:
//
//   ┌─ tab strip ────────────────────────────────────┐
//   │ ◀ Fleet │ Pod 02 ◉ × │ Pod 04 × │              │
//   ├────────────────────────────────────────────────┤
//   │  Fleet view OR PodTab body                     │
//   └────────────────────────────────────────────────┘
//
// Fleet view: sortable table of agents + included pods, lazy
// /api/pod/ready probes, search, sort.
//
// PodTab body: status header (dot + agent + units + key fingerprint),
// URL grid (api/public/ui with copy + reveal), env (user_key reveal),
// actions (Restart streamed via run-streamed, Open via /api/pod/open).
// Doctor and the destructive actions (Uninstall / Revoke) ship in a
// later chunk — per-pod doctor is also a known daemon gap (manifest
// §3.7) and revoke needs a typed-name confirmation.
//
// Sort modes (manifest §3.2):
//   - "Needs attention" (default): offline > degraded > running > healthy
//   - "Pod ID": ascending
//
// Status pill colors mirror manifest §11.5; v1 only renders ready /
// not-ready / probe-failed / included since /api/pod/ready is the
// only signal the daemon currently exposes.

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Sparkles,
  Search,
  Loader2,
  ExternalLink,
  RefreshCw,
  Rocket,
  AlertTriangle,
  X,
  Power,
  Copy,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useJobStream } from '@/hooks/useJobStream';
import { navigate } from '@/lib/router';
import {
  maskSecret,
  maskTokenUrl,
  revealSecret,
  revealTokenUrl,
} from '@/lib/secrets';
import type { Agent, IncludedPod } from '@/types/daemon';
import type { DaemonClient } from '@/lib/daemon';

type SortMode = 'attention' | 'pod_id';

interface FleetRow {
  kind: 'agent' | 'included';
  pod_id: string;
  agent_type: string;
  units: number;
  agent?: Agent;
  included?: IncludedPod;
}

type ReadyState = {
  status: 'probing' | 'ready' | 'not_ready' | 'probe_failed' | 'included';
  reason?: string;
};

const STATUS_RANK: Record<ReadyState['status'], number> = {
  probe_failed: 4,
  not_ready: 3,
  probing: 2,
  ready: 1,
  included: 0,
};

const STATUS_VISUAL: Record<
  ReadyState['status'],
  { color: string; label: string }
> = {
  probing: { color: '#9E9E9E', label: 'Probing…' },
  ready: { color: '#4CAF50', label: 'Running' },
  not_ready: { color: '#FFC107', label: 'Not ready' },
  probe_failed: { color: '#F44336', label: 'Offline' },
  included: { color: '#9E9E9E', label: 'Included' },
};

// ============================================================
// Top-level component — owns tab state + ready probe map
// ============================================================

const PodInspector: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();

  // Tab state — 'fleet' is always the leftmost tab; per-pod tabs are
  // appended in click order. Closing a non-fleet tab focuses fleet.
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('fleet');

  // Fleet-wide ready probe map. PodTab also reads this; bumping
  // readyNonce re-fires probes for every open row.
  const [readyByPod, setReadyByPod] = useState<Map<string, ReadyState>>(
    () => new Map(),
  );
  const [readyNonce, setReadyNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [errToast, setErrToast] = useState<string | null>(null);

  const rows: FleetRow[] = useMemo(() => {
    const out: FleetRow[] = [];
    if (!daemon.state) return out;
    for (const a of daemon.state.agents) {
      out.push({
        kind: 'agent',
        pod_id: a.pod_id,
        agent_type: a.agent_type,
        units: a.units,
        agent: a,
      });
    }
    for (const p of daemon.state.included) {
      out.push({
        kind: 'included',
        pod_id: p.pod_id,
        agent_type: p.kind,
        units: 0,
        included: p,
      });
    }
    return out;
  }, [daemon.state]);

  // Probe /api/pod/ready for every agent row whenever rows change or
  // the user clicks Refresh. Included pods are tagged 'included'
  // without a probe — the daemon doesn't surface readiness for them.
  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setReadyByPod((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        if (r.kind === 'included') {
          next.set(r.pod_id, { status: 'included' });
        } else if (!next.has(r.pod_id)) {
          next.set(r.pod_id, { status: 'probing' });
        }
      }
      return next;
    });

    const promises = rows
      .filter((r) => r.kind === 'agent')
      .map(async (r) => {
        const probe = await client.getPodReady(r.pod_id);
        if (cancelled) return;
        setReadyByPod((prev) => {
          const next = new Map(prev);
          if (!probe.ok) {
            next.set(r.pod_id, {
              status: 'probe_failed',
              reason: probe.error.message,
            });
          } else if (probe.value.ready) {
            next.set(r.pod_id, { status: 'ready' });
          } else {
            next.set(r.pod_id, {
              status: 'not_ready',
              reason: probe.value.reason || 'Not ready',
            });
          }
          return next;
        });
      });
    Promise.allSettled(promises);

    return () => {
      cancelled = true;
    };
  }, [client, rows, readyNonce]);

  // Auto-prune closed tabs when the underlying pod disappears (e.g.
  // user revoked from another surface). Don't keep stale references.
  // Deliberate setState-in-effect: we're synchronizing local UI state
  // with the result of an external poll.
  useEffect(() => {
    if (!daemon.state) return;
    const liveIds = new Set(daemon.state.agents.map((a) => a.pod_id));
    /* eslint-disable react-hooks/set-state-in-effect */
    setOpenTabs((prev) => prev.filter((p) => liveIds.has(p)));
    setActiveTab((prev) =>
      prev !== 'fleet' && !liveIds.has(prev) ? 'fleet' : prev,
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [daemon.state]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    daemon.refresh();
    setReadyNonce((n) => n + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, [daemon]);

  const onAllocate = useCallback(() => {
    dispatch({ type: 'OPEN_WINDOW', appId: 'settings' });
    navigate({
      kind: 'settings',
      section: 'agents',
      params: new URLSearchParams(),
    });
  }, [dispatch]);

  const openPodTab = useCallback((podId: string) => {
    setOpenTabs((prev) => (prev.includes(podId) ? prev : [...prev, podId]));
    setActiveTab(podId);
  }, []);

  const closePodTab = useCallback((podId: string) => {
    setOpenTabs((prev) => prev.filter((p) => p !== podId));
    setActiveTab((prev) => (prev === podId ? 'fleet' : prev));
  }, []);

  // Find the agent for the active per-pod tab.
  const activeAgent =
    activeTab !== 'fleet'
      ? daemon.state?.agents.find((a) => a.pod_id === activeTab)
      : undefined;

  return (
    <div
      className="flex flex-col h-full relative"
      style={{ background: 'var(--bg-window)' }}
    >
      <TabStrip
        tabs={openTabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
        onClose={closePodTab}
        agentsByPod={
          daemon.state
            ? new Map(daemon.state.agents.map((a) => [a.pod_id, a]))
            : new Map()
        }
        readyByPod={readyByPod}
      />

      {activeTab === 'fleet' && (
        <FleetView
          rows={rows}
          readyByPod={readyByPod}
          state={daemon.state}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onAllocate={onAllocate}
          onOpenTab={openPodTab}
          onErr={setErrToast}
          client={client}
        />
      )}

      {activeTab !== 'fleet' && activeAgent && (
        <PodTab
          agent={activeAgent}
          ready={readyByPod.get(activeAgent.pod_id)}
          client={client}
          onError={setErrToast}
        />
      )}

      {activeTab !== 'fleet' && !activeAgent && (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
          Pod {activeTab} is no longer allocated.
        </div>
      )}

      {errToast && (
        <FleetErrorToast
          message={errToast}
          onDismiss={() => setErrToast(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// Tab strip
// ============================================================

interface TabStripProps {
  tabs: string[];
  activeTab: string;
  onSelect: (tab: string) => void;
  onClose: (podId: string) => void;
  agentsByPod: Map<string, Agent>;
  readyByPod: Map<string, ReadyState>;
}

const TabStrip: FC<TabStripProps> = ({
  tabs,
  activeTab,
  onSelect,
  onClose,
  agentsByPod,
  readyByPod,
}) => (
  <div
    className="flex items-stretch flex-shrink-0 overflow-x-auto"
    style={{
      background: 'var(--bg-titlebar, rgba(255,255,255,0.02))',
      borderBottom: '1px solid var(--border-subtle)',
    }}
  >
    <button
      onClick={() => onSelect('fleet')}
      className="flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors flex-shrink-0"
      style={{
        background: activeTab === 'fleet' ? 'var(--bg-window)' : 'transparent',
        color:
          activeTab === 'fleet'
            ? 'var(--accent-primary)'
            : 'var(--text-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        borderTop:
          activeTab === 'fleet'
            ? '2px solid var(--accent-primary)'
            : '2px solid transparent',
      }}
    >
      <Box size={12} />
      Fleet
    </button>
    {tabs.map((podId) => {
      const agent = agentsByPod.get(podId);
      const ready = readyByPod.get(podId);
      const visual = ready ? STATUS_VISUAL[ready.status] : null;
      const active = activeTab === podId;
      return (
        <div
          key={podId}
          className="flex items-stretch flex-shrink-0"
          style={{
            background: active ? 'var(--bg-window)' : 'transparent',
            borderRight: '1px solid var(--border-subtle)',
            borderTop: active
              ? '2px solid var(--accent-primary)'
              : '2px solid transparent',
          }}
        >
          <button
            onClick={() => onSelect(podId)}
            className="flex items-center gap-2 pl-4 pr-2 py-2 text-xs font-medium transition-colors"
            style={{
              color: active
                ? 'var(--accent-primary)'
                : 'var(--text-secondary)',
            }}
          >
            {visual && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: visual.color }}
              />
            )}
            Pod {podId}
            {agent && (
              <span
                className="text-[10px] opacity-70"
                style={{ color: 'var(--text-secondary)' }}
              >
                · {agent.agent_type}
              </span>
            )}
          </button>
          <button
            onClick={() => onClose(podId)}
            aria-label={`Close pod ${podId} tab`}
            className="px-2 transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={11} />
          </button>
        </div>
      );
    })}
  </div>
);

// ============================================================
// Fleet view — table + search + sort + empty state
// ============================================================

interface FleetViewProps {
  rows: FleetRow[];
  readyByPod: Map<string, ReadyState>;
  state: import('@/types/daemon').StateSnapshot | null;
  refreshing: boolean;
  onRefresh: () => void;
  onAllocate: () => void;
  onOpenTab: (podId: string) => void;
  onErr: (msg: string) => void;
  client: DaemonClient;
}

const FleetView: FC<FleetViewProps> = ({
  rows,
  readyByPod,
  state,
  refreshing,
  onRefresh,
  onAllocate,
  onOpenTab,
  onErr,
  client,
}) => {
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('attention');
  const [openingPod, setOpeningPod] = useState<string | null>(null);

  const onOpenAgentUi = useCallback(
    async (podId: string) => {
      setOpeningPod(podId);
      const r = await client.postPodOpen(podId);
      setOpeningPod((p) => (p === podId ? null : p));
      if (!r.ok) onErr(`Couldn't open pod ${podId}: ${r.error.message}`);
    },
    [client, onErr],
  );

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = q
      ? rows.filter(
          (r) =>
            r.pod_id.toLowerCase().includes(q) ||
            r.agent_type.toLowerCase().includes(q),
        )
      : [...rows];

    if (sortMode === 'attention') {
      out.sort((a, b) => {
        const sa = readyByPod.get(a.pod_id)?.status ?? 'probing';
        const sb = readyByPod.get(b.pod_id)?.status ?? 'probing';
        const r = STATUS_RANK[sb] - STATUS_RANK[sa];
        if (r !== 0) return r;
        return a.pod_id.localeCompare(b.pod_id);
      });
    } else {
      out.sort((a, b) => a.pod_id.localeCompare(b.pod_id));
    }

    return out;
  }, [rows, search, sortMode, readyByPod]);

  const isEmpty = !state || rows.length === 0;

  return (
    <>
      <div
        className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <Box size={18} className="text-[var(--accent-primary)]" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Fleet Overview
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            {state ? (
              <>
                {state.agents.length} allocated · {state.included.length}{' '}
                included · {state.units_used}/{state.units_limit} units
              </>
            ) : (
              'Loading state…'
            )}
          </div>
        </div>
        <button
          onClick={onRefresh}
          aria-label="Refresh"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-colors"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
          }}
        >
          <RefreshCw
            size={11}
            className={refreshing ? 'animate-spin' : undefined}
          />
          Refresh
        </button>
        <button
          onClick={onAllocate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
          style={{ background: 'var(--accent-primary)' }}
        >
          + Allocate
        </button>
      </div>

      {!isEmpty && (
        <div
          className="px-5 py-2 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div
            className="flex items-center gap-2 flex-1 px-2.5 py-1 rounded-md"
            style={{ background: 'var(--bg-input)' }}
          >
            <Search size={12} className="text-[var(--text-secondary)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pods…"
              className="flex-1 bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]"
            />
          </div>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="text-xs rounded-md px-2 py-1 outline-none"
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
            }}
          >
            <option value="attention">Sort: Needs attention</option>
            <option value="pod_id">Sort: Pod ID</option>
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isEmpty && (
          <div className="h-full flex items-center justify-center p-8">
            <div
              className="w-[420px] rounded-2xl p-8 flex flex-col items-center text-center"
              style={{
                background: 'rgba(30,30,30,0.65)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{
                  background: 'linear-gradient(135deg, #7C4DFF, #4A148C)',
                }}
              >
                <Rocket size={28} className="text-white" />
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)]">
                No pods yet
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-[300px] leading-relaxed">
                Once you allocate a pod, it'll appear here with live
                status, links, and per-pod actions.
              </div>
              <button
                onClick={onAllocate}
                className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
                style={{ background: 'var(--accent-primary)' }}
              >
                Allocate your first pod →
              </button>
            </div>
          </div>
        )}

        {!isEmpty && (
          <table className="w-full text-xs">
            <thead
              className="text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="text-left px-5 py-2 font-medium">Pod</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Agent</th>
                <th className="text-right px-3 py-2 font-medium">Units</th>
                <th className="text-right px-5 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row) => {
                const ready = readyByPod.get(row.pod_id) ?? {
                  status: 'probing' as const,
                };
                const visual = STATUS_VISUAL[ready.status];
                const isAgent = row.kind === 'agent';
                return (
                  <tr
                    key={`${row.kind}-${row.pod_id}`}
                    className="transition-colors cursor-pointer"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    onClick={() => isAgent && onOpenTab(row.pod_id)}
                  >
                    <td className="px-5 py-2.5">
                      <div className="text-[var(--text-primary)] font-medium">
                        Pod {row.pod_id}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex items-center gap-1.5"
                        title={ready.reason ?? visual.label}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: visual.color }}
                        />
                        <span style={{ color: visual.color }}>
                          {visual.label}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[var(--text-primary)]">
                        {row.kind === 'included' ? (
                          <Sparkles
                            size={12}
                            className="text-[var(--text-secondary)]"
                          />
                        ) : (
                          <Box
                            size={12}
                            className="text-[var(--accent-primary)]"
                          />
                        )}
                        {row.agent_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[var(--text-secondary)]">
                      {row.kind === 'included' ? '—' : row.units}
                    </td>
                    <td
                      className="px-5 py-2.5 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isAgent && (
                        <button
                          onClick={() => onOpenAgentUi(row.pod_id)}
                          disabled={openingPod === row.pod_id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-60"
                          style={{
                            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
                            border: '1px solid var(--border-default)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {openingPod === row.pod_id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <ExternalLink size={11} />
                          )}
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredSorted.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-6 text-center text-[var(--text-secondary)]"
                  >
                    No pods match "{search}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

// ============================================================
// PodTab — per-pod view with status / URLs / env / actions
// ============================================================

interface PodTabProps {
  agent: Agent;
  ready: ReadyState | undefined;
  client: DaemonClient;
  onError: (msg: string) => void;
}

const PodTab: FC<PodTabProps> = ({ agent, ready, client, onError }) => {
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [uiRevealed, setUiRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<{
    id: string;
    action: string;
  } | null>(null);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  const visual = ready ? STATUS_VISUAL[ready.status] : STATUS_VISUAL.probing;

  const copyToClipboard = useCallback(
    async (label: string, value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(label);
        setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
      } catch {
        // noop in non-secure contexts
      }
    },
    [],
  );

  const onOpenAgent = useCallback(async () => {
    setSubmittingAction('open');
    const r = await client.postPodOpen(agent.pod_id);
    setSubmittingAction(null);
    if (!r.ok) onError(`Couldn't open pod: ${r.error.message}`);
  }, [client, agent.pod_id, onError]);

  const onRestart = useCallback(async () => {
    setSubmittingAction('restart');
    const r = await client.postPodRunStreamed(agent.pod_id, 'restart');
    setSubmittingAction(null);
    if (!r.ok) {
      onError(`Couldn't start restart: ${r.error.message}`);
      return;
    }
    setActiveJob({ id: r.value.job_id, action: 'restart' });
  }, [client, agent.pod_id, onError]);

  const streamUrl = activeJob ? client.jobStreamUrl(activeJob.id) : null;
  const stream = useJobStream({ url: streamUrl });
  const streamDone =
    stream.status === 'success' ||
    stream.status === 'failed' ||
    stream.status === 'lost';

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
      {/* Status header */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Box size={28} className="text-[var(--accent-primary)]" />
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
            style={{
              background: visual.color,
              boxShadow: '0 0 0 2px var(--bg-window, #1E1E1E)',
            }}
            title={ready?.reason ?? visual.label}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-[var(--text-primary)]">
            Pod {agent.pod_id} · {agent.agent_type}
          </div>
          <div className="text-[11px] mt-0.5">
            <span style={{ color: visual.color }}>{visual.label}</span>
            {ready?.reason && (
              <span className="text-[var(--text-secondary)]">
                {' '}
                — {ready.reason}
              </span>
            )}
            <span className="text-[var(--text-secondary)]">
              {' '}
              · {agent.units} unit{agent.units === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      {/* URLs + env */}
      <div
        className="rounded-lg p-4"
        style={{
          background: 'var(--bg-card, rgba(255,255,255,0.03))',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          Connection
        </div>
        <div className="grid grid-cols-[80px_1fr_auto] gap-x-2 gap-y-2 text-[11px] items-center">
          <span className="text-[var(--text-secondary)]">API URL</span>
          <code
            className="font-mono text-[var(--text-primary)] truncate"
            style={{
              background: 'rgba(255,255,255,0.03)',
              padding: '3px 8px',
              borderRadius: 3,
            }}
            title={agent.api_url}
          >
            {agent.api_url}
          </code>
          <CopyBtn
            label="api"
            isCopied={copied === 'api'}
            onClick={() => copyToClipboard('api', agent.api_url)}
          />

          <span className="text-[var(--text-secondary)]">Public</span>
          <code
            className="font-mono text-[var(--text-primary)] truncate"
            style={{
              background: 'rgba(255,255,255,0.03)',
              padding: '3px 8px',
              borderRadius: 3,
            }}
            title={agent.public_url}
          >
            {agent.public_url}
          </code>
          <CopyBtn
            label="public"
            isCopied={copied === 'public'}
            onClick={() => copyToClipboard('public', agent.public_url)}
          />

          <span className="text-[var(--text-secondary)]">UI URL</span>
          <code
            className="font-mono text-[var(--text-primary)] truncate"
            style={{
              background: 'rgba(255,255,255,0.03)',
              padding: '3px 8px',
              borderRadius: 3,
            }}
          >
            {uiRevealed
              ? revealTokenUrl(agent.ui_url, 'user_gesture')
              : maskTokenUrl(agent.ui_url)}
          </code>
          <div className="flex items-center gap-1">
            <RevealBtn
              revealed={uiRevealed}
              onToggle={() => setUiRevealed((v) => !v)}
            />
            <CopyBtn
              label="ui"
              isCopied={copied === 'ui'}
              onClick={() =>
                copyToClipboard(
                  'ui',
                  revealTokenUrl(agent.ui_url, 'user_gesture'),
                )
              }
            />
          </div>

          <span className="text-[var(--text-secondary)]">Key</span>
          <code
            className="font-mono text-[var(--text-primary)] truncate"
            style={{
              background: 'rgba(255,255,255,0.03)',
              padding: '3px 8px',
              borderRadius: 3,
            }}
          >
            {keyRevealed
              ? revealSecret(agent.user_key, 'user_gesture')
              : maskSecret(agent.user_key)}
          </code>
          <div className="flex items-center gap-1">
            <RevealBtn
              revealed={keyRevealed}
              onToggle={() => setKeyRevealed((v) => !v)}
            />
            <CopyBtn
              label="key"
              isCopied={copied === 'key'}
              onClick={() =>
                copyToClipboard(
                  'key',
                  revealSecret(agent.user_key, 'user_gesture'),
                )
              }
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div>
        <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          Actions
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            label="Open agent UI"
            icon={<ExternalLink size={12} />}
            running={submittingAction === 'open'}
            onClick={onOpenAgent}
          />
          <ActionButton
            label="Restart"
            icon={<Power size={12} />}
            running={submittingAction === 'restart' || (activeJob?.action === 'restart' && !streamDone)}
            disabled={activeJob !== null && !streamDone}
            onClick={onRestart}
          />
          <span
            className="text-[10px] text-[var(--text-secondary)] self-center ml-2"
          >
            More actions (Doctor, Stop forwarder, Uninstall, Revoke) land in a future update.
          </span>
        </div>
      </div>

      {/* Live job stream — appears below actions when one runs */}
      {activeJob && (
        <div
          className="rounded-lg overflow-hidden"
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
            <div className="text-[var(--text-secondary)]">
              {activeJob.action} ·{' '}
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
            </div>
            {streamDone && (
              <button
                onClick={() => setActiveJob(null)}
                className="px-2 py-0.5 rounded text-[10px] transition-colors"
                style={{
                  background: 'var(--bg-hover, rgba(255,255,255,0.04))',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                Dismiss
              </button>
            )}
          </div>
          <pre
            className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap p-3"
            style={{
              color: '#A0E0A0',
              maxHeight: 300,
              overflowY: 'auto',
              margin: 0,
            }}
          >
            {stream.lines.length === 0 && stream.status === 'subscribing' && (
              <span className="text-[var(--text-secondary)]">
                Connecting to job stream…
              </span>
            )}
            {stream.lines.slice(-200).join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Reusable mini-components
// ============================================================

const CopyBtn: FC<{
  label: string;
  isCopied: boolean;
  onClick: () => void;
}> = ({ label, isCopied, onClick }) => (
  <button
    onClick={onClick}
    aria-label={`Copy ${label}`}
    className="p-1 rounded transition-colors"
    style={{
      background: isCopied ? 'rgba(76,175,80,0.18)' : 'transparent',
      color: isCopied ? '#A5D6A7' : 'var(--text-secondary)',
    }}
  >
    {isCopied ? <Check size={12} /> : <Copy size={12} />}
  </button>
);

const RevealBtn: FC<{
  revealed: boolean;
  onToggle: () => void;
}> = ({ revealed, onToggle }) => (
  <button
    onClick={onToggle}
    aria-label={revealed ? 'Hide value' : 'Show value'}
    className="p-1 rounded transition-colors"
    style={{ background: 'transparent', color: 'var(--text-secondary)' }}
  >
    {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
  </button>
);

const ActionButton: FC<{
  label: string;
  icon: React.ReactNode;
  running?: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, icon, running, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={running || disabled}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-60"
    style={{
      background: 'var(--bg-hover, rgba(255,255,255,0.04))',
      border: '1px solid var(--border-default)',
      color: 'var(--text-primary)',
    }}
  >
    {running ? <Loader2 size={12} className="animate-spin" /> : icon}
    {label}
  </button>
);

const FleetErrorToast: FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => {
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (dismissedRef.current) return;
    const t = setTimeout(() => {
      dismissedRef.current = true;
      onDismiss();
    }, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-md text-xs flex items-center gap-2"
      style={{
        background: 'rgba(244,67,54,0.92)',
        color: '#fff',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        zIndex: 10,
      }}
    >
      <AlertTriangle size={12} />
      {message}
    </div>
  );
};

export default PodInspector;
