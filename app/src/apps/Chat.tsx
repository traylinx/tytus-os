// ============================================================
// Chat — pod launcher (no inline chat by design)
// ============================================================
//
// TytusOS does not ship its own chat UI. People already have great
// messengers (Telegram / Discord / Slack / iMessage / Matrix) and
// dedicated AI clients (Cursor / Claude Code / OpenCode / API Tester).
// The Chat app's job is to send users *to* those tools, with the right
// keys / URLs / connection ceremony already done.
//
// Layout:
//   ┌─ Sidebar (180px) ─┬─ Main pane ───────────────────────────────┐
//   │ Pods              │   Pod 02 · OpenClaw                       │
//   │ ─────             │   [icon] description + highlights         │
//   │ ● Pod 02          │   [Open Pod 02 in browser] [Channels →]   │
//   │ ─────             │   Connected apps: [Telegram] [Discord]    │
//   │ INCLUDED          │                                           │
//   │ ⊘ AIL             │   AIL is the smart LLM gateway —          │
//   │                   │   [Read the docs] [Open Pod Inspector]    │
//   └───────────────────┴───────────────────────────────────────────┘
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
  BookOpen,
  Send,
  Settings as SettingsIcon,
  Hash,
  MessageCircle,
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useI18n } from '@/i18n';
import { navigate } from '@/lib/router';
import { includedLabel } from '@/lib/includedLabel';
import { resolveAgentDisplay } from '@/lib/agentCatalog';
import { getChannelLauncher } from '@/lib/chatChannelLaunchers';
import type {
  Agent,
  ChannelsResponse,
  ConfiguredChannel,
  IncludedPod,
} from '@/types/daemon';

const AIL_DOCS_URL = 'https://ail.traylinx.com/introduction';

type Selection =
  | { kind: 'agent'; pod_id: string }
  | { kind: 'included'; pod_id: string }
  | null;

type ChannelsLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: ChannelsResponse }
  | { status: 'error'; message: string };

const Chat: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const { t } = useI18n();

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

  // Channels load is keyed on the active agent pod_id. Cleared when the
  // selection moves off an agent so the network call doesn't fire when
  // the AIL row is selected.
  const [channels, setChannels] = useState<ChannelsLoad>({ status: 'idle' });

  // If the selected agent disappears (revoke from another surface),
  // drop the selection so the empty/picker state takes over cleanly.
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

  // Load channels for the selected agent pod. Cancels on unmount or
  // selection change. Same setState-in-effect pattern as Channels.tsx —
  // we're synchronising load state with a network fetch keyed on the
  // active selection.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selection || selection.kind !== 'agent') {
      setChannels({ status: 'idle' });
      return;
    }
    const podId = selection.pod_id;
    let cancelled = false;
    setChannels({ status: 'loading' });
    client.getChannels(podId).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setChannels({ status: 'ok', data: r.value });
      } else {
        setChannels({ status: 'error', message: r.error.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, selection]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
        t('chat.agent.openError', {
          podId: selection.pod_id,
          message: r.error.message,
        }),
      );
    }
  }, [client, selection, t]);

  const onOpenChannels = useCallback(
    (podId: string) => {
      dispatch({ type: 'OPEN_WINDOW', appId: 'channels' });
      navigate({
        kind: 'pod',
        podId,
        action: 'channels',
        params: new URLSearchParams(),
      });
    },
    [dispatch],
  );

  const onOpenPodInspector = useCallback(() => {
    dispatch({ type: 'OPEN_WINDOW', appId: 'pod-inspector' });
  }, [dispatch]);

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
          {t('chat.sidebar.podsHeader')}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {agents.length === 0 && included.length === 0 && (
            <div
              className="px-4 py-3 text-[11px]"
              style={{ color: 'var(--text-disabled)' }}
            >
              {daemon.state
                ? t('chat.sidebar.empty')
                : t('chat.sidebar.loading')}
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
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: 'var(--text-disabled)' }}
                  aria-hidden="true"
                />
                <Box size={12} className="shrink-0 opacity-70" />
                <span className="flex-1 truncate">
                  {t('chat.sidebar.podLabel', { podId: a.pod_id })}
                </span>
              </button>
            );
          })}

          {included.length > 0 && (
            <div
              className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('chat.sidebar.includedHeader')}
            </div>
          )}

          {included.map((p) => {
            const active =
              selection?.kind === 'included' && selection.pod_id === p.pod_id;
            const label = includedLabel(p, included);
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
                title={t('chat.ail.tooltip')}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: 'var(--text-disabled)' }}
                  aria-hidden="true"
                />
                <Sparkles size={12} className="shrink-0 opacity-70" />
                <span className="flex-1 truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─────────────── Main pane ─────────────── */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {totalPods === 0 ? (
          <EmptyState onAllocate={onAllocate} />
        ) : !selection ? (
          <PickerHint />
        ) : selection.kind === 'agent' ? (
          <AgentLanding
            agent={
              agents.find((a) => a.pod_id === selection.pod_id) ?? {
                pod_id: selection.pod_id,
                agent_type: 'nemoclaw',
                api_url: '',
                public_url: '',
                ui_url: '' as never,
                user_key: '' as never,
                units: 1,
              }
            }
            channels={channels}
            opening={opening}
            error={openError}
            onOpen={onOpenInBrowser}
            onDismissError={() => setOpenError(null)}
            onOpenChannels={() => onOpenChannels(selection.pod_id)}
          />
        ) : (
          <IncludedLanding onOpenPodInspector={onOpenPodInspector} />
        )}
      </div>
    </div>
  );
};

