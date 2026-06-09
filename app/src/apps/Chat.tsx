// ============================================================
// Chat — Tytus pod agent chat
// ============================================================
//
// Tytus OS ships a light same-origin chat surface for running pod agents.
// The tray forwards through the user's authenticated provider account to
// Cortex first, then falls back to the direct agent completion bridge when
// Cortex is still warming up.
//
// Layout:
//   ┌─ Sidebar (180px) ─┬─ Main pane ───────────────────────────────┐
//   │ Pods              │   Pod 02 · OpenClaw                       │
//   │ ─────             │   [messages]                              │
//   │ ● Pod 02          │   [input] [send]                          │
//   │ ─────             │   Visit / Channels / Clear actions        │
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

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Trash2,
  Settings as SettingsIcon,
  Hash,
  MessageCircle,
} from "lucide-react";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import { useI18n } from "@/i18n";
import { navigate } from "@/lib/router";
import { includedLabel } from "@/lib/includedLabel";
import { resolveAgentDisplay } from "@/lib/agentCatalog";
import { getChannelLauncher } from "@/lib/chatChannelLaunchers";
import { sanitizeVisibleAgentText } from "@/runtime/agent-chat";
import type {
  Agent,
  ChannelsResponse,
  ConfiguredChannel,
  IncludedPod,
} from "@/types/daemon";

const AIL_DOCS_URL = "https://ail.traylinx.com/introduction";

type Selection =
  | { kind: "agent"; id?: string; pod_id: string; route_id?: string }
  | { kind: "included"; id?: string; pod_id: string; route_id?: string }
  | null;

type ChannelsLoad =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: ChannelsResponse }
  | { status: "error"; message: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceLabel?: string;
  pending?: boolean;
  createdAt: number;
};

const chatSessionKey = (accountKey: string, podId: string) =>
  `tytus_os_agent_chat_session:${accountKey}:${podId}`;
const chatMessagesKey = (accountKey: string, podId: string) =>
  `tytus_os_agent_chat_messages:${accountKey}:${podId}`;

const podIdentity = (pod: { id?: string; pod_id: string; route_id?: string }) =>
  pod.id || pod.route_id || pod.pod_id;

const selectionMatches = (
  selection: Exclude<Selection, null>,
  pod: { id?: string; pod_id: string; route_id?: string },
) =>
  selection.id
    ? selection.id === podIdentity(pod)
    : selection.route_id
    ? selection.route_id === pod.route_id
    : selection.pod_id === pod.pod_id;

