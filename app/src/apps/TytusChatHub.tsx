// ============================================================
// TytusChatHub — in-OS home for Tytus Chat
// ============================================================
//
// Replaces the old same-origin pod-chat surface. Tytus Chat
// (chat.traylinx.com) is the real place to talk to your pods — they
// are DM-able teammates there, and replies run on the user's own pod.
// This window is a branded info board, not a chat client.
//
// Layout mirrors the Channels app (services/tytus-os/app/src/apps/
// Channels.tsx): a left "Your pods" sidebar + a main pane with a flat
// header and a stack of cards. Branding follows the OS's own restrained
// language — the Tytus mark in a clean badge and the subtle purple card
// treatment used by Channels' "Want WhatsApp…" footer
// (rgba(124,77,255,0.10→0.04) gradient + a small purple gradient icon
// badge). No loud hero gradients, no colored runtime avatars.
//
//   • Sidebar: pods as teammates (same Box + name + runtime convention
//     as the Channels / Pod Inspector pod lists). Clicking one opens
//     Tytus Chat.
//   • Hero card: the brand + primary CTA (open web; "Get the desktop
//     app" jumps to the App Store; the desktop client is a thin Electron
//     shell over the same URL).
//   • Connected channels: messengers already bound to any pod, with a
//     link to manage them in the Channels app.
//   • How-it-works: a short explainer card.
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
  Sparkles,
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

// The Tytus mark, served from public/brand at the OS root.
const TYTUS_MARK = "/brand/tytusos-mark-128.png";

interface HubChannel {
  name: string;
  label: string;
  icon: string;
  webUrl: string | null;
}

