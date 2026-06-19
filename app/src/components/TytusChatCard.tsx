// ============================================================
// TytusChatCard — Tytus Chat onboarding (Open Doors P5)
// ============================================================
//
// One-time corner card shown when the user HAS at least one allocated
// agent pod: their pods are DM-able teammates in Tytus Chat
// (chat.traylinx.com), and nothing in the OS surfaces that today.
//
// Deliberately the inverse gate of ZeroPodsOverlay (which targets
// zero-pod users): no pods -> allocate first; pods -> meet them in chat.
// Dismissal persists in localStorage so the card appears exactly once
// per browser; opening chat also counts as dismissal.

import { memo, useCallback, useSyncExternalStore } from "react";
import { MessageCircle, X } from "lucide-react";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import { useI18n } from "@/i18n";
import { TYTUS_CHAT_URL } from "@/lib/tytusChat";

// Re-exported for back-compat: existing importers (and TytusChatCard.test)
// resolve TYTUS_CHAT_URL from this module. Canonical source is lib/tytusChat.
export { TYTUS_CHAT_URL };
const DISMISSED_KEY = "tytus.chat-card.dismissed";

// localStorage-backed dismissal as an external store: stable snapshot
// (a plain string read — see use-sync-external-store-stable-snapshot
// lesson), updates propagate within this tab via the listener set.
const listeners = new Set<() => void>();
function readDismissed(): string {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) ?? "";
  } catch {
    return "1"; // storage unavailable -> never show rather than show forever
  }
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function markDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // best-effort — the component also unmounts via state below
  }
  for (const cb of listeners) cb();
}

const TytusChatCard = memo(function TytusChatCard() {
  const { t } = useI18n();
  const { state: osState } = useOS();
  const { state } = useDaemonStateContext();
  const dismissed = useSyncExternalStore(subscribe, readDismissed);

  const onOpenChat = useCallback(() => {
    window.open(TYTUS_CHAT_URL, "_blank", "noopener,noreferrer");
    markDismissed();
  }, []);

  const onDismiss = useCallback(() => {
    markDismissed();
  }, []);

  // Gate: a real signal that the user has working pods to meet in chat.
  if (dismissed === "1") return null;
  if (!osState.auth.isAuthenticated) return null;
  if (!state || !state.logged_in) return null;
  if (state.agents.length === 0) return null;

  return (
    <div
      className="fixed z-[3500] pointer-events-auto"
      style={{ right: 16, bottom: 84 }}
      data-testid="tytus-chat-card"
    >
      <div
        className="w-[340px] rounded-2xl p-5"
        style={{
          background: "rgba(30,30,30,0.92)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 rounded-xl p-2"
            style={{ background: "rgba(99,102,241,0.18)" }}
          >
            <MessageCircle size={20} style={{ color: "#a5b4fc" }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white">
              {t("chatCard.title")}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-white/70">
              {t("chatCard.body")}
            </div>
          </div>
          <button
            type="button"
            aria-label={t("chatCard.dismiss")}
            onClick={onDismiss}
            className="shrink-0 rounded-md p-1 text-white/50 hover:text-white/90"
          >
            <X size={14} />
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenChat}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
            style={{ background: "rgba(99,102,241,0.9)" }}
          >
            {t("chatCard.open")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white/90"
          >
            {t("chatCard.later")}
          </button>
        </div>
      </div>
    </div>
  );
});

export default TytusChatCard;