const newMessageId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const safePodLabel = (agent: Agent, t: ReturnType<typeof useI18n>["t"]) =>
  (
    agent.display_label?.trim() ||
    agent.display_name?.trim() ||
    t("chat.sidebar.podLabel", { podId: agent.pod_id })
  ).slice(0, 80);

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
  const [channels, setChannels] = useState<ChannelsLoad>({ status: "idle" });

  // If the selected agent disappears (revoke from another surface),
  // drop the selection so the empty/picker state takes over cleanly.
  useEffect(() => {
    if (!selection) return;
    const stillThere =
      selection.kind === "agent"
        ? agents.some((a) => selectionMatches(selection, a))
        : included.some((p) => selectionMatches(selection, p));
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
    if (!selection || selection.kind !== "agent") {
      setChannels({ status: "idle" });
      return;
    }
    const podId = selection.id || selection.route_id || selection.pod_id;
    let cancelled = false;
    setChannels({ status: "loading" });
    client.getChannels(podId).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setChannels({ status: "ok", data: r.value });
      } else {
        setChannels({ status: "error", message: r.error.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, selection]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectAgent = useCallback((agent: Agent) => {
    setSelection({
      kind: "agent",
      id: podIdentity(agent),
      pod_id: agent.pod_id,
      route_id: agent.route_id,
    });
    setOpenError(null);
  }, []);

  const selectIncluded = useCallback((pod: IncludedPod) => {
    setSelection({
      kind: "included",
      id: podIdentity(pod),
      pod_id: pod.pod_id,
      route_id: pod.route_id,
    });
    setOpenError(null);
  }, []);

  const onAllocate = useCallback(() => {
    dispatch({ type: "OPEN_WINDOW", appId: "settings" });
    navigate({
      kind: "settings",
      section: "agents",
      params: new URLSearchParams(),
    });
  }, [dispatch]);

  const onOpenInBrowser = useCallback(async () => {
    if (!selection || selection.kind !== "agent") return;
    const selector = selection.id || selection.route_id || selection.pod_id;
    setOpening(true);
    setOpenError(null);
    const r = await client.postPodOpen(selector);
    setOpening(false);
    if (!r.ok) {
      setOpenError(
        t("chat.agent.openError", {
          podId: selection.pod_id,
          message: r.error.message,
        }),
      );
    }
  }, [client, selection, t]);

  const onOpenChannels = useCallback(
    (podId: string) => {
      dispatch({ type: "OPEN_WINDOW", appId: "channels" });
      navigate({
        kind: "pod",
        podId,
        action: "channels",
        params: new URLSearchParams(),
      });
    },
    [dispatch],
  );

  const onOpenPodInspector = useCallback(() => {
    dispatch({ type: "OPEN_WINDOW", appId: "pod-inspector" });
  }, [dispatch]);

  const totalPods = agents.length + included.length;

  return (
    <div className="flex h-full" style={{ background: "var(--bg-window)" }}>
      {/* ─────────────── Sidebar ─────────────── */}
      <div
        className="w-[180px] shrink-0 flex flex-col"
        style={{
          background: "var(--bg-titlebar)",
          borderRight: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold flex items-center gap-2"
          style={{ color: "var(--text-secondary)" }}
        >
          <MessageSquare size={12} />
          {t("chat.sidebar.podsHeader")}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {agents.length === 0 && included.length === 0 && (
            <div
              className="px-4 py-3 text-[11px]"
              style={{ color: "var(--text-disabled)" }}
            >
              {daemon.state
                ? t("chat.sidebar.empty")
                : t("chat.sidebar.loading")}
            </div>
          )}

          {agents.map((a) => {
            const active =
              selection?.kind === "agent" && selectionMatches(selection, a);
            return (
              <button
                key={`agent-${podIdentity(a)}`}
                onClick={() => selectAgent(a)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors"
                style={{
                  background: active ? "var(--bg-selected)" : "transparent",
                  color: active
                    ? "var(--accent-primary)"
                    : "var(--text-primary)",
                  borderLeft: active
                    ? "3px solid var(--accent-primary)"
                    : "3px solid transparent",
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: "var(--text-disabled)" }}
                  aria-hidden="true"
                />
                <Box size={12} className="shrink-0 opacity-70" />
                <span className="flex-1 truncate">{safePodLabel(a, t)}</span>
              </button>
            );
          })}

          {included.length > 0 && (
            <div
              className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("chat.sidebar.includedHeader")}
            </div>
          )}

          {included.map((p) => {
            const active =
              selection?.kind === "included" && selectionMatches(selection, p);
            const label = includedLabel(p, included);
            return (
              <button
                key={`included-${podIdentity(p)}`}
                onClick={() => selectIncluded(p)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors opacity-60"
                style={{
                  background: active ? "var(--bg-selected)" : "transparent",
                  color: active
                    ? "var(--accent-primary)"
                    : "var(--text-secondary)",
                  borderLeft: active
                    ? "3px solid var(--accent-primary)"
                    : "3px solid transparent",
                }}
                title={t("chat.ail.tooltip")}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: "var(--text-disabled)" }}
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
        ) : selection.kind === "agent" ? (
          <AgentChatPanel
            agent={
              agents.find((a) => selectionMatches(selection, a)) ?? {
                id: selection.id || selection.route_id || selection.pod_id,
                pod_id: selection.pod_id,
                route_id: selection.route_id,
                display_label: t("chat.sidebar.podLabel", {
                  podId: selection.pod_id,
                }),
                agent_type: "nemoclaw",
                api_url: "",
                public_url: "",
                ui_url: "" as never,
                user_key: "" as never,
                units: 1,
              }
            }
            client={client}
            accountKey={daemon.state?.email || "local"}
            channels={channels}
            opening={opening}
            error={openError}
            onOpen={onOpenInBrowser}
            onDismissError={() => setOpenError(null)}
            onOpenChannels={() =>
              onOpenChannels(selection.id || selection.route_id || selection.pod_id)
            }
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
          background: "var(--bg-card, rgba(255,255,255,0.03))",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "linear-gradient(135deg, #7C4DFF, #4A148C)" }}
        >
          <Rocket size={28} className="text-white" />
        </div>
        <div
          className="text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {t("chat.empty.title")}
        </div>
        <div
          className="text-xs mt-1.5 max-w-[300px] leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          {t("chat.empty.body")}
        </div>
        <button
          onClick={onAllocate}
          className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
          style={{ background: "var(--accent-primary)" }}
        >
          {t("chat.empty.cta")}
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
      style={{ color: "var(--text-secondary)" }}
    >
      {t("chat.picker.hint")}
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
    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors";
  const style = {
    background: "var(--bg-hover, rgba(255,255,255,0.04))",
    border: "1px solid var(--border-default)",
    color: "var(--text-primary)",
    textDecoration: "none" as const,
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
      style={{ ...style, cursor: "default", opacity: 0.7 }}
    >
      {inner}
    </span>
  );
};

interface AgentChatPanelProps {
  client: ReturnType<typeof useDaemonClient>;
  accountKey: string;
  agent: Agent;
  channels: ChannelsLoad;
  opening: boolean;
  error: string | null;
  onOpen: () => void;
  onDismissError: () => void;
  onOpenChannels: () => void;
}

type CortexStreamEvent = {
  event: string;
  data: unknown;
};

const parseSseBlock = (block: string): CortexStreamEvent | null => {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // Plain text chunks are valid enough for UI fallback.
  }
  return { event, data };
};

const eventTextChunk = (data: unknown): string => {
  if (typeof data === "string") return data === "[DONE]" ? "" : data;
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  if (typeof obj.chunk === "string") return obj.chunk;
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.delta === "string") return obj.delta;
  if (typeof obj.message === "string") return obj.message;
  return "";
};

const eventSessionId = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>).session_id;
  return typeof value === "string" && value.trim() ? value : null;
};

const eventErrorMessage = (data: unknown): string => {
  if (!data || typeof data !== "object") return "Agent chat failed.";
  const obj = data as Record<string, unknown>;
  return (
    (typeof obj.message === "string" && obj.message) ||
    (typeof obj.error === "string" && obj.error) ||
    "Agent chat failed."
  );
};

const readCortexStream = async (
  res: Response,
  onSession: (sessionId: string) => void,
  onChunk: (chunk: string) => void,
): Promise<void> => {
  if (!res.body) throw new Error("Agent stream is empty.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  let redactionTail = "";
  const flushChunk = (chunk: string, force = false) => {
    const combined = `${redactionTail}${chunk}`;
    const keep = 32;
    if (!force && combined.length <= keep) {
      redactionTail = combined;
      return;
    }
    const flushLength = force ? combined.length : combined.length - keep;
    if (flushLength > 0)
      onChunk(sanitizeVisibleAgentText(combined.slice(0, flushLength)));
    redactionTail = force ? "" : combined.slice(flushLength);
  };
  const consumeBlock = (block: string) => {
    const parsed = parseSseBlock(block);
    if (!parsed) return;
    if (parsed.event === "error")
      throw new Error(eventErrorMessage(parsed.data));
    const sessionId = eventSessionId(parsed.data);
    if (sessionId) onSession(sessionId);
    if (parsed.event === "done") {
      finished = true;
      return;
    }
    const chunk = eventTextChunk(parsed.data);
    if (chunk) flushChunk(chunk);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) consumeBlock(part);
    if (done || finished) break;
  }
  if (buffer.trim()) consumeBlock(buffer);
  flushChunk("", true);
};

const AgentChatPanel: FC<AgentChatPanelProps> = ({
  agent,
  client,
  accountKey,
  channels,
  opening,
  error,
  onOpen,
  onDismissError,
  onOpenChannels,
}) => {
  const { t } = useI18n();
  const display = resolveAgentDisplay(agent.agent_type, null, t);
  const podLabel = safePodLabel(agent, t);
  const sourceLabel = `${display.name} · ${podLabel}`;
  const agentStorageKey = podIdentity(agent);
  const agentSelector = agentStorageKey;
  const abortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setChatError(null);
    try {
      const rawMessages = localStorage.getItem(
        chatMessagesKey(accountKey, agentStorageKey),
      );
      setMessages(
        rawMessages ? (JSON.parse(rawMessages) as ChatMessage[]) : [],
      );
      setSessionId(
        localStorage.getItem(chatSessionKey(accountKey, agentStorageKey)),
      );
    } catch {
      setMessages([]);
      setSessionId(null);
    }
    return () => abortRef.current?.abort();
  }, [accountKey, agentStorageKey]);

  useEffect(() => {
    try {
      const trimmed = messages.slice(-100);
      localStorage.setItem(
        chatMessagesKey(accountKey, agentStorageKey),
        JSON.stringify(trimmed),
      );
    } catch {
      // Local transcript is best effort only.
    }
  }, [accountKey, agentStorageKey, messages]);

  const updateAssistant = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setMessages((current) =>
        current.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      );
    },
    [],
  );

  const persistSession = useCallback(
    (nextSessionId: string) => {
      setSessionId(nextSessionId);
      try {
        localStorage.setItem(
          chatSessionKey(accountKey, agentStorageKey),
          nextSessionId,
        );
      } catch {
        // best effort
      }
    },
    [accountKey, agentStorageKey],
  );

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setDraft("");
    setSending(true);
    setChatError(null);
    const userMessage: ChatMessage = {
      id: newMessageId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const assistantId = newMessageId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      sourceLabel,
      pending: true,
      createdAt: Date.now(),
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);

    const fallbackToDirectAgent = async () => {
      const direct = await client.postPodAgentChat(
        agentSelector,
        {
          message: text,
          route_id: agent.route_id,
          agent_identity_id: agent.agent_identity_id ?? null,
          session_id: sessionId,
          chat_target: "agent",
          agent_mode: "operator",
          model_preference: "balanced",
          stream: false,
        },
        controller.signal,
      );
      if (!direct.ok) throw new Error(direct.error.message);
      updateAssistant(assistantId, {
        content:
          sanitizeVisibleAgentText(direct.value.message) ||
          t("chat.agent.emptyResponse"),
        pending: false,
      });
    };

    try {
      const res = await client.postPodCortexChat(
        agentSelector,
        {
          message: text,
          route_id: agent.route_id,
          agent_identity_id: agent.agent_identity_id ?? null,
          session_id: sessionId,
          chat_target: "agent",
          agent_mode: "operator",
          model_preference: "balanced",
          stream: true,
        },
        controller.signal,
      );
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        if ([404, 502, 503, 504].includes(res.status)) {
          await fallbackToDirectAgent();
        } else {
          const body = await res.json().catch(() => null);
          throw new Error(eventErrorMessage(body));
        }
      } else if (contentType.includes("text/event-stream")) {
        let sawChunk = false;
        await readCortexStream(res, persistSession, (chunk) => {
          sawChunk = true;
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantId
                ? { ...m, content: `${m.content}${chunk}`, pending: true }
                : m,
            ),
          );
        });
        if (!sawChunk) {
          updateAssistant(assistantId, {
            content: t("chat.agent.finishedEmpty"),
            pending: false,
          });
        } else {
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: sanitizeVisibleAgentText(m.content),
                    pending: false,
                  }
                : m,
            ),
          );
        }
      } else {
        const body = await res.json().catch(() => null);
        const textBody = eventTextChunk(body);
        const maybeSession = eventSessionId(body);
        if (maybeSession) persistSession(maybeSession);
        updateAssistant(assistantId, {
          content:
            sanitizeVisibleAgentText(textBody) || t("chat.agent.emptyResponse"),
          pending: false,
        });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        updateAssistant(assistantId, {
          content: t("chat.agent.cancelled"),
          pending: false,
        });
      } else {
        const message =
          err instanceof Error ? err.message : "Agent chat failed.";
        setChatError(message);
        updateAssistant(assistantId, {
          content:
            message.includes("not ready") || message.includes("warming")
              ? t("chat.agent.warming")
              : t("chat.agent.chatFailed", { message }),
          pending: false,
        });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setSending(false);
      }
    }
  }, [
    agentSelector,
    agent.pod_id,
    agent.route_id,
    client,
    draft,
    persistSession,
    sending,
    sessionId,
    sourceLabel,
    t,
    updateAssistant,
  ]);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setChatError(null);
    setSessionId(null);
    try {
      localStorage.removeItem(chatSessionKey(accountKey, agent.pod_id));
      localStorage.removeItem(chatMessagesKey(accountKey, agent.pod_id));
      localStorage.removeItem(chatSessionKey(accountKey, agentStorageKey));
      localStorage.removeItem(chatMessagesKey(accountKey, agentStorageKey));
    } catch {
      // best effort
    }
  }, [accountKey, agent.pod_id, agentStorageKey]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="px-7 py-4 flex items-center gap-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        {display.icon ? (
          <img src={display.icon} alt="" width={38} height={38} />
        ) : (
          <Box size={34} className="text-[var(--accent-primary)]" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-[var(--text-primary)] truncate">
              {podLabel}
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border-default)] text-[var(--text-secondary)] uppercase tracking-wide">
              {display.name}
            </span>
            {agent.status && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                {agent.status}
              </span>
            )}
          </div>
          <div className="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
            {t("chat.agent.inlineTagline")}
          </div>
        </div>
        <button
          onClick={onOpen}
          disabled={opening}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-60"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          {opening ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ExternalLink size={13} />
          )}
          {t("chat.agent.visit")}
        </button>
        <button
          onClick={onOpenChannels}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          <SettingsIcon size={13} />
          {t("chat.agent.channels")}
        </button>
        <button
          onClick={clearChat}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-secondary)",
          }}
        >
          <Trash2 size={13} />
          {t("chat.agent.clear")}
        </button>
      </div>

      {channels.status === "ok" && channels.data.configured.length > 0 && (
        <div
          className="px-7 py-2 flex items-center gap-2 shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="text-[11px] text-[var(--text-secondary)]">
            {t("chat.agent.connectedApps")}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {channels.data.configured.map((c) => (
              <ChannelChip key={c.name} channel={c} />
            ))}
          </div>
        </div>
      )}

      {(error || chatError) && (
        <div
          className="mx-7 mt-4 flex items-start gap-2 px-3 py-2 rounded-md text-[12px]"
          style={{
            background: "rgba(244,67,54,0.10)",
            border: "1px solid rgba(244,67,54,0.30)",
            color: "#FFCDD2",
          }}
        >
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="flex-1">{chatError ?? error}</div>
          {error && (
            <button onClick={onDismissError} className="text-[11px] underline">
              {t("chat.agent.dismissError")}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-7 py-5">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center">
            <div className="max-w-[380px]">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {t("chat.agent.messageTitle", { pod: podLabel })}
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                {t("chat.agent.emptyHint")}
              </div>
              {channels.status === "ok" &&
                channels.data.configured.length > 0 && (
                  <div className="flex justify-center gap-2 flex-wrap mt-4">
                    {channels.data.configured.map((c) => (
                      <ChannelChip key={c.name} channel={c} />
                    ))}
                  </div>
                )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "self-end" : "self-start"}`}
                style={{
                  background:
                    m.role === "user"
                      ? "var(--accent-primary)"
                      : "var(--bg-card, rgba(255,255,255,0.04))",
                  color: m.role === "user" ? "white" : "var(--text-primary)",
                  border:
                    m.role === "user"
                      ? "none"
                      : "1px solid var(--border-subtle)",
                }}
              >
                {m.sourceLabel && (
                  <div className="text-[10px] uppercase tracking-wide mb-1 opacity-65">
                    {m.sourceLabel}
                  </div>
                )}
                <div className="whitespace-pre-wrap">
                  {m.content || (m.pending ? t("chat.agent.thinking") : "")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className="px-7 py-4 shrink-0"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        {sessionId && (
          <div className="text-[10px] text-[var(--text-disabled)] mb-2">
            {t("chat.agent.continuing")}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={t("chat.agent.placeholder", { pod: podLabel })}
            className="flex-1 min-h-[46px] max-h-[130px] resize-none rounded-xl px-3 py-3 text-sm outline-none bg-transparent"
            style={{
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
            disabled={sending}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!draft.trim() || sending}
            className="h-[46px] px-4 rounded-xl text-white font-semibold inline-flex items-center gap-2 disabled:opacity-45"
            style={{ background: "var(--accent-primary)" }}
          >
            {sending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            {t("chat.agent.send")}
          </button>
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
    t("chat.ail.feature.0"),
    t("chat.ail.feature.1"),
    t("chat.ail.feature.2"),
    t("chat.ail.feature.3"),
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
            style={{ display: "block" }}
          />
          <div className="flex-1 min-w-0 pt-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
              {t("chat.sidebar.includedHeader")}
            </div>
            <div className="text-[26px] font-bold tracking-tight text-[var(--text-primary)] leading-tight">
              {t("chat.ail.title")}
            </div>
            <div className="text-[13px] text-[var(--text-secondary)] mt-1 leading-snug">
              {t("chat.ail.tagline")}
            </div>
          </div>
        </div>

        <div className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
          {t("chat.ail.body")}
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
                  top: "0.45rem",
                  background: "var(--accent-primary, #7C4DFF)",
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
            style={{ background: "var(--accent-primary)" }}
          >
            <BookOpen size={13} />
            {t("chat.ail.cta.docs")}
            <span className="opacity-70">↗</span>
          </a>
          <button
            onClick={onOpenPodInspector}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            <SettingsIcon size={12} />
            {t("chat.ail.cta.podInspector")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
