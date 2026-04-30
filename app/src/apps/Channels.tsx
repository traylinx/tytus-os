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
  ExternalLink,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Copy,
  Check,
  Sparkles,
  Terminal as TerminalIcon,
  BookOpen,
  MessageCircle,
} from 'lucide-react';
import { useOS, useNotifications } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useCurrentWindowArgs } from '@/hooks/useCurrentWindow';
import { navigate } from '@/lib/router';
import type { Agent, ChannelOption, ChannelsResponse } from '@/types/daemon';
import { revealTokenUrl } from '@/lib/secrets';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: ChannelsResponse }
  | { status: 'error'; message: string };

const Channels: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const windowArgs = useCurrentWindowArgs();
  const channelsArgs = windowArgs?.channels;
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

  // Tray route handler — consume once per nonce so the same route
  // doesn't re-trigger after the user closes the modal. Remove is
  // intentionally confirmation-only: no POST fires from this effect.
  const consumedFragmentRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!channelsArgs?.podId) return;
    const key = `${windowArgs?.routeNonce ?? 'no-nonce'}:${channelsArgs.podId}:${channelsArgs.action ?? 'view'}:${channelsArgs.type ?? ''}`;
    if (consumedFragmentRef.current.has(key)) return;
    consumedFragmentRef.current.add(key);
    if (agents.length > 0 && !agents.some((a) => a.pod_id === channelsArgs.podId)) {
      addNotification({
        appId: 'channels',
        appName: 'Channels',
        appIcon: 'Send',
        title: `Pod ${channelsArgs.podId} not found`,
        message: 'This tray route no longer matches an allocated pod.',
        isRead: false,
      });
      return;
    }

    /* eslint-disable react-hooks/set-state-in-effect */
    setActivePod(channelsArgs.podId);
    if (channelsArgs.action === 'add' && channelsArgs.type) {
      setAddType(channelsArgs.type);
      setConfirmRemove(null);
    } else if (channelsArgs.action === 'remove' && channelsArgs.type) {
      setAddType(null);
      setConfirmRemove({
        name: channelsArgs.type,
        label: channelsArgs.type,
      });
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [addNotification, agents, channelsArgs, windowArgs?.routeNonce]);

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

  // Token was saved — refresh the channel list + show a notification,
  // but DO NOT close the modal. Some channels (Telegram/Discord/Slack)
  // need the user to complete a pairing-approval step on the next
  // panel, so the modal closes via its own onCancel/Done buttons.
  const onAddTokenSaved = useCallback(() => {
    const justAdded = addType;
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

          {/* AIL is intentionally NOT listed here. Channels are
              messenger bindings (Telegram / Discord / etc.) that only
              apply to agent pods — AIL is a pure LLM gateway, not a
              channel host. */}
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
          {activePod && (
            <MoreChannelsFooter
              podId={activePod}
              agent={agents.find((a) => a.pod_id === activePod) ?? null}
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
          onTokenSaved={onAddTokenSaved}
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
                  style={{ background: 'var(--accent-success)' }}
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
                color: 'var(--accent-error)',
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
        color: 'var(--accent-error)',
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
          color: 'var(--accent-error)',
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
// Per-channel setup guides
// ============================================================
//
// Each channel has its own way of issuing bot tokens. We embed a
// short numbered walkthrough in the Add modal so the user doesn't
// have to leave the app to figure out where the token lives.
//
// Keys are the daemon's `name` field (lowercase, single word).
// Steps are intentionally terse — one action per step. The "open"
// link points at the canonical place to complete the flow.

interface ChannelGuide {
  /**
   * How the user authenticates the agent against this channel.
   * - `token`: paste a bot token / API key into the modal (default).
   * - `qr`:    no token — the user scans a QR code on their phone
   *            (WhatsApp Web style). The modal swaps the token input
   *            for a CLI command they run from their Mac.
   */
  auth?: 'token' | 'qr';
  /** Short tagline shown under the title. */
  blurb: string;
  /** Numbered steps. Keep each one to a single sentence. */
  steps: string[];
  /** Optional deep link to the relevant portal / app. */
  open?: { url: string; label: string };
  /** Format hint shown under the token input as a placeholder. */
  tokenPlaceholder: string;
  /** Realistic shape of what the token looks like — helps users
   *  spot when they've pasted the wrong thing. */
  tokenShape: string;
  /**
   * For `qr` auth — the shell command (templated with podId) that
   * starts the QR scan flow inside the pod.
   */
  qrCommand?: (podId: string) => string;
  /**
   * Final-step pairing flow. OpenClaw-based agents (Telegram / Discord
   * / Slack) require the bot owner to approve their own user ID before
   * the bot will respond — otherwise it just replies "access not
   * configured" with a pairing code. We surface this as a follow-up
   * panel after the token is accepted, with copy buttons for the
   * exact `tytus exec` command.
   */
  pairing?: {
    /** Plain-language summary of how the user obtains the pairing code. */
    howToGetCode: string;
    /**
     * Returns the shell command a user runs from their *host* terminal
     * to approve a pairing code inside their pod. The CLI verb is
     * `openclaw pairing approve <channel> <code>` — we wrap it in
     * `tytus exec` so the user doesn't have to SSH into the pod.
     */
    approveCommand: (podId: string, code: string) => string;
  };
}

const openclawPairing = {
  howToGetCode:
    'Open the bot in the messenger and send any message. The bot replies "OpenClaw: access not configured" along with your user ID and an 8-character pairing code (e.g. B7KFBXYA).',
  approveCommand: (podId: string, code: string) =>
    `tytus exec --pod ${podId} "openclaw pairing approve <channel> ${code || '<CODE>'}"`,
} as const;

const CHANNEL_GUIDES: Record<string, ChannelGuide> = {
  telegram: {
    blurb:
      'Telegram bots are created by talking to @BotFather inside Telegram itself.',
    steps: [
      'Open Telegram and search for @BotFather, then start a chat with it.',
      'Send /newbot, pick a display name, then a username ending in "bot".',
      'BotFather replies with an HTTP API token — copy it and paste below.',
    ],
    open: {
      url: 'https://t.me/BotFather',
      label: 'Open @BotFather in Telegram',
    },
    tokenPlaceholder: '123456789:AAH...your-bot-token',
    tokenShape: 'Looks like 1234567890:ABCdef… (digits, colon, then ~35 chars)',
    pairing: {
      ...openclawPairing,
      approveCommand: (podId, code) =>
        `tytus exec --pod ${podId} "openclaw pairing approve telegram ${code || '<CODE>'}"`,
    },
  },
  discord: {
    blurb:
      'Discord bots live in the Developer Portal. You create an Application, add a Bot user, then copy its token.',
    steps: [
      'Open the Discord Developer Portal and click "New Application".',
      'In the sidebar choose "Bot", then click "Reset Token" and copy the value.',
      'Under "Privileged Gateway Intents" enable Message Content if your bot reads messages.',
      'Use OAuth2 → URL Generator to invite the bot to your server (scopes: bot, applications.commands).',
    ],
    open: {
      url: 'https://discord.com/developers/applications',
      label: 'Open Discord Developer Portal',
    },
    tokenPlaceholder: 'MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.your-bot-token',
    tokenShape: 'Three dot-separated base64 segments (~70 chars total)',
    pairing: {
      ...openclawPairing,
      approveCommand: (podId, code) =>
        `tytus exec --pod ${podId} "openclaw pairing approve discord ${code || '<CODE>'}"`,
    },
  },
  slack: {
    blurb:
      'Slack bots are Slack Apps. Create one, install it to your workspace, then copy the Bot User OAuth Token.',
    steps: [
      'Open api.slack.com/apps and click "Create New App" → "From scratch".',
      'Pick a name and the workspace to install into.',
      'Under "OAuth & Permissions", add bot scopes (e.g. chat:write, app_mentions:read).',
      'Click "Install to Workspace", approve, then copy the "Bot User OAuth Token".',
    ],
    open: {
      url: 'https://api.slack.com/apps',
      label: 'Open Slack API Console',
    },
    tokenPlaceholder: 'xoxb-your-slack-bot-token',
    tokenShape: 'Starts with xoxb- (Bot User OAuth Token)',
    pairing: {
      ...openclawPairing,
      approveCommand: (podId, code) =>
        `tytus exec --pod ${podId} "openclaw pairing approve slack ${code || '<CODE>'}"`,
    },
  },
  line: {
    blurb:
      'LINE bots use the Messaging API. Create a provider + channel, then issue a long-lived channel access token.',
    steps: [
      'Open developers.line.biz/console and sign in with your LINE Business account.',
      'Create a Provider (or pick an existing one), then add a "Messaging API" channel.',
      'On the channel\'s "Messaging API" tab, scroll to "Channel access token (long-lived)" and click Issue.',
      'Copy the issued token and paste it below.',
    ],
    open: {
      url: 'https://developers.line.biz/console/',
      label: 'Open LINE Developers Console',
    },
    tokenPlaceholder: 'long-base64-string-from-line-console',
    tokenShape: 'Long base64-ish string (~170 chars)',
    pairing: {
      ...openclawPairing,
      approveCommand: (podId, code) =>
        `tytus exec --pod ${podId} "openclaw pairing approve line ${code || '<CODE>'}"`,
    },
  },
  whatsapp: {
    auth: 'qr',
    blurb:
      'WhatsApp uses your phone\'s WhatsApp Web pairing — no bot token. You\'ll scan a QR code from your terminal with the WhatsApp app.',
    steps: [
      'Click "Open terminal command" below to copy the start-pairing command.',
      'Paste it into Terminal.app on your Mac and press Enter — a QR code appears in the window.',
      'On your phone, open WhatsApp → Settings → Linked Devices → "Link a Device" and scan the QR.',
      'Once the terminal prints "WhatsApp linked", come back here and click Done.',
    ],
    tokenPlaceholder: '',
    tokenShape: '',
    qrCommand: (podId) =>
      `tytus exec --pod ${podId} "openclaw channels login --channel whatsapp"`,
    pairing: {
      ...openclawPairing,
      approveCommand: (podId, code) =>
        `tytus exec --pod ${podId} "openclaw pairing approve whatsapp ${code || '<CODE>'}"`,
    },
  },
};

const DEFAULT_GUIDE: ChannelGuide = {
  blurb:
    'Paste the bot/API token issued by this provider. The token never leaves your pod.',
  steps: [
    'Open the provider\'s developer portal and create a bot or app.',
    'Copy the access token / bot token from that portal.',
    'Paste it into the field below.',
  ],
  tokenPlaceholder: 'Paste your bot token',
  tokenShape: '',
};

const guideFor = (channelType: string): ChannelGuide =>
  CHANNEL_GUIDES[channelType.toLowerCase()] ?? DEFAULT_GUIDE;

// ============================================================
// Add channel modal — token-secure
// ============================================================

interface AddChannelModalProps {
  podId: string;
  channelType: string;
  channelLabel: string;
  /** Closes the modal. */
  onCancel: () => void;
  /**
   * Token saved successfully. Parent should refresh its channel list
   * + show a notification, but MUST NOT unmount the modal — for
   * pairing-flow channels (Telegram/Discord/Slack) the user still
   * needs to see the follow-up panel.
   */
  onTokenSaved: () => void;
}

const AddChannelModal: FC<AddChannelModalProps> = ({
  podId,
  channelType,
  channelLabel,
  onCancel,
  onTokenSaved,
}) => {
  const client = useDaemonClient();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  // After a successful POST we swap the modal body to a pairing
  // approval panel for OpenClaw-based channels (telegram/discord/slack).
  // For channels with no `pairing` field we close immediately.
  const [pairingStage, setPairingStage] = useState(false);

  const guide = useMemo(() => guideFor(channelType), [channelType]);

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
    onTokenSaved();
    if (guide.pairing) {
      // Stay open and walk the user through pairing approval.
      setPairingStage(true);
    } else {
      // No pairing flow — close immediately.
      onCancel();
    }
  }, [client, podId, channelType, token, onTokenSaved, onCancel, guide.pairing]);

  // Esc closes from any stage. Use a ref so the latest handler is
  // captured without resubscribing on every keystroke.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(e) => {
        // Click on the dimmed backdrop closes; clicks inside the
        // panel itself stop propagation below.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-[560px] max-h-[90vh] rounded-xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-window, #1E1E1E)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex flex-col">
            <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              {pairingStage && (
                <CheckCircle2 size={14} style={{ color: 'var(--accent-success)' }} />
              )}
              {pairingStage
                ? `Token saved — final step`
                : `Connect ${channelLabel} to Pod ${podId}`}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
              {pairingStage
                ? `Approve your ${channelLabel} user ID so the bot will respond to you.`
                : guide.blurb}
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="p-1 rounded-sm transition-colors shrink-0 ml-3"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={14} />
          </button>
        </div>

        {pairingStage && guide.pairing ? (
          <PairingStagePanel
            podId={podId}
            channelLabel={channelLabel}
            pairing={guide.pairing}
          />
        ) : guide.auth === 'qr' ? (
          <QrSetupPanel
            podId={podId}
            channelLabel={channelLabel}
            guide={guide}
          />
        ) : (
        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
          {/* How-to guide */}
          <div
            className="rounded-lg overflow-hidden"
            style={{
              background: 'var(--bg-card, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => setGuideOpen((v) => !v)}
              className="w-full px-3.5 py-2.5 flex items-center gap-2 text-left transition-colors"
              style={{ color: 'var(--text-primary)' }}
            >
              {guideOpen ? (
                <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
              ) : (
                <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
              )}
              <span className="text-[12px] font-semibold flex-1">
                How do I get a {channelLabel} token?
              </span>
              {guide.open && guideOpen && (
                <a
                  href={guide.open.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10.5px] font-medium transition-colors"
                  style={{
                    background: 'var(--accent-primary)',
                    color: '#fff',
                  }}
                >
                  <ExternalLink size={10} />
                  {guide.open.label}
                </a>
              )}
            </button>
            {guideOpen && (
              <div className="px-3.5 pb-3.5 pt-0">
                <ol className="flex flex-col gap-2">
                  {guide.steps.map((step, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-[12px] leading-relaxed"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      <span
                        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold mt-0.5"
                        style={{
                          background: 'var(--accent-primary)',
                          color: '#fff',
                        }}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1">{step}</span>
                    </li>
                  ))}
                </ol>
                {guide.tokenShape && (
                  <div
                    className="mt-3 pt-2.5 text-[11px]"
                    style={{
                      borderTop: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      What it looks like:
                    </span>{' '}
                    {guide.tokenShape}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Token input */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="tytus-channel-secret"
              className="text-[11px] font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              {channelLabel} bot token
            </label>
            <div className="relative">
              <input
                className="w-full px-3 py-2 pr-10 rounded-md rounded-input text-xs font-mono outline-none"
                id="tytus-channel-secret"
                // Non-credit-card-shaped name so password managers
                // don't auto-fill saved logins into a bot-token field.
                name="tytus-channel-secret"
                type={showToken ? 'text' : 'password'}
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
                placeholder={guide.tokenPlaceholder}
                style={{
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                }}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label={showToken ? 'Hide token' : 'Show token'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
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
              color: 'var(--accent-warning)',
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
                color: 'var(--accent-error)',
              }}
            >
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div className="flex-1">{submitErr}</div>
            </div>
          )}
        </div>
        )}

        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {pairingStage || guide.auth === 'qr' ? (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors"
              style={{ background: 'var(--accent-primary)' }}
            >
              Done
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Pairing approval panel — OpenClaw bot ownership flow
// ============================================================
//
// After the bot token is saved, the user still has to approve their
// own messenger account before the bot will respond. OpenClaw's flow:
//
//   1. User messages the bot in Telegram/Discord/Slack
//   2. Bot replies "OpenClaw: access not configured" + your user_id
//      + a short pairing code (e.g. B7KFBXYA)
//   3. User runs `openclaw pairing approve <channel> <code>` inside
//      the pod — easiest from the host via `tytus exec`
//
// The panel walks them through this with a typeable code field and
// a one-click copy button for the exact command to paste into a
// terminal on their Mac.

interface PairingStagePanelProps {
  podId: string;
  channelLabel: string;
  pairing: NonNullable<ChannelGuide['pairing']>;
}

const PairingStagePanel: FC<PairingStagePanelProps> = ({
  podId,
  channelLabel,
  pairing,
}) => {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const command = useMemo(
    () => pairing.approveCommand(podId, code.trim().toUpperCase()),
    [pairing, podId, code],
  );

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      // Reset the "copied" affordance after a beat so the user can
      // copy again if they re-edit the code.
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // navigator.clipboard requires a secure context. Worst case the
      // user can still select-and-copy the rendered text.
    }
  }, [command]);

  return (
    <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
      <div
        className="rounded-lg p-3.5"
        style={{
          background: 'rgba(76,175,80,0.10)',
          border: '1px solid rgba(76,175,80,0.30)',
        }}
      >
        <div className="flex items-start gap-2">
          <CheckCircle2 size={16} style={{ color: 'var(--accent-success)' }} className="shrink-0 mt-0.5" />
          <div className="text-[12px] leading-relaxed text-[var(--text-primary)]">
            <span className="font-semibold">Bot token saved.</span>{' '}
            The {channelLabel} bot is now connected to Pod {podId}. One
            more step to authorize you as its owner.
          </div>
        </div>
      </div>

      <ol className="flex flex-col gap-2.5">
        <li className="flex items-start gap-2.5 text-[12px] leading-relaxed text-[var(--text-primary)]">
          <span
            className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold mt-0.5"
            style={{ background: 'var(--accent-primary)', color: '#fff' }}
          >
            1
          </span>
          <span className="flex-1">{pairing.howToGetCode}</span>
        </li>
        <li className="flex items-start gap-2.5 text-[12px] leading-relaxed text-[var(--text-primary)]">
          <span
            className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold mt-0.5"
            style={{ background: 'var(--accent-primary)', color: '#fff' }}
          >
            2
          </span>
          <span className="flex-1">
            Paste the 8-character pairing code below.
          </span>
        </li>
        <li className="flex items-start gap-2.5 text-[12px] leading-relaxed text-[var(--text-primary)]">
          <span
            className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold mt-0.5"
            style={{ background: 'var(--accent-primary)', color: '#fff' }}
          >
            3
          </span>
          <span className="flex-1">
            Copy the generated command and run it from a terminal on
            your Mac. You'll then receive a confirmation reply in the
            messenger.
          </span>
        </li>
      </ol>

      {/* Pairing code input */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="tytus-pairing-code"
          className="text-[11px] font-medium"
          style={{ color: 'var(--text-secondary)' }}
        >
          Pairing code
        </label>
        <input
          id="tytus-pairing-code"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\s+/g, '').toUpperCase().slice(0, 16))
          }
          placeholder="e.g. B7KFBXYA"
          className="w-full px-3 py-2 rounded-md rounded-input text-sm font-mono outline-none tracking-wider"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        />
      </div>

      {/* Generated command */}
      <div className="flex flex-col gap-1.5">
        <div className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          Run this in your terminal
        </div>
        <div
          className="rounded-md flex items-stretch overflow-hidden"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
          }}
        >
          <code
            className="flex-1 px-3 py-2 text-[11.5px] font-mono break-all"
            style={{ color: 'var(--text-primary)' }}
          >
            {command}
          </code>
          <button
            type="button"
            onClick={onCopy}
            disabled={!code.trim()}
            className="px-3 inline-flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50"
            style={{
              background: copied ? 'rgba(76,175,80,0.15)' : 'var(--bg-titlebar)',
              color: copied ? '#A5D6A7' : 'var(--text-primary)',
              borderLeft: '1px solid var(--border-default)',
            }}
          >
            {copied ? (
              <>
                <Check size={12} /> Copied
              </>
            ) : (
              <>
                <Copy size={12} /> Copy
              </>
            )}
          </button>
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>
          Requires the <code>tytus</code> CLI installed on your Mac and a
          connected pod. Re-run for each user you want to authorize.
        </div>
      </div>
    </div>
  );
};

// ============================================================
// QR setup panel — WhatsApp-style "scan from your phone" flow
// ============================================================
//
// Some channels (notably WhatsApp) authenticate by linking a phone
// session via QR code rather than a bot token. The user runs an
// `openclaw channels login --channel <name>` command inside the pod
// (wrapped in `tytus exec`); a QR appears in the terminal; they scan
// it with their phone's app. The daemon-side channel record is
// created by the agent itself when the link completes — we don't
// POST a token from this panel.

interface QrSetupPanelProps {
  podId: string;
  channelLabel: string;
  guide: ChannelGuide;
}

const QrSetupPanel: FC<QrSetupPanelProps> = ({
  podId,
  channelLabel,
  guide,
}) => {
  const [copied, setCopied] = useState(false);

  const command = useMemo(
    () => guide.qrCommand?.(podId) ?? '',
    [guide, podId],
  );

  const onCopy = useCallback(async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Secure-context only; fall back to manual selection.
    }
  }, [command]);

  return (
    <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
      <div
        className="rounded-lg p-3.5"
        style={{
          background: 'rgba(37,211,102,0.10)',
          border: '1px solid rgba(37,211,102,0.30)',
        }}
      >
        <div className="text-[12px] leading-relaxed text-[var(--text-primary)]">
          <span className="font-semibold">{channelLabel} uses QR linking,
          not a bot token.</span>{' '}
          The pod will print a QR you scan with your phone — once linked,
          the bot becomes reachable at your existing {channelLabel}
          number.
        </div>
      </div>

      {/* Numbered steps */}
      <ol className="flex flex-col gap-2.5">
        {guide.steps.map((step, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-[12px] leading-relaxed text-[var(--text-primary)]"
          >
            <span
              className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold mt-0.5"
              style={{ background: 'var(--accent-primary)', color: '#fff' }}
            >
              {i + 1}
            </span>
            <span className="flex-1">{step}</span>
          </li>
        ))}
      </ol>

      {/* The pairing-start command */}
      {command && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            Run this in your Mac terminal
          </div>
          <div
            className="rounded-md flex items-stretch overflow-hidden"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
            }}
          >
            <code
              className="flex-1 px-3 py-2 text-[11.5px] font-mono break-all"
              style={{ color: 'var(--text-primary)' }}
            >
              {command}
            </code>
            <button
              type="button"
              onClick={onCopy}
              className="px-3 inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
              style={{
                background: copied ? 'rgba(76,175,80,0.15)' : 'var(--bg-titlebar)',
                color: copied ? '#A5D6A7' : 'var(--text-primary)',
                borderLeft: '1px solid var(--border-default)',
              }}
            >
              {copied ? (
                <>
                  <Check size={12} /> Copied
                </>
              ) : (
                <>
                  <Copy size={12} /> Copy
                </>
              )}
            </button>
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>
            Keep the terminal window open while scanning — closing it
            cancels the pairing.
          </div>
        </div>
      )}

      {/* Pairing approval reminder for QR channels that also gate
          per-user access (whatsapp does). Surfacing it here saves the
          user from a second visit when their first message bounces. */}
      {guide.pairing && (
        <div
          className="rounded-lg p-3.5 flex flex-col gap-1"
          style={{
            background: 'var(--bg-card, rgba(255,255,255,0.03))',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div className="text-[12px] font-semibold text-[var(--text-primary)]">
            After linking: approve your own number
          </div>
          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The first time you message the bot from {channelLabel} it
            will reply with an 8-character pairing code. Approve
            yourself by running:
            <code
              className="block mt-1.5 px-2 py-1.5 rounded-md text-[10.5px] font-mono"
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
              }}
            >
              {guide.pairing.approveCommand(podId, '')}
            </code>
          </div>
        </div>
      )}
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

  // Esc dismisses the confirm modal — same pattern as AddChannelModal.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-[440px] rounded-xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-window, #1E1E1E)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(244,67,54,0.12)',
              border: '1px solid rgba(244,67,54,0.30)',
            }}
          >
            <Trash2 size={16} style={{ color: 'var(--accent-error)' }} />
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
                  color: 'var(--accent-error)',
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
            style={{ background: 'var(--accent-error)' }}
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Remove
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// "More channels" footer — agent-aware, grandma-friendly
// ============================================================
//
// The Available list above is server-driven by the daemon's small
// hardcoded registry (`tytus-cli/cli/src/channels.rs::REGISTRY`,
// currently 4 entries). The agent running inside the pod supports
// many more — OpenClaw alone ships 20+ messenger extensions.
//
// This footer:
//   - Acknowledges the gap so users don't think "Discord/Slack/Line/
//     Telegram is all I get".
//   - Shows agent-specific copy (OpenClaw vs Hermes have very
//     different feature surfaces).
//   - Offers a one-click path to set up an unlisted channel: open the
//     in-OS Terminal in shell mode, with the right `tytus exec`
//     command pre-copied to the clipboard so the user just pastes
//     and hits Enter.
//   - Links to the agent's own docs.

