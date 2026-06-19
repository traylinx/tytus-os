// ============================================================
// TytusChatHub — in-OS home for Tytus Chat
// ============================================================
//
// Replaces the old same-origin pod-chat surface. Tytus Chat
// (chat.traylinx.com) is now the real place to talk to your pods —
// they are DM-able teammates there, and replies run on the user's own
// pod. This window is an info board, not a chat client:
//
//   • Primary CTA opens Tytus Chat (web; the desktop client is a thin
//     Electron shell over the same URL).
//   • "Your pods" lists the user's agents as teammates (read-only).
//   • "Connected channels" surfaces the messengers (Telegram, Slack, …)
//     already bound to any pod, with a link to manage them in Channels.
//
// We deliberately do NOT poll pod readiness here (Pod Inspector owns
// that probe) and we do NOT send messages — that is Tytus Chat's job.

import { type FC, useEffect, useMemo, useState } from "react";
import {
  MessageCircle,
  ExternalLink,
  Box,
  Send,
  Hash,
  MessageSquare,
  Rocket,
  Settings as SettingsIcon,
} from "lucide-react";
import { useOS, useWindows } from "@/hooks/useOSStore";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import { useI18n } from "@/i18n";
import { TYTUS_CHAT_URL } from "@/lib/tytusChat";
import { resolveAgentDisplay } from "@/lib/agentCatalog";
import { getChannelLauncher } from "@/lib/chatChannelLaunchers";
import type { Agent } from "@/types/daemon";

const CHANNEL_ICONS: Record<string, FC<{ size?: number; style?: React.CSSProperties }>> = {
  Send,
  Hash,
  MessageCircle,
  MessageSquare,
};

interface HubChannel {
  name: string;
  label: string;
  icon: string;
  webUrl: string | null;
}

const podLabel = (
  agent: Agent,
  t: ReturnType<typeof useI18n>["t"],
): string =>
  (
    agent.display_label?.trim() ||
    agent.display_name?.trim() ||
    t("chat.sidebar.podLabel", { podId: agent.pod_id })
  ).slice(0, 80);

