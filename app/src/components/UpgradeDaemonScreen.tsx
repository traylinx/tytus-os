// ============================================================
// UpgradeDaemonScreen — min-daemon-version gate
// ============================================================
//
// Rendered by the shell (App.tsx) when:
//   - boot has completed AND
//   - the user is logged in (signing in still works against an old
//     daemon — re-auth might land tokens that change behavior) AND
//   - useDaemonState reports `daemonVersionStatus === "unsupported"`.
//
// Replaces the Desktop entirely while the gate is active. The
// daemon-offline banner (A1a/A1b) overlays this screen the same way
// it overlays the Desktop — if the daemon goes offline mid-upgrade,
// the user sees both.
//
// Contains no destructive controls. The user's path forward is:
//   1. Quit the OS tab.
//   2. Rebuild + reinstall the tray (one-line copy block below).
//   3. Reload the OS tab; the next /api/state poll surfaces the new
//      version and the gate flips to `"supported"`.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { MIN_DAEMON_VERSION } from "@/lib/version";

interface Props {
  /** Detected daemon version, or null when the daemon predates the
   *  state-includes-version sprint and reports no version at all. */
  detectedVersion: string | null;
  /** Force an immediate /api/state refresh — useful after the user
   *  rebuilds the tray and wants to re-check without reloading. */
  onRefresh: () => void;
}

// Path-agnostic upgrade: re-running the official installer rebuilds
// from `main` and reinstalls the tray binary. Works regardless of
// where the user has their tytus-cli checkout.
const UPGRADE_COMMAND =
  "curl -fsSL https://get.traylinx.com/install.sh | bash";
const UPGRADE_DOCS_URL = "https://github.com/traylinx/tytus-cli#upgrading";

const UpgradeDaemonScreen = memo(function UpgradeDaemonScreen({
  detectedVersion,
  onRefresh,
}: Props) {
  const [copied, setCopied] = useState(false);
  // Track the copied-confirmation timeout so unmount during the 1500ms
  // window doesn't leak the timer or call setState on a dead component.
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(UPGRADE_COMMAND);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1500);
    } catch {
      // clipboard denied — leave button state alone, user can select manually
    }
  }, []);

  return (
    <div
      role="dialog"
      aria-labelledby="upgrade-daemon-heading"
      className="fixed inset-0 z-[9000] flex items-center justify-center px-6"
      style={{ background: "var(--bg-desktop, #1a1a1a)" }}
    >
      <div
        className="max-w-xl w-full rounded-xl p-8 flex flex-col gap-5"
        style={{
          background: "var(--bg-window, #222)",
          border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle
            size={28}
            style={{ color: "var(--accent-warning, #FFB300)" }}
          />
          <h1
            id="upgrade-daemon-heading"
            className="text-xl font-semibold"
            style={{ color: "var(--text-primary, #fff)" }}
          >
            Your tray daemon is out of date.
          </h1>
        </div>

        <p
          className="text-sm leading-relaxed"
          style={{ color: "var(--text-secondary, rgba(255,255,255,0.75))" }}
        >
          TytusOS needs at least{" "}
          <code className="font-mono text-xs px-1 py-0.5 rounded"
                style={{ background: "var(--bg-code, rgba(255,255,255,0.08))" }}>
            tytus-tray {MIN_DAEMON_VERSION}
          </code>{" "}
          to render correctly. Detected:{" "}
          <code className="font-mono text-xs px-1 py-0.5 rounded"
                style={{ background: "var(--bg-code, rgba(255,255,255,0.08))" }}>
            {detectedVersion ?? "unknown (pre-version daemon)"}
          </code>
          .
        </p>

        <div className="flex flex-col gap-2">
          <span
            className="text-xs uppercase tracking-wide font-semibold"
            style={{ color: "var(--text-tertiary, rgba(255,255,255,0.55))" }}
          >
            Upgrade in one line
          </span>
          <div
            className="font-mono text-xs p-3 rounded flex items-start gap-3"
            style={{
              background: "var(--bg-code, rgba(0,0,0,0.4))",
              color: "var(--text-primary, #fff)",
            }}
          >
            <code className="flex-1 break-all whitespace-pre-wrap">
              {UPGRADE_COMMAND}
            </code>
            <button
              onClick={onCopy}
              aria-label="Copy upgrade command"
              className="flex-shrink-0 p-1.5 rounded hover:bg-white/10 transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <a
            href={UPGRADE_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline"
            style={{ color: "var(--text-tertiary, rgba(255,255,255,0.55))" }}
          >
            Upgrade documentation →
          </a>
        </div>

        <p
          className="text-xs"
          style={{ color: "var(--text-tertiary, rgba(255,255,255,0.55))" }}
        >
          Already upgraded? Click <strong>Re-check</strong> below — TytusOS
          will poll the daemon again. You can also sign out from this
          screen if re-authenticating is what's needed.
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors"
            style={{
              background: "var(--accent-primary, #7C4DFF)",
              color: "#fff",
            }}
          >
            <RefreshCw size={14} /> Re-check
          </button>
        </div>
      </div>
    </div>
  );
});

export default UpgradeDaemonScreen;
