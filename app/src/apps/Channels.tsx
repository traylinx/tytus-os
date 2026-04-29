// ============================================================
// Channels — Phase 5 (manifest §8)
// ============================================================
//
// Per-pod messenger bindings (Telegram, Discord, Slack, LINE, …).
// Token-out-of-URL invariant — the bot token NEVER appears in the
// URL bar, fetch query string, browser history, or daemon route
// path. Daemon enforces this on the server side; the client side
// uses postChannelsAdd which sends {pod, channel, token} in the
// JSON body.
//
// Layout:
//   ┌─ Sidebar (180px) ─┬─ Main pane ───────────────────────────┐
//   │ Pods              │ Available           Configured         │
//   │ ─────             │                                        │
//   │ ● Pod 02          │ Discord  [+ Add]    Telegram ● 1 secret│
//   │ ○ Pod 04          │ Slack    [+ Add]              [Remove] │
//   │                   │ LINE     [+ Add]                       │
//   └───────────────────┴────────────────────────────────────────┘
//
// Sidebar lists state.agents only — channels are a per-allocated-pod
// feature; included AIL pods don't expose messengers. Empty `agents`
// gives the empty-state CTA.
//
// Tray fragment integration:
//   #/pod/02/channels?action=add&type=telegram
// → switches to pod 02 + opens the Add modal pre-filled with
//   type=telegram. Param consumed once via a ref so refresh / back-nav
//   doesn't re-trigger.

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Send,
  Plus,
  X,
  AlertTriangle,
  Loader2,
  Trash2,
  Box,
  Sparkles,
} from 'lucide-react';
import { useOS, useNotifications } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useHashRoute } from '@/hooks/useHashRoute';
import { navigate } from '@/lib/router';
import type { ChannelOption, ChannelsResponse } from '@/types/daemon';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: ChannelsResponse }
  | { status: 'error'; message: string };