// A "named" agent is a DM-able persona. That's a non-empty display_name, OR a
// display_label the daemon set to something other than the "Pod NN" fallback
// (some states ship personas with only display_label populated). The base/
// proxy entry always carries the bare "Pod <pod_id>" fallback label, so it is
// the one case this returns false for.
const isNamed = (a: Agent): boolean => {
  if ((a.display_name ?? "").trim().length > 0) return true;
  const label = (a.display_label ?? "").trim();
  return label.length > 0 && label !== `Pod ${a.pod_id}`;
};

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

  const allAgents: Agent[] = useMemo(() => state?.agents ?? [], [state]);
  // Sidebar roster = DM-able chat personas. When a pod exposes named derived
  // bots (e.g. Lisa / Claus / Hermie) alongside an unnamed entry, that unnamed
  // entry is the pod's base/proxy — it routes to the raw SwitchAILocal gateway,
  // not a persona — so it is excluded. But an unnamed agent that is the ONLY
  // agent on its pod is a real allocated agent ("Pod NN") and stays visible;
  // we must not blank the roster for default daemon states that omit
  // display_name. Hence: hide an unnamed agent only when a named sibling shares
  // its pod_id.
  //
  // NOTE: channel aggregation below intentionally uses allAgents, not
  // teammates — channels are keyed per pod_id, so a configured messenger on
  // a pod must surface even if that pod only exposes the unnamed base agent.
  const teammates: Agent[] = useMemo(() => {
    const podsWithNamed = new Set(allAgents.filter(isNamed).map((a) => a.pod_id));
    return allAgents.filter((a) => isNamed(a) || !podsWithNamed.has(a.pod_id));
  }, [allAgents]);
  const loggedIn = Boolean(state?.logged_in) && osState.auth.isAuthenticated;

  const [channels, setChannels] = useState<HubChannel[]>([]);

  // Aggregate configured channels across every pod. getChannels is
  // per-pod; we union by channel name so each messenger shows once even
  // when several pods share it. Non-fatal: any failed pod fetch is
  // simply skipped (an empty list renders the "connect a channel" state).
  useEffect(() => {
    if (!loggedIn || allAgents.length === 0) {
      setChannels([]);
      return;
    }
    const controller = new AbortController();
    // Dedupe the fetch by pod_id: /api/channels is keyed solely by pod_id
    // (`?pod=<pod_id>`), so two agents that share a pod_id resolve to the same
    // endpoint and the same channel set. We show a union across pods, so one
    // request per distinct pod_id is both sufficient and minimal — deduping by
    // the fuller route identity would only issue redundant identical requests.
    const podIds = Array.from(new Set(allAgents.map((a) => a.pod_id)));
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
  }, [allAgents, client, loggedIn]);

  const openChat = () =>
    window.open(TYTUS_CHAT_URL, "_blank", "noopener,noreferrer");

  return (
    <div
      className="flex h-full"
      style={{ background: "var(--bg-window)", color: "var(--text-primary)" }}
      data-testid="tytus-chat-hub"
    >
      {/* ---- Sidebar: pods as teammates (Channels parity) ---- */}
      <div
        className="w-[190px] shrink-0 flex flex-col"
        style={{ background: "var(--bg-titlebar)", borderRight: "1px solid var(--border-subtle)" }}
      >
        <div
          className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold flex items-center gap-2"
          style={{ color: "var(--text-secondary)" }}
        >
          <Box size={12} />
          {t("tytusChat.hub.podsSidebarTitle")}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {teammates.length === 0 ? (
            <div
              data-testid="tytus-chat-hub-pods-empty"
              className="mx-3 mt-1 px-3 py-3 rounded-md flex flex-col items-start gap-2"
              style={{ background: "var(--bg-card, rgba(255,255,255,0.03))", border: "1px dashed var(--border-subtle)" }}
            >
              <span className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {t("tytusChat.hub.podsEmpty")}
              </span>
              <button
                type="button"
                onClick={() => openWindow("pod-inspector")}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
                style={{ background: "var(--bg-hover, rgba(255,255,255,0.04))", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              >
                <Rocket size={11} /> {t("tytusChat.hub.podsEmptyCta")}
              </button>
            </div>
          ) : (
            teammates.map((agent) => {
              const runtime = resolveAgentDisplay(agent.agent_type, null, t).name;
              const key = agent.id || agent.route_id || agent.pod_id;
              return (
                <button
                  key={key}
                  type="button"
                  data-testid="tytus-chat-hub-pod"
                  onClick={openChat}
                  title={t("tytusChat.hub.openInChat")}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors hover:bg-white/[0.04]"
                  style={{ color: "var(--text-primary)", borderLeft: "3px solid transparent" }}
                >
                  <Box size={12} className="shrink-0 opacity-70" style={{ color: "var(--accent-primary)" }} />
                  <span className="flex-1 truncate">{podLabel(agent, t)}</span>
                  <span className="text-[10px] shrink-0" style={{ color: "var(--text-disabled)" }}>
                    {runtime}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ---- Main pane ---- */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header (matches Channels / Browser) */}
        <div
          className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <MessageCircle size={18} className="text-[var(--accent-primary)]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("app.chat.name")}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {t("tytusChat.hub.tagline")}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
          {/* Branded hero card — OS's subtle purple card treatment */}
          <div
            className="rounded-xl p-5"
            style={{
              background: "linear-gradient(135deg, rgba(124,77,255,0.10), rgba(124,77,255,0.04))",
              border: "1px solid rgba(124,77,255,0.25)",
            }}
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(0,0,0,0.28)", border: "1px solid var(--border-default)" }}
              >
                <img
                  src={TYTUS_MARK}
                  alt=""
                  width={32}
                  height={32}
                  style={{ display: "block", objectFit: "contain" }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                  {t("app.chat.name")}
                </div>
                <div className="text-[12px] mt-0.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {t("tytusChat.hub.tagline")}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="tytus-chat-hub-open"
                onClick={openChat}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors"
                style={{ background: "var(--accent-primary)" }}
              >
                <ExternalLink size={14} />
                {t("tytusChat.hub.open")}
              </button>
              <button
                type="button"
                data-testid="tytus-chat-hub-get-desktop"
                onClick={() => openWindow("app-store")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors"
                style={{
                  background: "var(--bg-hover, rgba(255,255,255,0.04))",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              >
                {t("tytusChat.hub.getDesktop")}
              </button>
            </div>
          </div>

          {/* Connected channels */}
          <section>
            <h3
              className="text-[10px] uppercase tracking-wider font-semibold mb-3"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("tytusChat.hub.channelsTitle")}
            </h3>
            {channels.length === 0 ? (
              <div
                data-testid="tytus-chat-hub-channels-empty"
                className="px-3 py-4 rounded-md flex flex-col items-start gap-2.5"
                style={{ background: "var(--bg-card, rgba(255,255,255,0.03))", border: "1px dashed var(--border-subtle)" }}
              >
                <span className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {t("tytusChat.hub.channelsEmpty")}
                </span>
                <button
                  type="button"
                  data-testid="tytus-chat-hub-manage-channels"
                  onClick={() => openWindow("channels")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                  style={{ background: "var(--bg-hover, rgba(255,255,255,0.04))", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                >
                  <Send size={12} /> {t("tytusChat.hub.manageChannels")}
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {channels.map((c) => {
                    const Icon = CHANNEL_ICONS[c.icon] ?? MessageCircle;
                    return (
                      <div
                        key={c.name}
                        data-testid="tytus-chat-hub-channel"
                        className="flex items-center gap-3 px-3 py-2 rounded-md"
                        style={{ background: "var(--bg-card, rgba(255,255,255,0.03))", border: "1px solid var(--border-subtle)" }}
                      >
                        <Icon size={14} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                        <span className="flex-1 truncate text-sm" style={{ color: "var(--text-primary)" }}>
                          {c.label}
                        </span>
                        {c.webUrl && (
                          <a
                            href={c.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t("tytusChat.hub.openMessenger", { name: c.label })}
                            title={t("tytusChat.hub.openMessenger", { name: c.label })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
                            style={{ background: "var(--bg-hover, rgba(255,255,255,0.04))", border: "1px solid var(--border-default)", color: "var(--text-secondary)", textDecoration: "none" }}
                          >
                            <ExternalLink size={12} /> {t("common.open")}
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  data-testid="tytus-chat-hub-manage-channels"
                  onClick={() => openWindow("channels")}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
                  style={{ background: "var(--bg-hover, rgba(255,255,255,0.04))", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                >
                  <SettingsIcon size={12} /> {t("tytusChat.hub.manageChannels")}
                </button>
              </>
            )}
          </section>

          {/* How it works — subtle branded explainer (Channels footer style) */}
          <div
            className="rounded-xl p-4 flex items-start gap-3"
            style={{
              background: "linear-gradient(135deg, rgba(124,77,255,0.08), rgba(124,77,255,0.03))",
              border: "1px solid rgba(124,77,255,0.20)",
            }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #7C4DFF, #4A148C)" }}
            >
              <Sparkles size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("tytusChat.hub.howTitle")}
              </div>
              <div className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {t("tytusChat.hub.howBody")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TytusChatHub;
