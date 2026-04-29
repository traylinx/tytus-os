// ============================================================
// Chat — v1 link launcher (manifest §6 / 10-DESIGN-PHASE-2-APPS)
// ============================================================
//
// Honest framing: this is NOT a chat app yet. v1 = "Talk to your
// pod" link launcher. Sidebar lists allocated agents + included
// pods, main pane shows a per-pod landing whose primary action is
// "Open Pod NN in browser" (POST /api/pod/open).
//
// Inline chat lands in v1.1 — until then we just steer the user to
// the OpenClaw UI in their browser, where the experience is fast
// (Phase 2.6 dual-bridge fast-path) and feature-complete.
//
// Layout:
//   ┌─ Sidebar (180px) ─┬─ Main pane ───────────────────────┐
//   │ Pods              │   💬 Inline chat coming in v1.1   │
//   │ ─────             │                                   │
//   │ ● Pod 02          │   Pod 02 is ready to chat.        │
//   │ ○ Pod 04          │   [Open Pod 02 in browser →]      │
//   │ ⊘ Pod 03 (incl.)  │                                   │
//   └───────────────────┴───────────────────────────────────┘
//
// Status dot: rendered as a static neutral dot per row. We deliberately
// DO NOT poll /api/pod/ready from here — Pod Inspector already drives
// that probe (PodInspector.tsx readyByPod) on the same daemon, and a
// duplicate probe per Chat window would burn the daemon's lazy probe
// quota for no UX gain. Live readiness is what Pod Inspector is for.

import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Sparkles,
  MessageSquare,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Rocket,
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { navigate } from '@/lib/router';
import type { Agent, IncludedPod } from '@/types/daemon';

type Selection =
  | { kind: 'agent'; pod_id: string }
  | { kind: 'included'; pod_id: string }
  | null;