const Channels: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const route = useHashRoute();
  const { addNotification } = useNotifications();

  const agents = useMemo(
    () => daemon.state?.agents ?? [],
    [daemon.state],
  );

  const [activePod, setActivePod] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [reloadNonce, setReloadNonce] = useState(0);

  // Modal state. `addType` non-null implies modal open.
  const [addType, setAddType] = useState<string | null>(null);
  // Remove confirmation modal.
  const [confirmRemove, setConfirmRemove] = useState<ChannelOption | null>(
    null,
  );

  // Pick the first agent on mount / when the agents list changes.
  // Deliberate setState-in-effect: synchronising local UI state with
  // the daemon poll snapshot.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (agents.length === 0) {
      if (activePod !== null) {
        setActivePod(null);
      }
      return;
    }
    if (activePod && agents.some((a) => a.pod_id === activePod)) return;
    setActivePod(agents[0].pod_id);
  }, [agents, activePod]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Tray fragment handler — consume once per nonce so the same hash
  // doesn't re-trigger after the user closes the modal.
  const consumedFragmentRef = useRef<string | null>(null);
  useEffect(() => {
    if (route.kind !== 'pod') return;
    if (route.action !== 'channels') return;

    const key = `${route.podId}|${route.params.toString()}`;
    if (consumedFragmentRef.current === key) return;
    consumedFragmentRef.current = key;

    /* eslint-disable react-hooks/set-state-in-effect */
    setActivePod(route.podId);
    if (route.params.get('action') === 'add') {
      const t = route.params.get('type');
      if (t) setAddType(t);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [route]);

  // Fetch channels for the active pod. Deliberate setState-in-effect —
  // we're synchronising the load state with a network fetch keyed on
  // (activePod, reloadNonce); same pattern as Settings.tsx catalog load.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!activePod) {
      setLoad({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setLoad({ status: 'loading' });
    client.getChannels(activePod).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setLoad({ status: 'ok', data: r.value });
      } else {
        setLoad({ status: 'error', message: r.error.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, activePod, reloadNonce]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refreshChannels = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  const onAllocate = useCallback(() => {
    dispatch({ type: 'OPEN_WINDOW', appId: 'settings' });
    navigate({
      kind: 'settings',
      section: 'agents',
      params: new URLSearchParams(),
    });
  }, [dispatch]);

  const onAddSubmitted = useCallback(() => {
    const justAdded = addType;
    setAddType(null);
    refreshChannels();
    if (activePod && justAdded) {
      addNotification({
        appId: 'channels',
        appName: 'Channels',
        appIcon: 'Send',
        title: `${justAdded} added to pod ${activePod}`,
        message: `Channel binding active. The agent has redeployed with the new credential.`,
        isRead: false,
      });
    }
  }, [refreshChannels, addType, activePod, addNotification]);

  const onRemoveSubmitted = useCallback(() => {
    setConfirmRemove(null);
    refreshChannels();
  }, [refreshChannels]);

  // Empty-pods state — short-circuit before rendering the two-pane shell.
  if (agents.length === 0) {
    return <NoPodsState onAllocate={onAllocate} loading={!daemon.state} />;
  }

  return (
    <div className="flex h-full" style={{ background: 'var(--bg-window)' }}>
      {/* Sidebar */}
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
          <Send size={12} />
          Pods
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {agents.map((a) => {
            const active = activePod === a.pod_id;
            return (
              <button
                key={a.pod_id}
                onClick={() => setActivePod(a.pod_id)}
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
                <Box size={12} className="shrink-0 opacity-70" />
                <span className="flex-1 truncate">Pod {a.pod_id}</span>
                <span
                  className="text-[10px] shrink-0"
                  style={{ color: 'var(--text-disabled)' }}
                >
                  {a.agent_type}
                </span>
              </button>
            );
          })}

          {/* Included pods are listed greyed out — channels are not
              available on them. Helps the user understand why the
              messengers don't surface for AIL freebies. */}
          {(daemon.state?.included ?? []).map((p) => (
            <div
              key={`incl-${p.pod_id}`}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm opacity-50"
              style={{ color: 'var(--text-secondary)' }}
              title="Included pods don't support channels"
            >
              <Sparkles size={12} className="shrink-0 opacity-70" />
              <span className="flex-1 truncate">Pod {p.pod_id}</span>
              <span
                className="text-[10px] shrink-0"
                style={{ color: 'var(--text-disabled)' }}
              >
                Included
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <Send size={18} className="text-[var(--accent-primary)]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {activePod ? `Channels — Pod ${activePod}` : 'Channels'}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)]">
              Per-pod messenger bindings. Tokens never appear in URLs.
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {load.status === 'loading' && <ColumnsSkeleton />}
          {load.status === 'error' && (
            <ErrorBlock
              message={load.message}
              onRetry={refreshChannels}
            />
          )}
          {load.status === 'ok' && (
            <ChannelColumns
              data={load.data}
              onAdd={(type) => setAddType(type)}
              onRequestRemove={(option) => setConfirmRemove(option)}
            />
          )}
        </div>
      </div>

      {addType && activePod && (
        <AddChannelModal
          podId={activePod}
          channelType={addType}
          channelLabel={
            load.status === 'ok'
              ? load.data.available.find((a) => a.name === addType)?.label ??
                load.data.configured.find((c) => c.name === addType)?.label ??
                addType
              : addType
          }
          onCancel={() => setAddType(null)}
          onSuccess={onAddSubmitted}
        />
      )}

      {confirmRemove && activePod && (
        <RemoveChannelModal
          podId={activePod}
          channel={confirmRemove}
          onCancel={() => setConfirmRemove(null)}
          onSuccess={onRemoveSubmitted}
        />
      )}
    </div>
  );
};

// ============================================================
// Two-column body (Available | Configured)
// ============================================================

interface ChannelColumnsProps {
  data: ChannelsResponse;
  onAdd: (channelType: string) => void;
  onRequestRemove: (option: ChannelOption) => void;
}

const ChannelColumns: FC<ChannelColumnsProps> = ({
  data,
  onAdd,
  onRequestRemove,
}) => (
  <div className="grid grid-cols-2 gap-5 p-5">
    <div>
      <div
        className="text-[10px] uppercase tracking-wider font-semibold mb-3"
        style={{ color: 'var(--text-secondary)' }}
      >
        Available
      </div>
      <div className="flex flex-col gap-2">
        {data.available.length === 0 && (
          <div
            className="text-[12px] px-3 py-2 rounded-md"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-card, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
            }}
          >
            All channels configured. Nothing left to add.
          </div>
        )}
        {data.available.map((option) => (
          <div
            key={option.name}
            className="flex items-center gap-3 px-3 py-2 rounded-md"
            style={{
              background: 'var(--bg-card, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span className="flex-1 text-sm text-[var(--text-primary)]">
              {option.label}
            </span>
            <button
              onClick={() => onAdd(option.name)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={{
                background: 'var(--accent-primary)',
                color: '#fff',
              }}
            >
              <Plus size={11} />
              Add
            </button>
          </div>
        ))}
      </div>
    </div>

    <div>
      <div
        className="text-[10px] uppercase tracking-wider font-semibold mb-3"
        style={{ color: 'var(--text-secondary)' }}
      >
        Configured
      </div>
      <div className="flex flex-col gap-2">
        {data.configured.length === 0 && (
          <div
            className="text-[12px] px-3 py-2 rounded-md"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-card, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
            }}
          >
            No channels yet — add one.
          </div>
        )}
        {data.configured.map((option) => (
          <div
            key={option.name}
            className="flex items-center gap-3 px-3 py-2 rounded-md"
            style={{
              background: 'var(--bg-card, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span className="flex-1 text-sm text-[var(--text-primary)]">
              {option.label}
            </span>
            {option.secret_count > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium"
                style={{ color: 'var(--text-secondary)' }}
                title={`${option.secret_count} secret${option.secret_count === 1 ? '' : 's'} stored`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: '#4CAF50' }}
                />
                {option.secret_count} secret
                {option.secret_count === 1 ? '' : 's'}
              </span>
            )}
            <button
              onClick={() =>
                onRequestRemove({ name: option.name, label: option.label })
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={{
                background: 'rgba(244,67,54,0.10)',
                border: '1px solid rgba(244,67,54,0.30)',
                color: '#FFCDD2',
              }}
            >
              <Trash2 size={11} />
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ============================================================
// State sub-views
// ============================================================

const ColumnsSkeleton: FC = () => (
  <div className="grid grid-cols-2 gap-5 p-5">
    {[0, 1].map((col) => (
      <div key={col}>
        <div
          className="h-3 w-20 mb-3 rounded-sm"
          style={{ background: 'var(--border-subtle)' }}
        />
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-9 rounded-md"
              style={{
                background: 'var(--bg-card, rgba(255,255,255,0.03))',
                border: '1px solid var(--border-subtle)',
              }}
            />
          ))}
        </div>
      </div>
    ))}
  </div>
);

const ErrorBlock: FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="p-5">
    <div
      className="flex items-start gap-2 px-3 py-2.5 rounded-md text-[12px]"
      style={{
        background: 'rgba(244,67,54,0.10)',
        border: '1px solid rgba(244,67,54,0.30)',
        color: '#FFCDD2',
      }}
    >
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        Couldn't load channels: {message}
      </div>
      <button
        onClick={onRetry}
        className="text-[11px] px-2 py-0.5 rounded-sm transition-colors"
        style={{
          color: '#FFCDD2',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.10)',
        }}
      >
        Retry
      </button>
    </div>
  </div>
);

const NoPodsState: FC<{ onAllocate: () => void; loading: boolean }> = ({
  onAllocate,
  loading,
}) => (
  <div
    className="flex h-full items-center justify-center p-8"
    style={{ background: 'var(--bg-window)' }}
  >
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
        <Send size={26} className="text-white" />
      </div>
      <div
        className="text-base font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        {loading ? 'Loading pods…' : 'No pods to add channels to.'}
      </div>
      <div
        className="text-xs mt-1.5 max-w-[300px] leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        {loading
          ? 'Checking what you have allocated…'
          : 'Channels (Telegram, Discord, Slack, …) bind to a specific allocated pod. Allocate one first, then come back to wire it up.'}
      </div>
      {!loading && (
        <button
          onClick={onAllocate}
          className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--accent-primary)' }}
        >
          Allocate a pod first →
        </button>
      )}
    </div>
  </div>
);

// ============================================================
// Add channel modal — token-secure
// ============================================================

interface AddChannelModalProps {
  podId: string;
  channelType: string;
  channelLabel: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const AddChannelModal: FC<AddChannelModalProps> = ({
  podId,
  channelType,
  channelLabel,
  onCancel,
  onSuccess,
}) => {
  const client = useDaemonClient();
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const onSubmit = useCallback(async () => {
    if (!token.trim()) {
      setSubmitErr('Bot token is required.');
      return;
    }
    setSubmitting(true);
    setSubmitErr(null);
    const r = await client.postChannelsAdd(podId, channelType, token);
    setSubmitting(false);
    if (!r.ok) {
      // Per manifest §8.3 — leave the field intact so the user keeps
      // the typed token after a transient failure.
      setSubmitErr(r.error.message);
      return;
    }
    onSuccess();
  }, [client, podId, channelType, token, onSuccess]);

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-[480px] rounded-xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-window, #1E1E1E)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        }}
      >
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Add {channelLabel} to Pod {podId}
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="p-1 rounded-sm transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="tytus-channel-secret"
              className="text-[11px] font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              Bot token
            </label>
            <input
              id="tytus-channel-secret"
              // Non-credit-card-shaped name so password managers
              // don't auto-fill saved logins into a bot-token field.
              name="tytus-channel-secret"
              type="password"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="Paste your bot token"
              className="w-full px-3 py-2 rounded-md text-xs font-mono outline-none"
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
              }}
            />
            <div
              className="text-[10px]"
              style={{ color: 'var(--text-disabled)' }}
            >
              Sent in the request body — never appears in the URL bar.
            </div>
          </div>

          <div
            className="flex items-start gap-2 px-3 py-2 rounded-md text-[12px]"
            style={{
              background: 'rgba(255,193,7,0.10)',
              border: '1px solid rgba(255,193,7,0.30)',
              color: '#FFE082',
            }}
          >
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div>Don't share screenshots of this dialog.</div>
          </div>

          {submitErr && (
            <div
              className="flex items-start gap-2 px-3 py-2 rounded-md text-[12px]"
              style={{
                background: 'rgba(244,67,54,0.10)',
                border: '1px solid rgba(244,67,54,0.30)',
                color: '#FFCDD2',
              }}
            >
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div className="flex-1">{submitErr}</div>
            </div>
          )}
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-60"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || token.trim().length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: 'var(--accent-primary)' }}
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Add channel
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Remove channel modal — confirm + POST
// ============================================================

interface RemoveChannelModalProps {
  podId: string;
  channel: ChannelOption;
  onCancel: () => void;
  onSuccess: () => void;
}

const RemoveChannelModal: FC<RemoveChannelModalProps> = ({
  podId,
  channel,
  onCancel,
  onSuccess,
}) => {
  const client = useDaemonClient();
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const onConfirm = useCallback(async () => {
    setSubmitting(true);
    setSubmitErr(null);
    const r = await client.postChannelsRemove(podId, channel.name);
    setSubmitting(false);
    if (!r.ok) {
      setSubmitErr(r.error.message);
      return;
    }
    onSuccess();
  }, [client, podId, channel.name, onSuccess]);

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-[440px] rounded-xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-window, #1E1E1E)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        }}
      >
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(244,67,54,0.12)',
              border: '1px solid rgba(244,67,54,0.30)',
            }}
          >
            <Trash2 size={16} style={{ color: '#F44336' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              Remove {channel.label} from pod {podId}?
            </div>
            <div className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
              The bot token will be deleted from the pod and the channel
              will stop receiving messages. You can re-add it later by
              pasting the token again.
            </div>
            {submitErr && (
              <div
                className="mt-3 flex items-start gap-2 px-3 py-2 rounded-md text-[12px]"
                style={{
                  background: 'rgba(244,67,54,0.10)',
                  border: '1px solid rgba(244,67,54,0.30)',
                  color: '#FFCDD2',
                }}
              >
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <div className="flex-1">{submitErr}</div>
              </div>
            )}
          </div>
        </div>
        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-60"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: '#D32F2F' }}
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Remove
          </button>
        </div>
      </div>
    </div>
  );
};

export default Channels;
