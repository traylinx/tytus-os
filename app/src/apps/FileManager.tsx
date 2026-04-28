// ============================================================
// Files — Pod inbox + Downloads (Phase 5, manifest §7)
// ============================================================
//
// Layout (subset of manifest §7.2 — Shared tab deferred):
//
//   ┌─ sidebar ────────┬─ tab strip ──────────────────────┐
//   │ Pods             │ ▶ Inbox  ▶ Downloads             │
//   │ ● Pod 02 ◉       ├──────────────────────────────────┤
//   │ ○ Pod 04         │  Inbox: live ls /app/workspace/  │
//   │                  │         inbox via run-streamed   │
//   │                  │  Downloads: opens ~/Downloads/   │
//   │                  │         tytus/pod-NN/ in Finder  │
//   └──────────────────┴──────────────────────────────────┘
//
// Sidebar lists state.agents only. Included pods (AIL pods) don't
// have an inbox dir — manifest §7.2 confirms scope is per-agent.
//
// Inbox uses POST /api/pod/{id}/run-streamed action=ls-inbox →
// useJobStream subscribes to the SSE log; lines render verbatim
// in a monospace pane. Auto-fires on tab mount + on pod switch.
//
// Downloads CTA → POST /api/files/open-downloads?pod=NN; daemon
// opens ~/Downloads/tytus/pod-NN/ in Finder.
//
// Hash deep-link: #/pod/02/files focuses pod 02 on mount via a
// once-only ref.

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Folder,
  FileText,
  RefreshCw,
  Loader2,
  ExternalLink,
  Inbox,
  Download,
  AlertTriangle,
  Box,
  Rocket,
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useJobStream } from '@/hooks/useJobStream';
import { useHashRoute } from '@/hooks/useHashRoute';
import { navigate } from '@/lib/router';
import type { Agent } from '@/types/daemon';
import type { DaemonClient } from '@/lib/daemon';

type TabId = 'inbox' | 'downloads';