const TytusChatHub: FC = () => {
  const { t } = useI18n();
  const { state: osState } = useOS();
  const { openWindow } = useWindows();
  const client = useDaemonClient();
  const { state } = useDaemonStateContext();

  const agents: Agent[] = useMemo(() => state?.agents ?? [], [state]);
  const loggedIn = Boolean(state?.logged_in) && osState.auth.isAuthenticated;

  const [channels, setChannels] = useState<HubChannel[]>([]);

  // Aggregate configured channels across every pod. getChannels is
  // per-pod; we union by channel name so each messenger shows once even
  // when several pods share it. Non-fatal: any failed pod fetch is
  // simply skipped (an empty list renders the "connect a channel" state).
  useEffect(() => {
    if (!loggedIn || agents.length === 0) {
      setChannels([]);
      return;
    }
    const controller = new AbortController();
    // Dedupe the fetch by pod_id: /api/channels is keyed solely by pod_id
    // (`?pod=<pod_id>`), so two agents that share a pod_id resolve to the same
    // endpoint and the same channel set. We show a union across pods, so one
    // request per distinct pod_id is both sufficient and minimal — deduping by
    // the fuller route identity would only issue redundant identical requests.
    const podIds = Array.from(new Set(agents.map((a) => a.pod_id)));
    let cancelled = false;
    void Promise.all(
      podIds.map((podId) =>
        client
          .getChannels(podId, controller.signal)
          .then((r) => (r.ok ? r.value.configured : []))
          .catch(() => []),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const byName = new Map<string, HubChannel>();
      for (const list of lists) {
        for (const c of list) {
          const key = c.name.toLowerCase();
          if (byName.has(key)) continue;
          const launcher = getChannelLauncher(c.name);
          byName.set(key, {
            name: c.name,
            label: c.label || launcher.label,
            icon: launcher.icon,
            webUrl: launcher.webUrl,
          });
        }
      }
      setChannels(Array.from(byName.values()).sort((a, b) => a.label.localeCompare(b.label)));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agents, client, loggedIn]);

  const openChat = () =>
    window.open(TYTUS_CHAT_URL, "_blank", "noopener,noreferrer");

  return (
    <div
      className="h-full overflow-auto custom-scrollbar"
      style={{ background: "var(--bg-window)", color: "var(--text-primary)" }}
      data-testid="tytus-chat-hub"
    >
      <div className="mx-auto flex flex-col gap-5 p-6" style={{ maxWidth: 640 }}>
        {/* Hero */}
        <section
          className="rounded-xl p-5"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-start gap-3">
            <div
              className="shrink-0 rounded-xl p-2.5"
              style={{ background: "rgba(99,102,241,0.18)" }}
            >
              <MessageCircle size={24} style={{ color: "#a5b4fc" }} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                {t("app.chat.name")}
              </h1>
              <p
                className="mt-1"
                style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)", margin: "4px 0 0" }}
              >
                {t("tytusChat.hub.tagline")}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="tytus-chat-hub-open"
              onClick={openChat}
              className="flex items-center gap-1.5 rounded-md px-3.5 py-2 transition-opacity hover:opacity-90"
              style={{ fontSize: 13, fontWeight: 600, background: "var(--accent-primary)", color: "var(--text-on-accent)", border: "none", cursor: "pointer" }}
            >
              <ExternalLink size={14} />
              {t("tytusChat.hub.open")}
            </button>
            <button
              type="button"
              data-testid="tytus-chat-hub-get-desktop"
              onClick={() => openWindow("app-store")}
              className="flex items-center gap-1.5 rounded-md px-3.5 py-2 transition-colors"
              style={{ fontSize: 13, fontWeight: 500, background: "var(--bg-chrome)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)", cursor: "pointer" }}
            >
              {t("tytusChat.hub.getDesktop")}
            </button>
          </div>
        </section>

        {/* Your pods */}
        <section className="flex flex-col gap-2">
          <h2 className="uppercase tracking-[0.08em]" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
            {t("tytusChat.hub.podsTitle")}
          </h2>
          {agents.length === 0 ? (
            <EmptyRow
              testId="tytus-chat-hub-pods-empty"
              text={t("tytusChat.hub.podsEmpty")}
              actionLabel={t("tytusChat.hub.podsEmptyCta")}
              actionIcon={<Rocket size={13} />}
              onAction={() => openWindow("pod-inspector")}
            />
          ) : (
            <ul className="flex flex-col gap-1.5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {agents.map((agent) => {
                const runtime = resolveAgentDisplay(agent.agent_type, null, t).name;
                const key = agent.id || agent.route_id || agent.pod_id;
                return (
                  <li
                    key={key}
                    data-testid="tytus-chat-hub-pod"
                    className="flex items-center gap-3 rounded-lg px-3 py-2"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
                  >
                    <Box size={16} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                        {podLabel(agent, t)}
                      </div>
                      <div className="truncate" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                        {t("tytusChat.hub.podSubtitle", { runtime, podId: agent.pod_id })}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Connected channels */}
        <section className="flex flex-col gap-2">
          <h2 className="uppercase tracking-[0.08em]" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
            {t("tytusChat.hub.channelsTitle")}
          </h2>
          {channels.length === 0 ? (
            <EmptyRow
              testId="tytus-chat-hub-channels-empty"
              text={t("tytusChat.hub.channelsEmpty")}
              actionLabel={t("tytusChat.hub.manageChannels")}
              actionIcon={<Send size={13} />}
              onAction={() => openWindow("channels")}
            />
          ) : (
            <>
              <ul className="flex flex-col gap-1.5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {channels.map((c) => {
                  const Icon = CHANNEL_ICONS[c.icon] ?? MessageCircle;
                  return (
                    <li
                      key={c.name}
                      data-testid="tytus-chat-hub-channel"
                      className="flex items-center gap-3 rounded-lg px-3 py-2"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
                    >
                      <Icon size={16} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                      <span className="flex-1 truncate" style={{ fontSize: 13, fontWeight: 500 }}>
                        {c.label}
                      </span>
                      {c.webUrl && (
                        <a
                          href={c.webUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t("tytusChat.hub.openMessenger", { name: c.label })}
                          title={t("tytusChat.hub.openMessenger", { name: c.label })}
                          className="flex items-center gap-1 rounded-md px-2 py-1 transition-colors"
                          style={{ fontSize: 12, color: "var(--text-secondary)", border: "1px solid var(--border-subtle)", textDecoration: "none" }}
                        >
                          <ExternalLink size={12} /> {t("common.open")}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                data-testid="tytus-chat-hub-manage-channels"
                onClick={() => openWindow("channels")}
                className="mt-1 flex w-fit items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors"
                style={{ fontSize: 12, fontWeight: 500, background: "var(--bg-chrome)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)", cursor: "pointer" }}
              >
                <SettingsIcon size={13} /> {t("tytusChat.hub.manageChannels")}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

const EmptyRow: FC<{
  testId: string;
  text: string;
  actionLabel: string;
  actionIcon: React.ReactNode;
  onAction: () => void;
}> = ({ testId, text, actionLabel, actionIcon, onAction }) => (
  <div
    data-testid={testId}
    className="flex flex-col items-start gap-2 rounded-lg px-3 py-3"
    style={{ background: "var(--bg-card)", border: "1px dashed var(--border-subtle)" }}
  >
    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{text}</span>
    <button
      type="button"
      onClick={onAction}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors"
      style={{ fontSize: 12, fontWeight: 500, background: "var(--bg-chrome)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", cursor: "pointer" }}
    >
      {actionIcon} {actionLabel}
    </button>
  </div>
);

export default TytusChatHub;