const Chat: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();

  // useMemo so referential identity is stable across renders that
  // didn't change the daemon snapshot — keeps the prune effect's
  // dependency array honest.
  const agents: Agent[] = useMemo(
    () => daemon.state?.agents ?? [],
    [daemon.state],
  );
  const included: IncludedPod[] = useMemo(
    () => daemon.state?.included ?? [],
    [daemon.state],
  );

  const [selection, setSelection] = useState<Selection>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // If the selected agent disappears (revoke from another surface),
  // drop the selection so the empty/picker state takes over cleanly.
  // Deliberate setState-in-effect: we're synchronizing local UI state
  // with the result of an external poll (mirrors PodInspector's
  // closed-tab pruning effect).
  useEffect(() => {
    if (!selection) return;
    const stillThere =
      selection.kind === 'agent'
        ? agents.some((a) => a.pod_id === selection.pod_id)
        : included.some((p) => p.pod_id === selection.pod_id);
    if (!stillThere) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelection(null);
    }
  }, [agents, included, selection]);

  const selectAgent = useCallback((podId: string) => {
    setSelection({ kind: 'agent', pod_id: podId });
    setOpenError(null);
  }, []);

  const selectIncluded = useCallback((podId: string) => {
    setSelection({ kind: 'included', pod_id: podId });
    setOpenError(null);
  }, []);

  const onAllocate = useCallback(() => {
    dispatch({ type: 'OPEN_WINDOW', appId: 'settings' });
    navigate({
      kind: 'settings',
      section: 'agents',
      params: new URLSearchParams(),
    });
  }, [dispatch]);

  const onOpenInBrowser = useCallback(async () => {
    if (!selection || selection.kind !== 'agent') return;
    setOpening(true);
    setOpenError(null);
    const r = await client.postPodOpen(selection.pod_id);
    setOpening(false);
    if (!r.ok) {
      setOpenError(
        `Couldn't open pod ${selection.pod_id} in your browser. Check tunnel. (${r.error.message})`,
      );
    }
  }, [client, selection]);

  const totalPods = agents.length + included.length;

  return (
    <div className="flex h-full" style={{ background: 'var(--bg-window)' }}>
      {/* ─────────────── Sidebar ─────────────── */}
      <div
        className="w-[180px] shrink-0 flex flex-col"
        style={{
          background: 'var(--bg-titlebar)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold flex items-center gap-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          <MessageSquare size={12} />
          Pods
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {agents.length === 0 && included.length === 0 && (
            <div
              className="px-4 py-3 text-[11px]"
              style={{ color: 'var(--text-disabled)' }}
            >
              {daemon.state ? 'No pods allocated.' : 'Loading…'}
            </div>
          )}

          {agents.map((a) => {
            const active =
              selection?.kind === 'agent' && selection.pod_id === a.pod_id;
            return (
              <button
                key={`agent-${a.pod_id}`}
                onClick={() => selectAgent(a.pod_id)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors"
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
                {/* Static neutral dot — see file header: live readiness
                    lives in Pod Inspector to avoid duplicate probes. */}
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: 'var(--text-disabled)' }}
                  aria-hidden="true"
                />
                <Box size={12} className="shrink-0 opacity-70" />
                <span className="flex-1 truncate">Pod {a.pod_id}</span>
              </button>
            );
          })}

          {included.length > 0 && (
            <div
              className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--text-secondary)' }}
            >
              Included
            </div>
          )}

          {included.map((p) => {
            const active =
              selection?.kind === 'included' && selection.pod_id === p.pod_id;
            return (
              <button
                key={`included-${p.pod_id}`}
                onClick={() => selectIncluded(p.pod_id)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors opacity-60"
                style={{
                  background: active ? 'var(--bg-selected)' : 'transparent',
                  color: active
                    ? 'var(--accent-primary)'
                    : 'var(--text-secondary)',
                  borderLeft: active
                    ? '3px solid var(--accent-primary)'
                    : '3px solid transparent',
                }}
                title="Included pod — chat is not available; use the API key directly"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: 'var(--text-disabled)' }}
                  aria-hidden="true"
                />
                <Sparkles size={12} className="shrink-0 opacity-70" />
                <span className="flex-1 truncate">Pod {p.pod_id}</span>
                <span
                  className="text-[10px] shrink-0"
                  style={{ color: 'var(--text-disabled)' }}
                >
                  Included
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─────────────── Main pane ─────────────── */}
      <div className="flex-1 flex flex-col">
        {totalPods === 0 ? (
          <EmptyState onAllocate={onAllocate} />
        ) : !selection ? (
          <PickerHint />
        ) : selection.kind === 'agent' ? (
          <AgentLanding
            podId={selection.pod_id}
            opening={opening}
            error={openError}
            onOpen={onOpenInBrowser}
            onDismissError={() => setOpenError(null)}
          />
        ) : (
          <IncludedLanding podId={selection.pod_id} />
        )}
      </div>
    </div>
  );
};

// ============================================================
// Main-pane states
// ============================================================

const EmptyState: FC<{ onAllocate: () => void }> = ({ onAllocate }) => (
  <div className="flex-1 flex items-center justify-center p-8">
    <div
      className="w-[420px] rounded-2xl p-8 flex flex-col items-center text-center"
      style={{
        background: 'var(--bg-card, rgba(255,255,255,0.03))',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'linear-gradient(135deg, #7C4DFF, #4A148C)' }}
      >
        <Rocket size={28} className="text-white" />
      </div>
      <div
        className="text-base font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        No pods to chat with
      </div>
      <div
        className="text-xs mt-1.5 max-w-[300px] leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        Allocate a pod first — once it's running, you'll be able to open it
        right here.
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
);

const PickerHint: FC = () => (
  <div
    className="flex-1 flex items-center justify-center px-8 text-sm"
    style={{ color: 'var(--text-secondary)' }}
  >
    Select a pod from the left to start chatting.
  </div>
);

const AgentLanding: FC<{
  podId: string;
  opening: boolean;
  error: string | null;
  onOpen: () => void;
  onDismissError: () => void;
}> = ({ podId, opening, error, onOpen, onDismissError }) => (
  <div className="flex-1 flex flex-col items-center justify-center px-8 py-10">
    <div className="w-full max-w-[460px] flex flex-col items-center text-center gap-5">
      {/* v1.1 hint banner */}
      <div
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[12px]"
        style={{
          background: 'rgba(124,77,255,0.10)',
          border: '1px solid rgba(124,77,255,0.30)',
          color: '#D1C4FF',
        }}
      >
        <Sparkles size={14} className="shrink-0" />
        <span>Inline chat coming in v1.1</span>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <Box size={32} className="text-[var(--accent-primary)]" />
        <div
          className="text-lg font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          Pod {podId} is ready to chat.
        </div>
        <div
          className="text-xs leading-relaxed max-w-[360px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          Open the OpenClaw UI in your browser — your private pod's chat is
          fast and feature-complete on the web.
        </div>
      </div>

      <button
        onClick={onOpen}
        disabled={opening}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-60"
        style={{ background: 'var(--accent-primary)' }}
      >
        {opening ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ExternalLink size={14} />
        )}
        Open Pod {podId} in browser →
      </button>

      {error && (
        <div
          className="w-full flex items-start gap-2 px-3 py-2 rounded-md text-[12px] text-left"
          style={{
            background: 'rgba(244,67,54,0.10)',
            border: '1px solid rgba(244,67,54,0.30)',
            color: '#FFCDD2',
          }}
        >
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button
            onClick={onDismissError}
            className="text-[11px] px-1.5 py-0.5 rounded-sm transition-colors"
            style={{
              color: '#FFCDD2',
              background: 'rgba(255,255,255,0.05)',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  </div>
);

const IncludedLanding: FC<{ podId: string }> = ({ podId }) => (
  <div className="flex-1 flex flex-col items-center justify-center px-8 py-10">
    <div className="w-full max-w-[460px] flex flex-col items-center text-center gap-4">
      <Sparkles size={28} className="text-[var(--text-secondary)]" />
      <div
        className="text-base font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        Pod {podId} is an included pod.
      </div>
      <div
        className="text-xs leading-relaxed max-w-[360px]"
        style={{ color: 'var(--text-secondary)' }}
      >
        Included pods don't have a chat UI — they expose an OpenAI-compatible
        API only. Use Pod Inspector to copy the API URL and key, then point
        your favorite client at them.
      </div>
    </div>
  </div>
);

export default Chat;