interface MoreChannelsFooterProps {
  podId: string;
  /** Full agent record for the active pod, or null if not found yet. */
  agent: Agent | null;
}

interface AgentAd {
  /** Friendly headline for the card. */
  title: string;
  /** One-paragraph blurb suitable for non-technical users. */
  description: string;
  /** Comma-joined teaser of channels the agent supports beyond the
   *  daemon registry. Used as the "find more" preview line. */
  examples: string;
  /** Public docs URL — opens in a new tab. */
  docsUrl: string;
  /** Friendly button label for the docs link. */
  docsLabel: string;
  /** Pod-side command pre-copied to the user's clipboard before
   *  they jump to the terminal. The command itself is wrapped in
   *  `tytus exec --pod NN "..."` so it runs inside the pod. */
  primaryCommand: (podId: string) => string;
  /** Short hint that appears next to the primary copy button. */
  primaryHint: string;
  /**
   * Whether this agent has an in-pod web chat the user can talk to.
   * When true, we surface a "Chat with your agent" button (primary)
   * that opens `${ui_url}/chat?session=main` — the user can then
   * just say "connect WhatsApp" in plain English.
   */
  hasChat: boolean;
  /**
   * Suggested phrasing surfaced under the chat CTA — gives non-
   * technical users a working sample of what to say to the agent.
   */
  chatExamples: string[];
}

