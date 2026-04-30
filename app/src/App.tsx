// ============================================================
// App.tsx — Main TytusOS Shell
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { OSProvider, useOS } from '@/hooks/useOSStore';
import { DaemonClientProvider } from '@/hooks/useDaemonClient';
import { DaemonStateProvider, useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import DaemonOfflineBanner from '@/components/DaemonOfflineBanner';
import UpgradeDaemonScreen from '@/components/UpgradeDaemonScreen';
import ZeroPodsOverlay from '@/components/ZeroPodsOverlay';
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
import { DEFAULT_TYTUS_WALLPAPER, isTytusWallpaper } from '@/lib/brand';

function AppShell() {
  const { state, dispatch } = useOS();
  const { bootPhase, auth } = state;
  const [bootComplete, setBootComplete] = useState(false);
  const altTabRef = useRef<{ holding: boolean }>({ holding: false });

  // Shell-level daemon state shared via DaemonStateProvider context so
  // TopPanel, DaemonOfflineBanner, and LoginScreen all read the same poll.
  const daemon = useDaemonStateContext();

  // Runtime migration: older sessions may still hold `/wallpaper-default.jpg`
  // in reducer state after HMR. Snap them onto the official bg3 default.
  useEffect(() => {
    if (!isTytusWallpaper(state.theme.wallpaper)) {
      dispatch({ type: 'SET_THEME', theme: { wallpaper: DEFAULT_TYTUS_WALLPAPER } });
    }
  }, [dispatch, state.theme.wallpaper]);

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

      // Ctrl+W closes active window
      if (e.ctrlKey && e.key === 'w' && state.activeWindowId) {
        e.preventDefault();
        dispatch({ type: 'CLOSE_WINDOW', windowId: state.activeWindowId });
      }
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
        <div className="relative w-full h-full" style={{ background: 'var(--bg-desktop)' }}>
          {/* Wallpaper layer */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${state.theme.wallpaper})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              zIndex: 0,
            }}
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
          <AppShell />
        </OSProvider>
      </DaemonStateProvider>
    </DaemonClientProvider>
  );
}
