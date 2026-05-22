// ============================================================
// ZeroPodsOverlay — Phase 3a §2.4
// ============================================================
//
// Shown on Desktop when the user is logged in but has no allocated
// agent pods. Included AIL gateway pods are not counted as agents,
// but they DO change the copy/action: users who already have a
// gateway should be guided to connect Tytus, not told to allocate
// their first pod from scratch.
//
// Primary CTA opens Settings → Agents (the in-app install wizard).
// Secondary "Refresh" triggers a state poll in case the user just
// allocated from another surface and wants the UI to catch up.

import { memo, useCallback, useState } from "react";
import { Loader2, PlugZap, RefreshCw, Sparkles } from "lucide-react";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import { navigate } from "@/lib/router";

const ZeroPodsOverlay = memo(function ZeroPodsOverlay() {
  const { state: osState, dispatch } = useOS();
  const { state, refresh } = useDaemonStateContext();
  const client = useDaemonClient();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const onAllocate = useCallback(() => {
    dispatch({ type: "OPEN_WINDOW", appId: "settings" });
    // ?install=auto tells Settings to pre-select the cheapest installable
    // agent from the catalog and open the wizard. User can still Cancel
    // to fall back to manual catalog browsing.
    navigate({
      kind: "settings",
      section: "agents",
      params: new URLSearchParams({ install: "auto" }),
    });
  }, [dispatch]);

  const onOpenPods = useCallback(() => {
    dispatch({ type: "OPEN_WINDOW", appId: "pod-inspector" });
  }, [dispatch]);

  const onConnect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    const r = await client.postConnect();
    setConnecting(false);
    if (!r.ok) {
      setConnectError(r.error.message);
      return;
    }
    // `tytus connect` may continue inside a native Terminal window
    // while sudo/Touch ID brings up WireGuard. Poll a few times so the
    // desktop catches the connected state without a manual tray click
    // or browser refresh.
    window.setTimeout(refresh, 1000);
    window.setTimeout(refresh, 3500);
    window.setTimeout(refresh, 7000);
  }, [client, refresh]);

  // Only render when we have a real signal: logged in, state loaded,
  // zero allocated agents. Don't render during boot or login screens.
  if (!osState.auth.isAuthenticated) return null;
  if (!state || !state.logged_in) return null;
  if (state.agents.length > 0) return null;

  const hasIncludedGateway = state.included.length > 0;
  const gatewayConnected = hasIncludedGateway && state.connected && state.tunnel_active;
  const needsTunnel = hasIncludedGateway && !gatewayConnected;

  // Suppress while any window is open OR the AppLauncher / Notification
  // Center is up — user is actively interacting with another surface and
  // the welcome popup would block their actual target. The desktop will
  // show the overlay again as soon as they close everything.
  const hasOpenWindow = osState.windows.some((w) => w.state !== "minimized");
  if (hasOpenWindow) return null;
  if (osState.appLauncherOpen) return null;
  if (osState.notificationCenterOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[4000] flex items-center justify-center pointer-events-none"
      style={{ top: 28, bottom: 68 }}
    >
      <div
        className="pointer-events-auto w-[460px] rounded-2xl p-8 flex flex-col items-center text-center"
        style={{
          background: "rgba(30,30,30,0.92)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
          animation: "zeroPodsAppear 360ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <div className="mb-5">
          <img
            src="/favicons/android-chrome-192x192.png"
            alt=""
            width={72}
            height={72}
            className="block rounded-2xl"
          />
        </div>

        <h2 className="text-xl font-semibold text-[#E0E0E0]">
          {needsTunnel
            ? "Connect Tytus to your pod"
            : gatewayConnected
              ? "Tytus is connected"
              : "Welcome to Tytus"}
        </h2>
        <p
          className="text-sm mt-2 leading-relaxed"
          style={{ color: "#B0B0B0" }}
        >
          {needsTunnel
            ? "Your account is ready. Start the secure WireGuard tunnel from here — no tray-menu hunting."
            : gatewayConnected
              ? "Your private gateway is online. Open Pods to inspect or allocate agent pods when you need them."
              : "You don't have any pods yet. Allocate your first pod to start using your private AI infrastructure."}
        </p>

        {needsTunnel && (
          <p className="mt-2 text-[11px] leading-relaxed text-[#8C8C8C]">
            A Terminal window may ask for your Mac password or Touch ID to
            activate the secure tunnel.
          </p>
        )}

        {state.tier && state.units_limit > 0 && (
          <div
            className="mt-4 px-3 py-1.5 rounded-md text-[11px] flex items-center gap-1.5"
            style={{
              background: "rgba(124,77,255,0.10)",
              border: "1px solid rgba(124,77,255,0.25)",
              color: "#D6C8FF",
            }}
          >
            <Sparkles size={11} />
            <span>
              {state.tier.charAt(0).toUpperCase() + state.tier.slice(1)} tier
              ·{" "}
              {gatewayConnected
                ? `${state.units_used}/${state.units_limit} units in use`
                : `${state.units_limit} unit${state.units_limit === 1 ? "" : "s"} available`}
            </span>
          </div>
        )}

        {needsTunnel ? (
          <button
            onClick={onConnect}
            disabled={connecting}
            className="mt-6 w-full px-4 py-3 rounded-lg text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-70"
            style={{
              background: "linear-gradient(135deg, #7C4DFF, #6037E0)",
              color: "white",
              boxShadow: "0 4px 16px rgba(124,77,255,0.35)",
            }}
          >
            {connecting ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <PlugZap size={15} />
            )}
            Connect Tytus
          </button>
        ) : gatewayConnected ? (
          <button
            onClick={onOpenPods}
            className="mt-6 w-full px-4 py-3 rounded-lg text-sm font-semibold transition-colors"
            style={{
              background: "linear-gradient(135deg, #7C4DFF, #6037E0)",
              color: "white",
              boxShadow: "0 4px 16px rgba(124,77,255,0.35)",
            }}
          >
            Open Pods →
          </button>
        ) : (
          <button
            onClick={onAllocate}
            className="mt-6 w-full px-4 py-3 rounded-lg text-sm font-semibold transition-colors"
            style={{
              background: "linear-gradient(135deg, #7C4DFF, #6037E0)",
              color: "white",
              boxShadow: "0 4px 16px rgba(124,77,255,0.35)",
            }}
          >
            Allocate your first pod →
          </button>
        )}

        {connectError && (
          <p className="mt-3 text-[11px] text-[#FF8A80]">{connectError}</p>
        )}

        <button
          onClick={refresh}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{
            background: "transparent",
            color: "#9E9E9E",
          }}
        >
          <RefreshCw size={11} /> Already have pods? Refresh
        </button>
      </div>

      <style>{`
        @keyframes zeroPodsAppear {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
});

export default ZeroPodsOverlay;