const OPENCLAW_AD: AgentAd = {
  title: 'Want WhatsApp, Signal, iMessage and more?',
  description:
    'Your AI agent (OpenClaw) supports 20+ messengers out of the box. The list above is the short menu — for anything else, the easiest way is just to ask the agent in plain English.',
  examples:
    'WhatsApp · Signal · iMessage · Matrix · Microsoft Teams · Google Chat · Mattermost · IRC · Twitch · QQ · Nostr · Feishu · Synology Chat · …',
  docsUrl: 'https://docs.openclaw.ai/',
  docsLabel: 'Open OpenClaw docs',
  primaryCommand: (podId) =>
    `tytus exec --pod ${podId} "openclaw channels list"`,
  primaryHint:
    'Or for the technical route: lists every channel installed in your pod with the exact setup command for each.',
  hasChat: true,
  chatExamples: [
    '"Connect WhatsApp"',
    '"Add Discord to this pod"',
    '"How do I link my Signal account?"',
  ],
};

const AGENT_ADS: Record<string, AgentAd> = {
  nemoclaw: OPENCLAW_AD,
  openclaw: OPENCLAW_AD,
  hermes: {
    title: 'Need a custom channel?',
    description:
      'Your AI agent (Hermes) is a CLI/HTTP gateway — channels aren\'t pre-bundled the way OpenClaw bundles them. You wire them in through Hermes\' messaging gateway. The docs walk you through it step by step.',
    examples:
      'Custom HTTP webhooks · Slack/Discord via gateway plugin · Email · Voice · whatever you script',
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging',
    docsLabel: 'Open Hermes Messaging guide',
    primaryCommand: (podId) =>
      `tytus exec --pod ${podId} "hermes gateway --help"`,
    primaryHint:
      'Shows the messaging-gateway flags so you can pick the wiring that fits your channel.',
    hasChat: false,
    chatExamples: [],
  },
};

