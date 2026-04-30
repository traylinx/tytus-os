// ============================================================
// LockScreen — local screen lock, separate from daemon auth
// ============================================================

import { memo, useCallback } from "react";
import { Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import { DEFAULT_TYTUS_WALLPAPER } from "@/lib/brand";

const LockScreen = memo(function LockScreen() {
  const { state, dispatch } = useOS();
  const daemon = useDaemonStateContext();
  const email = daemon.state?.email || state.auth.userName;
  const sessionHealthy = daemon.status !== "offline" && Boolean(daemon.state?.logged_in);

  const unlock = useCallback(() => {
    if (sessionHealthy) {
      dispatch({ type: "UNLOCK" });
    } else {
      dispatch({ type: "LOGOUT" });
      daemon.refresh();
    }
  }, [daemon, dispatch, sessionHealthy]);

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{
        backgroundImage: `url(${DEFAULT_TYTUS_WALLPAPER})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          background: "rgba(0,0,0,0.42)",
        }}
      />

      <div
        className="relative z-10 w-[390px] rounded-2xl p-9 flex flex-col items-center text-center"
        style={{
          background: "rgba(30,30,30,0.86)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.60)",
          animation: "lockEnter 260ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <img
          src="/favicons/android-chrome-192x192.png"
          alt="tytusOS"
          width={82}
          height={82}
          className="block rounded-2xl mb-5"
        />

        <h2 className="text-xl font-semibold" style={{ color: "#F0F0F0" }}>
          Screen locked
        </h2>
        <p className="mt-2 text-sm" style={{ color: "#BDBDBD" }}>
          {email}
        </p>

        <div
          className="mt-5 w-full rounded-lg p-3 text-left text-xs flex items-start gap-2"
          style={{
            background: sessionHealthy ? "rgba(76,175,80,0.10)" : "rgba(255,193,7,0.10)",
            border: sessionHealthy ? "1px solid rgba(76,175,80,0.25)" : "1px solid rgba(255,193,7,0.25)",
            color: sessionHealthy ? "#C8E6C9" : "#FFE082",
          }}
        >
          {sessionHealthy ? <ShieldCheck size={15} /> : <RefreshCw size={15} />}
          <span>
            {sessionHealthy
              ? "Tytus session is still active. Unlock locally to return to your desktop."
              : "Daemon session is not active. Continue to sign in again."}
          </span>
        </div>

        <button
          onClick={unlock}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-colors"
          style={{
            background: "linear-gradient(135deg, #7C4DFF, #6037E0)",
            color: "white",
            boxShadow: "0 4px 16px rgba(124,77,255,0.35)",
          }}
        >
          <Lock size={16} />
          {sessionHealthy ? "Unlock" : "Go to sign in"}
        </button>
      </div>

      <style>{`
        @keyframes lockEnter {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
});

export default LockScreen;