const FileManager: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const route = useHashRoute();

  const agents = useMemo(
    () => daemon.state?.agents ?? [],
    [daemon.state],
  );

  // Selected pod — defaults to first allocated agent. Cleared if
  // the agent disappears (e.g. revoked from another surface).
  const [selectedPodId, setSelectedPodId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('inbox');

  // Hash deep-link consumer — fires once on mount when the route
  // is `#/pod/NN/files`.
  const consumedHashRef = useRef(false);
  useEffect(() => {
    if (consumedHashRef.current) return;
    if (route.kind === 'pod' && route.action === 'files') {
      consumedHashRef.current = true;
      // Deliberate setState-in-effect: syncing local UI state from
      // a one-shot route event.
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setSelectedPodId(route.podId);
    }
  }, [route]);

  // Auto-pick first agent when none selected, and prune selection
  // when the chosen pod disappears from state.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (agents.length === 0) {
      if (selectedPodId !== null) setSelectedPodId(null);
      return;
    }
    const stillThere = agents.some((a) => a.pod_id === selectedPodId);
    if (!stillThere) {
      setSelectedPodId(agents[0].pod_id);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [agents, selectedPodId]);

  const selectedAgent = agents.find((a) => a.pod_id === selectedPodId) ?? null;

  const onAllocate = useCallback(() => {
    dispatch({ type: 'OPEN_WINDOW', appId: 'settings' });
    navigate({
      kind: 'settings',
      section: 'agents',
      params: new URLSearchParams(),
    });
  }, [dispatch]);

  // Empty state — no agents at all.
  if (agents.length === 0) {
    return (
      <div
        className="flex flex-col h-full"
        style={{ background: 'var(--bg-window)' }}
      >
        <Header podId={null} agentType={null} />
        <div className="flex-1 flex items-center justify-center p-8">
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
              No pods.
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-[300px] leading-relaxed">
              Allocate a pod first — then its inbox and Downloads folder
              will appear here.
            </div>
            <button
              onClick={onAllocate}
              className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{ background: 'var(--accent-primary)' }}
            >
              Allocate a pod →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-window)' }}
    >
      <Header
        podId={selectedAgent?.pod_id ?? null}
        agentType={selectedAgent?.agent_type ?? null}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          agents={agents}
          selectedPodId={selectedPodId}
          onSelect={setSelectedPodId}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedAgent ? (
            <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
              Select a pod from the left.
            </div>
          ) : (
            <PodPane
              agent={selectedAgent}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              client={client}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Header — small status bar above the split layout
// ============================================================

const Header: FC<{
  podId: string | null;
  agentType: string | null;
}> = ({ podId, agentType }) => (
  <div
    className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
    style={{ borderBottom: '1px solid var(--border-subtle)' }}
  >
    <Folder size={18} className="text-[var(--accent-primary)]" />
    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold text-[var(--text-primary)]">
        Files{podId ? ` — Pod ${podId}` : ''}
      </div>
      <div className="text-[11px] text-[var(--text-secondary)] truncate">
        {podId
          ? `Inbox + Downloads · ${agentType ?? 'agent'}`
          : 'Per-pod inbox and local Downloads folder'}
      </div>
    </div>
  </div>
);

// ============================================================
// Sidebar — pod picker (agents only)
// ============================================================

const Sidebar: FC<{
  agents: Agent[];
  selectedPodId: string | null;
  onSelect: (podId: string) => void;
}> = ({ agents, selectedPodId, onSelect }) => (
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
      Pods
    </div>
    {agents.map((a) => {
      const active = a.pod_id === selectedPodId;
      return (
        <button
          key={a.pod_id}
          onClick={() => onSelect(a.pod_id)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors text-left"
          style={{
            background: active ? 'var(--bg-selected)' : 'transparent',
            color: active
              ? 'var(--accent-primary)'
              : 'var(--text-primary)',
            borderLeft: active
              ? '3px solid var(--accent-primary)'
              : '3px solid transparent',
          }}
        >
          <Box
            size={14}
            className={
              active
                ? 'text-[var(--accent-primary)]'
                : 'text-[var(--text-secondary)]'
            }
          />
          <span className="flex-1 truncate">Pod {a.pod_id}</span>
          <span
            className="text-[10px]"
            style={{
              color: active
                ? 'var(--accent-primary)'
                : 'var(--text-secondary)',
              opacity: 0.7,
            }}
          >
            {a.agent_type}
          </span>
        </button>
      );
    })}
  </div>
);

// ============================================================
// PodPane — tab strip + active tab body for one pod
// ============================================================

interface PodPaneProps {
  agent: Agent;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  client: DaemonClient;
}

const PodPane: FC<PodPaneProps> = ({ agent, activeTab, onTabChange, client }) => (
  <>
    <TabStrip activeTab={activeTab} onSelect={onTabChange} />
    <div className="flex-1 overflow-hidden flex flex-col">
      {activeTab === 'inbox' && <InboxTab agent={agent} client={client} />}
      {activeTab === 'downloads' && (
        <DownloadsTab agent={agent} client={client} />
      )}
    </div>
  </>
);

const TabStrip: FC<{
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
}> = ({ activeTab, onSelect }) => {
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'inbox', label: 'Inbox', icon: <Inbox size={12} /> },
    { id: 'downloads', label: 'Downloads', icon: <Download size={12} /> },
  ];
  return (
    <div
      className="flex items-stretch flex-shrink-0"
      style={{
        background: 'var(--bg-titlebar, rgba(255,255,255,0.02))',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {tabs.map((t) => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors"
            style={{
              background: active ? 'var(--bg-window)' : 'transparent',
              color: active
                ? 'var(--accent-primary)'
                : 'var(--text-secondary)',
              borderRight: '1px solid var(--border-subtle)',
              borderTop: active
                ? '2px solid var(--accent-primary)'
                : '2px solid transparent',
            }}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
};

// ============================================================
// InboxTab — auto-fires ls-inbox on mount + on pod switch
// ============================================================

const InboxTab: FC<{ agent: Agent; client: DaemonClient }> = ({
  agent,
  client,
}) => {
  const [job, setJob] = useState<{ id: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setSubmitting(true);
    setSubmitErr(null);
    setJob(null);
    const r = await client.postPodRunStreamed(agent.pod_id, 'ls-inbox');
    setSubmitting(false);
    if (!r.ok) {
      setSubmitErr(r.error.message);
      return;
    }
    setJob({ id: r.value.job_id });
  }, [client, agent.pod_id]);

  // Auto-fire on tab mount + when pod changes. Reset job state so
  // a stale stream from the previous pod doesn't leak through.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setSubmitting(true);
      setSubmitErr(null);
      setJob(null);
      const r = await client.postPodRunStreamed(agent.pod_id, 'ls-inbox');
      if (cancelled) return;
      setSubmitting(false);
      if (!r.ok) {
        setSubmitErr(r.error.message);
        return;
      }
      setJob({ id: r.value.job_id });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client, agent.pod_id]);

  const streamUrl = job ? client.jobStreamUrl(job.id) : null;
  const stream = useJobStream({ url: streamUrl });
  const done =
    stream.status === 'success' ||
    stream.status === 'failed' ||
    stream.status === 'lost';
  const inFlight = submitting || (job !== null && !done);

  // After exit, if we never received any non-empty lines, treat as
  // empty inbox. Filter blank lines so a trailing newline from the
  // remote `ls` doesn't masquerade as a file.
  const lines = stream.lines.filter((l) => l.length > 0);
  const isEmptyResult =
    done && stream.status !== 'failed' && stream.status !== 'lost' && lines.length === 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Folder size={14} className="text-[var(--accent-primary)]" />
            inbox/
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
            <code className="font-mono">/app/workspace/inbox/</code>{' '}
            on pod {agent.pod_id}
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={inFlight}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] transition-colors disabled:opacity-60"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
          }}
        >
          {inFlight ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          Refresh inbox
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
          <span>Couldn't list inbox: {submitErr}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {!job && submitting && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
            <Loader2
              size={20}
              className="animate-spin mb-2 text-[var(--accent-primary)]"
            />
            <div className="text-xs">Listing inbox…</div>
          </div>
        )}

        {isEmptyResult && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{
                background: 'rgba(124,77,255,0.10)',
                border: '1px solid rgba(124,77,255,0.25)',
              }}
            >
              <Inbox size={22} className="text-[var(--accent-primary)]" />
            </div>
            <div className="text-sm">Inbox is empty.</div>
            <div className="text-[11px] mt-1 max-w-[360px] leading-relaxed">
              Files dropped to{' '}
              <code className="font-mono">/app/workspace/inbox/</code>{' '}
              on pod {agent.pod_id} appear here.
            </div>
          </div>
        )}

        {job && lines.length > 0 && (
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
                ls-inbox · {lines.length} entr
                {lines.length === 1 ? 'y' : 'ies'} ·{' '}
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
                  {stream.exitCode !== null &&
                    ` (exit ${stream.exitCode})`}
                </span>
              </span>
            </div>
            <ul
              className="font-mono text-[12px] leading-relaxed p-3 m-0"
              style={{
                color: '#E0E0E0',
                maxHeight: '100%',
                overflowY: 'auto',
                listStyle: 'none',
              }}
            >
              {lines.map((line, i) => (
                <li
                  key={`${i}-${line}`}
                  className="flex items-center gap-2 py-0.5"
                >
                  <FileText
                    size={12}
                    className="text-[var(--text-secondary)] shrink-0"
                  />
                  <span className="truncate">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stream.status === 'failed' && job && (
          <div
            className="mt-3 p-3 rounded-md text-xs flex items-start gap-2"
            style={{
              background: 'rgba(244,67,54,0.10)',
              border: '1px solid rgba(244,67,54,0.30)',
              color: '#FFCDD2',
            }}
          >
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              ls-inbox exited non-zero
              {stream.exitCode !== null && ` (code ${stream.exitCode})`}.
              The inbox directory may not exist on this pod yet.
            </span>
          </div>
        )}

        {stream.status === 'lost' && job && (
          <div
            className="mt-3 p-3 rounded-md text-xs flex items-start gap-2"
            style={{
              background: 'rgba(255,193,7,0.10)',
              border: '1px solid rgba(255,193,7,0.30)',
              color: '#FFE082',
            }}
          >
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              Lost connection to job stream. Click Refresh inbox to retry.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// DownloadsTab — single CTA opens local Downloads folder
// ============================================================

const DownloadsTab: FC<{ agent: Agent; client: DaemonClient }> = ({
  agent,
  client,
}) => {
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openedAt, setOpenedAt] = useState<number | null>(null);

  // Path display mirrors daemon convention: ~/Downloads/tytus/pod-NN/
  const localPath = useMemo(
    () => `~/Downloads/tytus/pod-${agent.pod_id}/`,
    [agent.pod_id],
  );

  const onOpen = useCallback(async () => {
    setOpening(true);
    setErr(null);
    const r = await client.postFilesOpenDownloads(agent.pod_id);
    setOpening(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    setOpenedAt(Date.now());
  }, [client, agent.pod_id]);

  // Ephemeral "opened" toast — clear after 3s.
  useEffect(() => {
    if (openedAt === null) return;
    const t = setTimeout(() => setOpenedAt(null), 3000);
    return () => clearTimeout(t);
  }, [openedAt]);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-6">
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: 'rgba(124,77,255,0.10)',
            border: '1px solid rgba(124,77,255,0.25)',
          }}
        >
          <Download size={22} className="text-[var(--accent-primary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Downloads for pod {agent.pod_id}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
            Files saved from this pod end up in your local Downloads
            folder, scoped per pod.
          </div>
          <div
            className="mt-3 inline-block font-mono text-[11px] px-2.5 py-1.5 rounded"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          >
            {localPath}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={onOpen}
          disabled={opening}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: 'var(--accent-primary)' }}
        >
          {opening ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ExternalLink size={14} />
          )}
          Open Downloads folder for pod {agent.pod_id}
        </button>
        {openedAt !== null && (
          <span className="text-[11px]" style={{ color: '#A5D6A7' }}>
            Opened in Finder.
          </span>
        )}
      </div>

      {err && (
        <div
          className="mt-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: 'rgba(244,67,54,0.10)',
            border: '1px solid rgba(244,67,54,0.30)',
            color: '#FFCDD2',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't open Downloads folder: {err}</span>
        </div>
      )}
    </div>
  );
};

export default FileManager;