// ============================================================
// Main-pane states
// ============================================================

const EmptyState: FC<{ onAllocate: () => void }> = ({ onAllocate }) => {
  const { t } = useI18n();
  return (
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
          {t('chat.empty.title')}
        </div>
        <div
          className="text-xs mt-1.5 max-w-[300px] leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('chat.empty.body')}
        </div>
        <button
          onClick={onAllocate}
          className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--accent-primary)' }}
        >
          {t('chat.empty.cta')}
        </button>
      </div>
    </div>
  );
};

const PickerHint: FC = () => {
  const { t } = useI18n();
  return (
    <div
      className="flex-1 flex items-center justify-center px-8 text-sm"
      style={{ color: 'var(--text-secondary)' }}
    >
      {t('chat.picker.hint')}
    </div>
  );
};

const CHANNEL_ICON: Record<string, FC<{ size?: number }>> = {
  Send,
  MessageCircle,
  MessageSquare,
  Hash,
};

const ChannelChip: FC<{ channel: ConfiguredChannel }> = ({ channel }) => {
  const launcher = getChannelLauncher(channel.name);
  const Icon = CHANNEL_ICON[launcher.icon] ?? MessageCircle;
  const inner = (
    <>
      <Icon size={12} />
      <span className="truncate">{launcher.label}</span>
      {launcher.webUrl && <ExternalLink size={10} className="opacity-70" />}
    </>
  );
  const className =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors';
  const style = {
    background: 'var(--bg-hover, rgba(255,255,255,0.04))',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
    textDecoration: 'none' as const,
  };
  if (launcher.webUrl) {
    return (
      <a
        href={launcher.webUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        style={style}
      >
        {inner}
      </a>
    );
  }
  return (
    <span
      className={className}
      style={{ ...style, cursor: 'default', opacity: 0.7 }}
    >
      {inner}
    </span>
  );
};

interface AgentLandingProps {
  agent: Agent;
  channels: ChannelsLoad;
  opening: boolean;
  error: string | null;
  onOpen: () => void;
  onDismissError: () => void;
  onOpenChannels: () => void;
}

const AgentLanding: FC<AgentLandingProps> = ({
  agent,
  channels,
  opening,
  error,
  onOpen,
  onDismissError,
  onOpenChannels,
}) => {
  const { t } = useI18n();
  const display = resolveAgentDisplay(agent.agent_type, null, t);

  return (
    <div className="flex-1 px-10 py-10">
      <div className="w-full max-w-[620px] mx-auto flex flex-col gap-7">
        {/* Header — pod label + agent identity, no card */}
        <div className="flex items-start gap-4">
          {display.icon ? (
            <img
              src={display.icon}
              alt=""
              width={48}
              height={48}
              className="flex-shrink-0"
              style={{ display: 'block' }}
            />
          ) : (
            <Box size={40} className="flex-shrink-0 text-[var(--accent-primary)]" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
              {t('chat.agent.podLabel', { podId: agent.pod_id })} ·{' '}
              {agent.units}{' '}
              {agent.units === 1
                ? t('agents.panel.unitSingular')
                : t('agents.panel.unitPlural')}
            </div>
            <div className="text-[22px] font-bold tracking-tight text-[var(--text-primary)] leading-tight">
              {display.name}
            </div>
            {display.tagline && (
              <div className="text-[13px] text-[var(--text-secondary)] mt-1 leading-snug">
                {display.tagline}
              </div>
            )}
          </div>
        </div>

        {/* Description + bullets — flat prose */}
        {display.description && (
          <div className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
            {display.description}
          </div>
        )}

        {display.highlights.length > 0 && (
          <ul className="list-none p-0 m-0 grid gap-2">
            {display.highlights.map((h) => (
              <li
                key={h}
                className="text-[12.5px] leading-snug text-[var(--text-primary)] pl-5 relative"
              >
                <span
                  className="absolute left-0 w-1.5 h-1.5 rounded-full"
                  style={{
                    top: '0.45rem',
                    background: 'var(--accent-primary, #7C4DFF)',
                  }}
                />
                {h}
              </li>
            ))}
          </ul>
        )}

        {/* Primary action row */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpen}
            disabled={opening}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: 'var(--accent-primary)' }}
          >
            {opening ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ExternalLink size={13} />
            )}
            {t('chat.agent.openInBrowser', { podId: agent.pod_id })}
          </button>
          {display.homepage && (
            <a
              href={display.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors no-underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              <BookOpen size={12} />
              {t('chat.agent.docs')}
              <span className="opacity-60">↗</span>
            </a>
          )}
        </div>

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
              {t('chat.agent.dismissError')}
            </button>
          </div>
        )}

        {/* Connected apps — quiet section header, hairline divider, chips */}
        <div
          className="pt-5 mt-1"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-secondary)] flex items-center gap-2">
              <Send size={11} />
              {t('chat.agent.connectedApps')}
            </div>
            <button
              onClick={onOpenChannels}
              className="text-[11px] font-medium transition-colors"
              style={{ color: 'var(--accent-primary)' }}
            >
              {t('chat.agent.manageChannels')} →
            </button>
          </div>

          {channels.status === 'loading' && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <Loader2 size={12} className="animate-spin" />
              {t('chat.agent.loadingChannels')}
            </div>
          )}

          {channels.status === 'error' && (
            <div className="text-[12px] text-[var(--accent-error,#FFCDD2)]">
              {t('chat.agent.channelsError', { message: channels.message })}
            </div>
          )}

          {channels.status === 'ok' &&
            channels.data.configured.length === 0 && (
              <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                {t('chat.agent.noChannels')}
              </div>
            )}

          {channels.status === 'ok' &&
            channels.data.configured.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {channels.data.configured.map((c) => (
                  <ChannelChip key={c.name} channel={c} />
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

const IncludedLanding: FC<{
  onOpenPodInspector: () => void;
}> = ({ onOpenPodInspector }) => {
  const { t } = useI18n();
  const features = [
    t('chat.ail.feature.0'),
    t('chat.ail.feature.1'),
    t('chat.ail.feature.2'),
    t('chat.ail.feature.3'),
  ];
  return (
    <div className="flex-1 px-10 py-10">
      <div className="w-full max-w-[620px] mx-auto flex flex-col gap-6">
        {/* Brand row — real AIL logo, no rectangle around it */}
        <div className="flex items-start gap-4">
          <img
            src="/brand/ail.png"
            alt="AIL"
            width={72}
            height={72}
            className="flex-shrink-0"
            style={{ display: 'block' }}
          />
          <div className="flex-1 min-w-0 pt-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
              {t('chat.sidebar.includedHeader')}
            </div>
            <div className="text-[26px] font-bold tracking-tight text-[var(--text-primary)] leading-tight">
              {t('chat.ail.title')}
            </div>
            <div className="text-[13px] text-[var(--text-secondary)] mt-1 leading-snug">
              {t('chat.ail.tagline')}
            </div>
          </div>
        </div>

        <div className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
          {t('chat.ail.body')}
        </div>

        <ul className="list-none p-0 m-0 grid gap-2">
          {features.map((f) => (
            <li
              key={f}
              className="text-[12.5px] leading-snug text-[var(--text-primary)] pl-5 relative"
            >
              <span
                className="absolute left-0 w-1.5 h-1.5 rounded-full"
                style={{
                  top: '0.45rem',
                  background: 'var(--accent-primary, #7C4DFF)',
                }}
              />
              {f}
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <a
            href={AIL_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold text-white transition-colors no-underline"
            style={{ background: 'var(--accent-primary)' }}
          >
            <BookOpen size={13} />
            {t('chat.ail.cta.docs')}
            <span className="opacity-70">↗</span>
          </a>
          <button
            onClick={onOpenPodInspector}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <SettingsIcon size={12} />
            {t('chat.ail.cta.podInspector')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
