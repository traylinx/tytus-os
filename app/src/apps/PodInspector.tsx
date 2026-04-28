// ============================================================
// Pod Inspector — Fleet Overview (Phase 3b chunk 1)
// ============================================================
//
// Default route: Fleet Overview. Shows every allocated agent + every
// included pod in a sortable, filterable table. Per-pod tabs land in
// the next chunk; for now, the row Open action calls /api/pod/open
// (same as Settings → Pods) and the daemon URL fields are surfaced via
// the existing PodCard pattern in Settings if the user wants details.
//
// Sort modes (manifest §3.2):
//   - "Needs attention" (default): offline > degraded > running > healthy
//   - "Pod ID": ascending
//
// Status pill colors mirror the manifest §11.5 vocabulary, but v1 only
// renders ready / not-ready / probe-failed / included since that's all
// /api/pod/ready can tell us. "starting" / "degraded" detection waits
// on Phase 3b chunk 2 (per-pod active-job awareness).

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
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { navigate } from '@/lib/router';
import type { Agent, IncludedPod } from '@/types/daemon';

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

const PodInspector: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('attention');
  const [readyByPod, setReadyByPod] = useState<Map<string, ReadyState>>(
    () => new Map(),
  );
  // Bumped on Refresh click; the per-pod probe effect re-runs when it
  // changes, so the ready dots reflect a fresh probe immediately.
  const [readyNonce, setReadyNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [openingPod, setOpeningPod] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);

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

  // Fleet-wide /api/pod/ready probe. Lazy + parallel; included pods are
  // tagged 'included' without a probe (they're managed by the platform,
  // not the user, so a per-pod readiness signal isn't meaningful).
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

  const onOpenPod = useCallback(
    async (podId: string) => {
      setOpeningPod(podId);
      setOpenErr(null);
      const r = await client.postPodOpen(podId);
      setOpeningPod((p) => (p === podId ? null : p));
      if (!r.ok) setOpenErr(`Couldn't open pod ${podId}: ${r.error.message}`);
    },
    [client],
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

  // Empty state: no pods at all → big CTA matching the desktop overlay.
  const isEmpty = !daemon.state || rows.length === 0;

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-window)' }}
    >
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
            {daemon.state ? (
              <>
                {daemon.state.agents.length} allocated ·{' '}
                {daemon.state.included.length} included ·{' '}
                {daemon.state.units_used}/{daemon.state.units_limit} units
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
                return (
                  <tr
                    key={`${row.kind}-${row.pod_id}`}
                    className="transition-colors"
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
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
                    <td className="px-5 py-2.5 text-right">
                      {row.kind === 'agent' && (
                        <button
                          onClick={() => onOpenPod(row.pod_id)}
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

      {openErr && (
        <FleetErrorToast
          message={openErr}
          onDismiss={() => setOpenErr(null)}
        />
      )}
    </div>
  );
};

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
