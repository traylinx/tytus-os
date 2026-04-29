// ============================================================
// LoginScreen — Auth bridge to the Tytus daemon
// ============================================================
//
// The daemon owns auth (device-auth via the `tytus login` CLI). TytusOS
// does NOT prompt for a password and does NOT trigger login itself —
// the tray's "Sign In" menu item is the canonical entry point. We poll
// /api/state, and when logged_in flips to true we hand control to the
// desktop shell.

import { memo, useEffect } from "react";
import { LogIn, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";

const LoginScreen = memo(function LoginScreen() {
  const { dispatch } = useOS();
  const { status, state, refresh } = useDaemonStateContext();

  // Auto-advance once the daemon reports a logged-in user.
  useEffect(() => {
    if (state?.logged_in) {
      dispatch({ type: "LOGIN", isGuest: false });
    }
  }, [state?.logged_in, dispatch]);

  const isOffline = status === "offline";
  const isLoading = status === "loading";

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{
        backgroundImage: "url(/wallpaper-default.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          background: "rgba(0,0,0,0.4)",
        }}
      />

      <div
        className="relative z-10 w-[420px] rounded-2xl p-10 flex flex-col items-center text-center"
        style={{
          background: "rgba(45,45,45,0.85)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
          animation: "loginEnter 400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center border-[3px] border-[#7C4DFF] mb-4"
          style={{
            background: "linear-gradient(135deg, #7C4DFF, #4A148C)",
          }}
        >
          <LogIn size={36} className="text-white" />
        </div>

        <h2 className="text-xl font-semibold text-[#E0E0E0]">
          Sign in to Tytus
        </h2>

        {isLoading && (
          <p className="text-sm text-[#9E9E9E] mt-4 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Checking daemon…
          </p>
        )}

        {isOffline && (
          <div
            className="mt-6 w-full p-4 rounded-lg flex items-start gap-3 text-left text-sm"
            style={{
              background: "rgba(244,67,54,0.10)",
              border: "1px solid rgba(244,67,54,0.30)",
              color: "#FFCDD2",
            }}
          >
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Tytus daemon is not running. Open the Tytus icon in your
              menu bar and choose <strong>Start daemon</strong>. We'll
              auto-detect when it's back.
            </span>
          </div>
        )}

        {!isLoading && !isOffline && (
          <>
            <ol
              className="text-sm text-[#E0E0E0] mt-4 mb-2 text-left space-y-2 leading-relaxed list-decimal list-inside"
              style={{ color: "#CFCFCF" }}
            >
              <li>
                Click the <strong>Tytus icon</strong> in your menu bar
                (top-right of the screen).
              </li>
              <li>
                Choose <strong>Sign In…</strong> — your browser will open
                with a one-time login code.
              </li>
              <li>
                Approve it. This screen unlocks automatically.
              </li>
            </ol>

            <button
              onClick={refresh}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "#E0E0E0",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <RefreshCw size={12} /> Check again
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes loginEnter {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
});

export default LoginScreen;