const DEFAULT_AGENT_AD: AgentAd = {
  title: 'Want more channels?',
  description:
    'Your AI agent likely supports more channels than the four shown above — open a terminal inside your pod to see what\'s available and set them up.',
  examples: '',
  docsUrl: 'https://docs.openclaw.ai/',
  docsLabel: 'Open agent docs',
  primaryCommand: (podId) => `tytus exec --pod ${podId} "ls"`,
  primaryHint:
    'Opens a quick check inside your pod. Run any setup command from there.',
  hasChat: false,
  chatExamples: [],
};

const MoreChannelsFooter: FC<MoreChannelsFooterProps> = ({
  podId,
  agent,
}) => {
  const { dispatch } = useOS();
  const [copied, setCopied] = useState(false);

  const ad = useMemo<AgentAd>(() => {
    const t = agent?.agent_type;
    if (!t) return DEFAULT_AGENT_AD;
    return AGENT_ADS[t.toLowerCase()] ?? DEFAULT_AGENT_AD;
  }, [agent]);

  const command = useMemo(() => ad.primaryCommand(podId), [ad, podId]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Secure context only; manual select still works as fallback.
    }
  }, [command]);

  const onOpenTerminal = useCallback(async () => {
    // Copy the command first so the moment the terminal opens the
    // user can just Cmd-V + Enter — no typing required.
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // best effort
    }
    dispatch({
      type: 'OPEN_WINDOW',
      appId: 'terminal',
      args: { terminal: { command: 'shell' } },
    });
  }, [command, dispatch]);

  const chatAvailable = ad.hasChat && !!agent;

  // The ui_url is a Secret (it carries a session token). We only
  // reveal-and-resolve at click time so the gesture-tagged reveal
  // is genuinely tied to a user action, not render. Build the URL,
  // then immediately hand it to window.open and drop it.
  const onOpenChat = useCallback(() => {
    if (!agent) return;
    try {
      const base = revealTokenUrl(agent.ui_url, 'user_gesture');
      const u = new URL(base);
      u.pathname = '/chat';
      u.searchParams.set('session', 'main');
      window.open(u.toString(), '_blank', 'noopener,noreferrer');
    } catch {
      // Malformed ui_url — silently no-op; the button shouldn't
      // be reachable in this state because chatAvailable guards it.
    }
  }, [agent]);

  return (
    <div className="px-5 pb-5">
      <div
        className="rounded-xl p-4 flex flex-col gap-3.5"
        style={{
          background:
            'linear-gradient(135deg, rgba(124,77,255,0.10), rgba(124,77,255,0.04))',
          border: '1px solid rgba(124,77,255,0.25)',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #7C4DFF, #4A148C)',
            }}
          >
            <Sparkles size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {ad.title}
            </div>
            <div className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {ad.description}
            </div>
            {ad.examples && (
              <div
                className="mt-2 text-[11px] leading-relaxed"
                style={{ color: 'var(--text-disabled)' }}
              >
                {ad.examples}
              </div>
            )}
          </div>
        </div>

        {/* Easy way: chat with the agent in plain English. Only shown
            for agents that ship a chat UI (currently OpenClaw). */}
        {chatAvailable && (
          <div
            className="rounded-lg p-3.5 flex flex-col gap-2.5"
            style={{
              background: 'rgba(76,175,80,0.10)',
              border: '1px solid rgba(76,175,80,0.30)',
            }}
          >
            <div className="flex items-start gap-2">
              <MessageCircle
                size={16}
                style={{ color: 'var(--accent-success)' }}
                className="shrink-0 mt-0.5"
              />
              <div className="flex-1">
                <div className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                  Easiest way: just ask your agent
                </div>
                <div className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Open the agent's chat and say what you want to connect — it'll walk you through the rest, no commands required.
                </div>
              </div>
            </div>
            {ad.chatExamples.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-6">
                {ad.chatExamples.map((ex) => (
                  <span
                    key={ex}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {ex}
                  </span>
                ))}
              </div>
            )}
            <div className="pl-6">
              <button
                type="button"
                onClick={onOpenChat}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[11px] font-semibold text-white transition-colors"
                style={{ background: 'var(--accent-success)' }}
              >
                <MessageCircle size={12} />
                Chat with your agent
              </button>
            </div>
          </div>
        )}

        {/* Subtle divider for the technical path. Only render if both
            paths are present — keeps the Hermes / no-chat case clean. */}
        {chatAvailable && (
          <div
            className="text-[10px] uppercase tracking-wider font-semibold pl-1"
            style={{ color: 'var(--text-disabled)' }}
          >
            Or — the technical route
          </div>
        )}

        {/* Pre-filled "first command" with copy button */}
        <div className="flex flex-col gap-1.5">
          <div
            className="rounded-md flex items-stretch overflow-hidden"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
            }}
          >
            <code
              className="flex-1 px-3 py-2 text-[11.5px] font-mono break-all"
              style={{ color: 'var(--text-primary)' }}
            >
              {command}
            </code>
            <button
              type="button"
              onClick={onCopy}
              className="px-3 inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
              style={{
                background: copied ? 'rgba(76,175,80,0.15)' : 'var(--bg-titlebar)',
                color: copied ? '#A5D6A7' : 'var(--text-primary)',
                borderLeft: '1px solid var(--border-default)',
              }}
            >
              {copied ? (
                <>
                  <Check size={12} /> Copied
                </>
              ) : (
                <>
                  <Copy size={12} /> Copy
                </>
              )}
            </button>
          </div>
          <div className="text-[10.5px]" style={{ color: 'var(--text-disabled)' }}>
            {ad.primaryHint}
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onOpenTerminal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors"
            style={{
              // When Chat is the recommended path we demote the
              // terminal button to a secondary outline so the primary
              // visual hierarchy points at the chat CTA above.
              background: chatAvailable ? 'transparent' : 'var(--accent-primary)',
              color: chatAvailable ? 'var(--text-primary)' : '#fff',
              border: chatAvailable ? '1px solid var(--border-default)' : 'none',
            }}
          >
            <TerminalIcon size={12} />
            Open pod terminal
          </button>
          <a
            href={ad.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
            }}
          >
            <BookOpen size={12} />
            {ad.docsLabel}
          </a>
          <div
            className="text-[10px] ml-1"
            style={{ color: 'var(--text-disabled)' }}
          >
            The command is already on your clipboard — paste it (Cmd-V) and press Enter.
          </div>
        </div>
      </div>
    </div>
  );
};

export default Channels;
