// ============================================================
// App.tsx — Main Tytus OS Shell
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { OSProvider, useOS } from '@/hooks/useOSStore';
import { HostBridgeWiring, ShellMenuBridge } from '@/runtime/HostBridgeWiring';
import { DaemonClientProvider } from '@/hooks/useDaemonClient';
import { DaemonStateProvider, useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { logLaunch } from '@/lib/repo/appLaunches';
import DaemonOfflineBanner from '@/components/DaemonOfflineBanner';
import UpgradeDaemonScreen from '@/components/UpgradeDaemonScreen';
import ZeroPodsOverlay from '@/components/ZeroPodsOverlay';
import TytusChatCard from '@/components/TytusChatCard';
import BootSequence from '@/components/BootSequence';
import LoginScreen from '@/components/LoginScreen';
import LockScreen from '@/components/LockScreen';
import Desktop from '@/components/Desktop';
import TopPanel from '@/components/TopPanel';
import Dock from '@/components/Dock';
import AppLauncher from '@/components/AppLauncher';
import WindowManager from '@/components/WindowManager';
import ContextMenu from '@/components/ContextMenu';
import NotificationSystem from '@/components/NotificationSystem';
import NotificationCenter from '@/components/NotificationCenter';
import CommandPalette from '@/components/CommandPalette';
import ShellRouteDispatcher from '@/components/ShellRouteDispatcher';
import { ShellMenuProvider } from '@/hooks/useShellMenu';
import {
  DEFAULT_TYTUS_WALLPAPER,
  CUSTOM_WALLPAPER_SENTINEL,
  isValidBackgroundValue,
  parseBackground,
} from '@/lib/brand';
import { loadCustomWallpaper } from '@/lib/repo/wallpaper';
import { mountShortcutManager, registerShortcut } from '@/lib/shortcuts';
import { undoLast } from '@/lib/undo';
import { applyThemeToDom, modeFromSchedule, SCHEDULE_POLL_MS } from '@/lib/theme/effects';
import { ClipboardProvider } from '@/lib/clipboard';
import { setSoundEnabled } from '@/lib/sounds';
import { readClipboard } from '@/lib/hostClipboard';

function AppShell() {
  const { state, dispatch } = useOS();
  const { bootPhase, auth } = state;
  const [bootComplete, setBootComplete] = useState(false);
  const altTabRef = useRef<{ holding: boolean }>({ holding: false });

  // Capture-phase shortcut router. Default-blocks Cmd+W/Q/R/T/N so
  // those host-browser bindings can't kill the WebView from inside
  // Tytus OS. Apps + the shell + modals register handlers via
  // `registerShortcut(scope, combo, handler)` per `lib/shortcuts.ts`.
  useEffect(() => mountShortcutManager(), []);

  // Phase 4.7 — global Cmd+Z (Mod+Z) undo. Active-app scope so a
  // focused text input still gets its own browser-native Cmd+Z. The
  // undo ring is empty until file ops start pushing entries.
  useEffect(
    () =>
      registerShortcut('active-app', 'Mod+Z', () => {
        void undoLast();
      }),
    [],
  );

  // Sprint B Phase 6.2 — window keyboard shortcuts via the Sprint A
  // router. Cmd+W closes the focused window; Cmd+Q closes every window
  // of the focused window's app. Both are at active-app scope so
  // text-input scope (e.g. an editor that wants Cmd+W as a custom
  // shortcut) can override per-app. The router default-blocks Cmd+W /
  // Cmd+Q so the host browser tab can't be closed if no window owns
  // them — registering here wins over that block.
  useEffect(() => {
    const offW = registerShortcut('active-app', 'Mod+W', () => {
      const id = state.activeWindowId;
      if (!id) return false;
      dispatch({ type: 'CLOSE_WINDOW', windowId: id });
    });
    const offQ = registerShortcut('active-app', 'Mod+Q', () => {
      const id = state.activeWindowId;
      if (!id) return false;
      const focused = state.windows.find((w) => w.id === id);
      if (!focused) return false;
      const all = state.windows.filter((w) => w.appId === focused.appId);
      for (const w of all) {
        dispatch({ type: 'CLOSE_WINDOW', windowId: w.id });
      }
    });
    return () => {
      offW();
      offQ();
    };
  }, [dispatch, state.activeWindowId, state.windows]);

  // Cmd+Space → AppLauncher. Shell scope (lowest priority) so any focused
  // text input keeps its native Spacebar behaviour.
  useEffect(
    () =>
      registerShortcut('shell', 'Mod+Space', () => {
        dispatch({ type: 'SET_APP_LAUNCHER', open: !state.appLauncherOpen });
      }),
    [dispatch, state.appLauncherOpen],
  );

  // Sprint B Phase 5.4 — host clipboard paste. Cmd+V at active-app scope
  // routes to the host clipboard reader. Text-input scope owns Cmd+V
  // first (per Sprint A's TEXT_INPUT_NATIVE_COMBOS) so this ONLY fires
  // when nothing's focused — pasting onto the Desktop or a non-input
  // pane. Bound directly to the keypress so the permission prompt
  // sees a real user gesture.
  useEffect(
    () =>
      registerShortcut('active-app', 'Mod+V', () => {
        // Skip if a known transient overlay owns the keypress (those
        // route to text-input via the router) — defensive.
        void (async () => {
          const r = await readClipboard();
          // Update the permission cache regardless of outcome (Phase 5.4f
          // recovery: a successful read always upgrades to 'granted').
          dispatch({ type: 'SET_CLIPBOARD_PERMISSION', state: r.permission });
          if (!r.ok) {
            if (r.reason === 'permission-denied') {
              dispatch({
                type: 'ADD_NOTIFICATION',
                notification: {
                  appId: 'clipboard',
                  appName: 'Clipboard',
                  appIcon: 'Clipboard',
                  title: 'Clipboard access denied',
                  message: `Enable it in ${r.browserName ?? 'browser'} settings, then try again.`,
                  isRead: false,
                },
              });
            } else if (r.reason === 'empty') {
              // Empty paste — silently ignore (matches macOS behavior).
            } else if (r.reason === 'unavailable') {
              dispatch({
                type: 'ADD_NOTIFICATION',
                notification: {
                  appId: 'clipboard',
                  appName: 'Clipboard',
                  appIcon: 'Clipboard',
                  title: 'Clipboard unavailable',
                  message: 'This browser does not expose the clipboard API.',
                  isRead: false,
                },
              });
            }
            return;
          }
          // Success — surface a toast confirming the paste. The actual
          // file/text persistence is wired via FileManager's pane-local
          // handler (it knows what context the user is in); for the
          // shell-level case (paste on the Desktop) we drop a text/image
          // entry into the user's inbox.
          if (r.payload.kind === 'image') {
            dispatch({
              type: 'ADD_NOTIFICATION',
              notification: {
                appId: 'clipboard',
                appName: 'Clipboard',
                appIcon: 'Clipboard',
                title: 'Image on clipboard',
                message: `Open Files and paste to save ${r.payload.suggestedName}.`,
                isRead: false,
              },
            });
          } else if (r.payload.kind === 'text') {
            dispatch({
              type: 'ADD_NOTIFICATION',
              notification: {
                appId: 'clipboard',
                appName: 'Clipboard',
                appIcon: 'Clipboard',
                title: 'Text on clipboard',
                message: r.payload.text.slice(0, 80),
                isRead: false,
              },
            });
          }
        })();
      }),
    [dispatch],
  );

  // Theme → DOM. Pushes accent / font-scale / mode class onto the
  // document root every time `state.theme` changes so any control
  // living in Settings reflects everywhere instantly.
  useEffect(() => {
    applyThemeToDom(state.theme);
  }, [state.theme]);

  // Phase 7 — sync sounds module mute toggle with the theme.
  useEffect(() => {
    setSoundEnabled(state.theme.soundEnabled ?? true);
  }, [state.theme.soundEnabled]);

  // Light/dark schedule. Polls every 5min; manual schedule is a no-op.
  // The first effect run also reconciles "the schedule says light but
  // mode is dark" on app boot.
  useEffect(() => {
    const reconcile = () => {
      const want = modeFromSchedule(state.theme.modeSchedule);
      if (want && want !== state.theme.mode) {
        dispatch({ type: 'SET_THEME', theme: { mode: want } });
      }
    };
    reconcile();
    if (state.theme.modeSchedule === 'manual') return;
    const id = window.setInterval(reconcile, SCHEDULE_POLL_MS);
    return () => window.clearInterval(id);
  }, [dispatch, state.theme.modeSchedule, state.theme.mode]);

  // Shell-level daemon state shared via DaemonStateProvider context so
  // TopPanel, DaemonOfflineBanner, and LoginScreen all read the same poll.
  const daemon = useDaemonStateContext();

  // Runtime migration: older sessions may still hold legacy paths
  // (e.g. `/wallpaper-default.jpg`) in reducer state after HMR. Snap
  // anything we can't parse (preset / 'custom' / color string) onto
  // the bg3 default so the renderer never sees an unknown value.
  useEffect(() => {
    if (!isValidBackgroundValue(state.theme.wallpaper)) {
      dispatch({ type: 'SET_THEME', theme: { wallpaper: DEFAULT_TYTUS_WALLPAPER } });
    }
  }, [dispatch, state.theme.wallpaper]);

  // When the user picks a custom-uploaded image, the sentinel string
  // `'custom'` lives in reducer state but the actual base64 bytes live
  // in SQLite. Load them once on mount + whenever the sentinel is
  // (re-)selected; render `null` while pending so the page bg shows
  // through cleanly instead of flashing the default preset.
  const [customDataUrl, setCustomDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (state.theme.wallpaper !== CUSTOM_WALLPAPER_SENTINEL) {
      setCustomDataUrl(null);
      return;
    }
    let cancelled = false;
    loadCustomWallpaper().then((row) => {
      if (cancelled) return;
      if (row) {
        setCustomDataUrl(row.dataUrl);
      } else {
        // Sentinel set but no row — likely OPFS reset / cleared. Fall
        // back to the default and clear the sentinel.
        dispatch({ type: 'SET_THEME', theme: { wallpaper: DEFAULT_TYTUS_WALLPAPER } });
      }
    }).catch(() => {
      if (!cancelled) {
        dispatch({ type: 'SET_THEME', theme: { wallpaper: DEFAULT_TYTUS_WALLPAPER } });
      }
    });
    return () => { cancelled = true; };
  }, [dispatch, state.theme.wallpaper]);

  const backgroundDescriptor = parseBackground(state.theme.wallpaper);
  const backgroundLayerStyle: React.CSSProperties = (() => {
    if (backgroundDescriptor.kind === 'preset') {
      return {
        backgroundImage: `url(${backgroundDescriptor.url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    if (backgroundDescriptor.kind === 'color') {
      return { background: backgroundDescriptor.value };
    }
    if (backgroundDescriptor.kind === 'custom' && customDataUrl) {
      return {
        backgroundImage: `url(${customDataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    // 'custom' still loading, or 'unknown' (will be reset by the migration
    // effect above on next tick) — leave the layer transparent so the
    // shell's `--bg-desktop` shows through for one frame.
    return {};
  })();

  // Log every app launch for "Frequently Used" scoring.
  // Watches window count — when a new window appears, log its appId.
  const prevWindowCountRef = useRef(state.windows.length);
  useEffect(() => {
    if (state.windows.length > prevWindowCountRef.current) {
      const newest = state.windows[state.windows.length - 1];
      if (newest) logLaunch(newest.appId);
    }
    prevWindowCountRef.current = state.windows.length;
  }, [state.windows]);

  // Boot sequence
  useEffect(() => {
    if (bootPhase === 'off') {
      dispatch({ type: 'SET_BOOT_PHASE', phase: 'logo' });
    }
  }, [bootPhase, dispatch]);

  const handleBootComplete = useCallback(() => {
    setBootComplete(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const shortcutTargetOwnsKeys = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      if (target.closest('[data-tytus-terminal="true"]')) return true;
      const editable = target.closest('input, textarea, select, [contenteditable="true"]');
      return editable !== null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Terminal/text inputs own Command/Ctrl editing keys. Do not let shell
      // shortcuts steal copy/paste/select-all or open OS apps while typing.
      if (shortcutTargetOwnsKeys(e.target)) {
        return;
      }

      // (Removed) Lone Meta/Super/Win key opening the app launcher —
      // it fires on the FIRST half of every Cmd+C / Cmd+V / Cmd+anything
      // chord, hijacking copy/paste. Use the Dock or top-panel chimp icon
      // to open the launcher instead.

      // Ctrl+Alt+T opens Terminal
      if (e.ctrlKey && e.altKey && e.key === 't') {
        e.preventDefault();
        dispatch({ type: 'OPEN_WINDOW', appId: 'terminal' });
        return;
      }

      // Super+D minimize all
      if ((e.metaKey || e.key === 'Meta') && e.key === 'd') {
        e.preventDefault();
        dispatch({ type: 'MINIMIZE_ALL' });
        return;
      }

      // Alt+Tab window switching
      if (e.key === 'Alt') {
        altTabRef.current.holding = true;
      }
      if (e.key === 'Tab' && e.altKey) {
        e.preventDefault();
        if (!state.isAltTabbing) {
          dispatch({ type: 'START_ALT_TAB' });
        } else {
          dispatch({ type: 'CYCLE_ALT_TAB' });
        }
      }

      // Escape closes app launcher
      if (e.key === 'Escape') {
        if (state.appLauncherOpen) {
          dispatch({ type: 'SET_APP_LAUNCHER', open: false });
        }
        if (state.notificationCenterOpen) {
          dispatch({ type: 'TOGGLE_NOTIFICATION_CENTER' });
        }
      }

      // (Ctrl+W close-active-window migrated to the Sprint A shortcut
      // router as a Mod+W binding — see registerShortcut above.)
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && state.isAltTabbing) {
        dispatch({ type: 'END_ALT_TAB' });
        altTabRef.current.holding = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [dispatch, state.appLauncherOpen, state.notificationCenterOpen, state.isAltTabbing, state.activeWindowId]);

  // Determine what to render. The upgrade gate sits between login
  // and desktop: signing in still works against an old daemon (we
  // want the user to be able to log out / sign back in if that's
  // what unsticks them), but the Desktop is gated until the daemon
  // version meets the floor.
  const showBoot = bootPhase !== 'complete' && !bootComplete;
  const showLogin = bootComplete && !auth.isAuthenticated;
  const showLock =
    bootComplete &&
    auth.isAuthenticated &&
    auth.locked;
  const showUpgrade =
    bootComplete &&
    auth.isAuthenticated &&
    !auth.locked &&
    daemon.daemonVersionStatus === 'unsupported';
  // Use === 'supported' (not !== 'unsupported') so the Desktop stays
  // hidden during the 'loading' window before the first /api/state
  // poll lands. Otherwise Desktop briefly flashes if bootComplete and
  // auth resolve before daemon state is available.
  const showDesktop =
    bootComplete &&
    auth.isAuthenticated &&
    !auth.locked &&
    daemon.daemonVersionStatus === 'supported';

  return (
    <div className={state.theme.mode === 'light' ? 'light' : ''} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Daemon-offline banner — A1a (immediate) / A1b (3-fail) */}
      <DaemonOfflineBanner
        visible={daemon.bannerVisible}
        error={daemon.error}
        onRefresh={daemon.refresh}
      />

      {/* Boot Sequence */}
      {showBoot && <BootSequence onComplete={handleBootComplete} />}

      {/* Login Screen */}
      {showLogin && <LoginScreen />}

      {/* Local screen lock. Keeps daemon auth + windows intact. */}
      {showLock && <LockScreen />}

      {/* Min-daemon-version upgrade gate (Phase 1, manifest §3 old-daemon compat) */}
      {showUpgrade && (
        <UpgradeDaemonScreen
          detectedVersion={daemon.version?.daemon_version ?? null}
          onRefresh={daemon.refresh}
        />
      )}

      {/* Desktop Shell */}
      {showDesktop && (
        <ShellMenuProvider>
        <ShellMenuBridge />
        <div className="relative w-full h-full" style={{ background: 'var(--bg-desktop)' }}>
          {/* Wallpaper layer — preset image, custom-uploaded image, or solid color */}
          <div
            className="absolute inset-0"
            style={{ ...backgroundLayerStyle, zIndex: 0 }}
          />

          {/* Desktop Icons layer */}
          <ShellRouteDispatcher />
          <Desktop />

          {/* Windows layer */}
          <WindowManager />

          {/* Top panel */}
          <TopPanel />

          {/* Dock */}
          <Dock />

          {/* Zero-pods overlay (Phase 3a §2.4) */}
          <ZeroPodsOverlay />

          {/* Tytus Chat onboarding card (Open Doors P5) — the inverse gate:
              shown once when the user HAS pods, pointing at chat.traylinx.com */}
          <TytusChatCard />

          {/* Overlays */}
          <AppLauncher />
          <ContextMenu />
          <NotificationSystem />
          <NotificationCenter />
          <CommandPalette />

          {/* Alt+Tab switcher */}
          {state.isAltTabbing && (
            <div
              className="fixed inset-0 z-[5000] flex items-center justify-center pointer-events-none"
              style={{ background: 'rgba(0,0,0,0.3)' }}
            >
              <div
                className="flex items-center gap-3 px-6 py-4 rounded-2xl pointer-events-auto"
                style={{
                  background: 'rgba(30,30,30,0.9)',
                  backdropFilter: 'blur(16px)',
                  animation: 'alttabAppear 150ms ease',
                }}
              >
                {state.windows
                  .filter((w) => w.state !== 'minimized')
                  .map((w, i) => {
                    const app = state.apps.find((a) => a.id === w.appId);
                    const isSelected = i === state.altTabIndex;
                    return (
                      <div
                        key={w.id}
                        className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all"
                        style={{
                          background: isSelected ? 'var(--bg-hover)' : 'transparent',
                          border: isSelected ? '2px solid var(--accent-primary)' : '2px solid transparent',
                          width: 80,
                        }}
                      >
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                          style={{ background: 'var(--bg-hover)' }}>
                          {app?.icon && (
                            <img
                              src={`data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%237C4DFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`}
                              alt=""
                              className="w-6 h-6 opacity-0"
                            />
                          )}
                          <span className="text-xl absolute">{app?.icon === 'Folder' && '📁'}</span>
                          <span className="text-xl absolute">{app?.icon === 'Terminal' && '⌨'}</span>
                          <span className="text-xl absolute">{app?.icon === 'Globe' && '🌐'}</span>
                          <span className="text-xl absolute">{app?.icon === 'Settings' && '⚙'}</span>
                          <span className="text-xl absolute">{app?.icon === 'FileText' && '📄'}</span>
                          <span className="text-xl absolute">
                            {!['Folder', 'Terminal', 'Globe', 'Settings', 'FileText'].includes(app?.icon || '') && '📱'}
                          </span>
                        </div>
                        <span className="text-[10px] text-[var(--text-primary)] text-center truncate max-w-[64px]">
                          {w.title}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <style>{`
            @keyframes alttabAppear {
              from { opacity: 0; transform: scale(0.9); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>
        </ShellMenuProvider>
      )}
    </div>
  );
}

export default function App() {
  return (
    <DaemonClientProvider>
      <DaemonStateProvider>
        <OSProvider>
          <ClipboardProvider>
            <HostBridgeWiring />
            <AppShell />
          </ClipboardProvider>
        </OSProvider>
      </DaemonStateProvider>
    </DaemonClientProvider>
  );
}
