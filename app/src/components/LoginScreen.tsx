// ============================================================
// LoginScreen — Auth bridge to the Tytus daemon
// ============================================================
//
// The daemon owns auth (device-auth via Sentinel). Tytus OS can start the
// same device-auth flow as the tray, then polls /api/state until the daemon
// sees fresh credentials and unlocks the desktop.

import { memo, useCallback, useEffect, useState } from "react";
import { LogIn, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import {
  DEFAULT_TYTUS_WALLPAPER,
  CUSTOM_WALLPAPER_SENTINEL,
  parseBackground,
} from "@/lib/brand";
import { loadCustomWallpaper } from "@/lib/repo/wallpaper";

const LoginScreen = memo(function LoginScreen() {
  const { state: osState, dispatch } = useOS();
  const { status, state, refresh } = useDaemonStateContext();
  const client = useDaemonClient();
  const [starting, setStarting] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Auto-advance once the daemon reports a logged-in user.
  useEffect(() => {
    if (state?.logged_in) {
      dispatch({ type: "LOGIN", isGuest: false });
    }
  }, [state?.logged_in, dispatch]);

  const isOffline = status === "offline";
  const isLoading = status === "loading";

  const startLogin = useCallback(async () => {
    setStarting(true);
    setLoginError(null);
    const r = await client.postLogin();
    setStarting(false);
    if (!r.ok) {
      setLoginError(
        r.error.status === 404
          ? "Your running Tytus tray daemon does not expose web sign-in yet. Restart or reinstall the tray after this update, or use the tray Sign In… menu once."
          : r.error.message,
      );
      return;
    }
    setLoginUrl(r.value.verification_uri);
    setUserCode(r.value.user_code);
    if (!r.value.opened_browser) {
      window.open(r.value.verification_uri, "_blank", "noopener,noreferrer");
    }
  }, [client]);

  // Phase 1.5 — match login wallpaper to user desktop wallpaper. We
  // mirror the LockScreen logic but without the matchDesktop opt-out
  // since the login screen runs before settings can be edited.
  const matchDesktop = osState.theme.lockWallpaperMatchesDesktop;
  const [customDataUrl, setCustomDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (
      !matchDesktop ||
      osState.theme.wallpaper !== CUSTOM_WALLPAPER_SENTINEL
    ) {
      setCustomDataUrl(null);
      return;
    }
    let cancelled = false;
    loadCustomWallpaper().then((row) => {
      if (!cancelled) setCustomDataUrl(row?.dataUrl ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [matchDesktop, osState.theme.wallpaper]);

  const loginBg: React.CSSProperties = (() => {
    if (!matchDesktop) {
      return {
        backgroundImage: `url(${DEFAULT_TYTUS_WALLPAPER})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    const desc = parseBackground(osState.theme.wallpaper);
    if (desc.kind === "preset") {
      return {
        backgroundImage: `url(${desc.url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    if (desc.kind === "color") return { background: desc.value };
    if (desc.kind === "custom" && customDataUrl) {
      return {
        backgroundImage: `url(${customDataUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    return {
      backgroundImage: `url(${DEFAULT_TYTUS_WALLPAPER})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  })();

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={loginBg}
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
        <div className="mb-5">
          <img
            src="/favicons/android-chrome-192x192.png"
            alt="Tytus OS"
            width={82}
            height={82}
            className="block rounded-2xl"
          />
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
            <p
              className="text-sm mt-4 leading-relaxed"
              style={{ color: "#CFCFCF" }}
            >
              Sign in here or from the Tytus tray. We open your browser with a
              one-time device code; this screen unlocks automatically after
              approval.
            </p>

            <button
              onClick={startLogin}
              disabled={starting}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60"
              style={{
                background: "linear-gradient(135deg, #7C4DFF, #6037E0)",
                color: "white",
                boxShadow: "0 4px 16px rgba(124,77,255,0.35)",
              }}
            >
              {starting ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
              {starting ? "Opening secure sign in…" : "Sign in with Tytus OS"}
            </button>

            {loginUrl && (
              <div
                className="mt-4 w-full p-3 rounded-lg text-left text-xs"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  color: "#DADADA",
                }}
              >
                <div className="font-semibold mb-1">Browser opened</div>
                <div>
                  Code: <span className="font-mono">{userCode}</span>
                </div>
                <a
                  href={loginUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block underline"
                  style={{ color: "#D6C8FF" }}
                >
                  Open login page again
                </a>
              </div>
            )}

            {loginError && (
              <div
                className="mt-4 w-full p-3 rounded-lg text-left text-xs"
                style={{
                  background: "rgba(244,67,54,0.10)",
                  border: "1px solid rgba(244,67,54,0.30)",
                  color: "#FFCDD2",
                }}
              >
                {loginError}
              </div>
            )}

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
