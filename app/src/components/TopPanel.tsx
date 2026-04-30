// ============================================================
// TopPanel — branded macOS-style menu bar + contextual app menus
// ============================================================

import { useState, useEffect, useCallback, memo, useRef, useMemo, type ReactNode } from 'react';
import { format } from 'date-fns';
import { enUS, es as esLocale } from 'date-fns/locale';
import {
  AlertTriangle,
  Bell,
  Box,
  Grid3X3,
  Info,
  Lock,
  LogOut,
  Server,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useRegisteredShellMenu } from '@/hooks/useShellMenu';
import { computePill } from '@/lib/statusPill';
import { defaultShellMenuForApp, type ShellMenuActionId, type ShellMenuGroup, type ShellMenuItem } from '@/lib/shellMenu';
import { useI18n } from '@/i18n';

const BRAND_MARK = '/brand/tytusos-mark-32.png';

const PILL_TEXT: Record<string, string> = {
  green: '#A5D6A7',
  yellow: '#FFE082',
  red: '#FFCDD2',
  gray: '#E0E0E0',
};

const TopPanel = memo(function TopPanel() {
  const { state, dispatch } = useOS();
  const { language, t } = useI18n();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const pill = computePill(daemon.status, daemon.state, daemon.error);

  const [time, setTime] = useState(new Date());
  const [sysMenuOpen, setSysMenuOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const leftMenuRef = useRef<HTMLDivElement>(null);

  const activeWindow = useMemo(
    () => state.windows.find((w) => w.id === state.activeWindowId && w.state !== 'minimized') ?? null,
    [state.activeWindowId, state.windows],
  );
  const registeredMenu = useRegisteredShellMenu(activeWindow?.id);
  const defaultMenu = useMemo(
    () => defaultShellMenuForApp(activeWindow?.appId ?? null, Boolean(activeWindow)),
    [activeWindow],
  );
  const menuModel = registeredMenu ?? defaultMenu;

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!sysMenuOpen && !openMenuId) return;
    const handleClick = (e: MouseEvent) => {
      if (leftMenuRef.current && !leftMenuRef.current.contains(e.target as Node)) {
        setSysMenuOpen(false);
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sysMenuOpen, openMenuId]);

  const openOrFocus = useCallback(
    (appId: string) => {
      dispatch({ type: 'OPEN_OR_FOCUS_WINDOW', appId });
    },
    [dispatch],
  );

  const openWindow = useCallback(
    (appId: string) => {
      dispatch({ type: 'OPEN_WINDOW', appId });
    },
    [dispatch],
  );

  const navigateSettings = useCallback(
    (section: string) => {
      if (typeof location !== 'undefined') {
        location.hash = `#/settings/${section}`;
      }
      dispatch({ type: 'OPEN_OR_FOCUS_WINDOW', appId: 'settings' });
    },
    [dispatch],
  );

  const closeMenus = useCallback(() => {
    setSysMenuOpen(false);
    setOpenMenuId(null);
  }, []);

  const handleActivities = useCallback(() => {
    dispatch({ type: 'TOGGLE_APP_LAUNCHER' });
  }, [dispatch]);

  const handleClockClick = useCallback(() => {
    dispatch({ type: 'TOGGLE_NOTIFICATION_CENTER' });
  }, [dispatch]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    setSignOutError(null);
    const r = await client.postLogout();
    setSigningOut(false);
    if (!r.ok) {
      setSignOutError(r.error.message);
      return;
    }
    setSignOutConfirmOpen(false);
    dispatch({ type: 'LOGOUT' });
    daemon.refresh();
  }, [client, dispatch, daemon, setSigningOut, setSignOutError, setSignOutConfirmOpen]);

  const executeShellAction = useCallback(
    (actionId: ShellMenuActionId | undefined) => {
      if (!actionId) return;
      closeMenus();
      switch (actionId) {
        case 'open-apps':
          handleActivities();
          return;
        case 'open-pods':
          openOrFocus('pod-inspector');
          return;
        case 'open-channels':
          openOrFocus('channels');
          return;
        case 'open-files':
          openOrFocus('filemanager');
          return;
        case 'open-help':
          openOrFocus('help');
          return;
        case 'open-terminal':
          openWindow('terminal');
          return;
        case 'open-notifications':
          handleClockClick();
          return;
        case 'refresh-daemon':
          daemon.refresh();
          return;
        case 'minimize-window':
          if (activeWindow) dispatch({ type: 'MINIMIZE_WINDOW', windowId: activeWindow.id });
          return;
        case 'close-window':
          if (activeWindow) dispatch({ type: 'CLOSE_WINDOW', windowId: activeWindow.id });
          return;
        case 'open-settings-account':
          navigateSettings('account');
          return;
        case 'open-settings-plan':
          navigateSettings('plan');
          return;
        case 'open-settings-pods':
          navigateSettings('pods');
          return;
        case 'open-settings-agents':
          navigateSettings('agents');
          return;
        case 'open-settings-daemon':
          navigateSettings('daemon');
          return;
        case 'open-settings-background':
          navigateSettings('background');
          return;
        case 'open-settings-appearance':
          navigateSettings('appearance');
          return;
        case 'open-settings-language':
          navigateSettings('language');
          return;
        case 'open-settings-notifications':
          navigateSettings('notifications');
          return;
        case 'open-settings-privacy':
          navigateSettings('privacy');
          return;
        case 'open-settings-about':
          navigateSettings('about');
          return;
      }
    },
    [activeWindow, closeMenus, daemon, dispatch, handleActivities, handleClockClick, navigateSettings, openOrFocus, openWindow],
  );

  const handleMenuItem = useCallback(
    (item: ShellMenuItem) => {
      if (item.disabled) return;
      closeMenus();
      if (item.onSelect) {
        item.onSelect();
        return;
      }
      executeShellAction(item.actionId);
    },
    [closeMenus, executeShellAction],
  );

  const dateLocale = String(language).startsWith('es') ? esLocale : enUS;
  const formattedTime = format(time, 'EEE d MMM HH:mm', { locale: dateLocale });
  const formattedDate = format(time, 'EEEE, d MMMM yyyy, HH:mm:ss', { locale: dateLocale });
  const userLabel = daemon.state?.email ?? state.auth.userName;
  const localizedMenuModel = useMemo(() => ({
    appLabel: activeWindow?.appId ? t(`app.${activeWindow.appId}.name`) : menuModel.appLabel,
    groups: menuModel.groups.map((group) => ({
      ...group,
      label: t(`shell.${group.label}`),
      items: group.items.map((item) => ({ ...item, label: t(`shell.${item.label}`) })),
    })),
  }), [activeWindow, menuModel, t]);

  const fleet = useMemo(() => {
    if (!daemon.state) return null;
    const agents = daemon.state.agents.length;
    const included = daemon.state.included.length;
    const activeJobs = Object.values(daemon.state.active_jobs_per_pod).reduce(
      (sum, jobs) => sum + (Array.isArray(jobs) ? jobs.length : 0),
      0,
    );
    // Real-pod count excludes AIL — AIL has its own status chip below.
    // AIL is its own thing, not a numbered pod. The chip dot lights
    // green only when the user has at least one allocated agent pod.
    let color: 'green' | 'yellow' | 'gray' = 'gray';
    if (agents > 0) color = activeJobs > 0 ? 'yellow' : 'green';
    return { agents, included, activeJobs, color };
  }, [daemon.state]);

  // AIL gateway status chip — independent of agent pod state. Green
  // when an included pod exists AND the WireGuard tunnel is up; yellow
  // when included exists but tunnel is down (so requests to 10.42.42.1
  // would hang); gray when there's no included pod yet.
  const ailStatus = useMemo(() => {
    if (!daemon.state) return null;
    const has = daemon.state.included.length > 0;
    if (!has) return { color: 'gray' as const, label: 'AIL', detail: 'No AIL gateway yet — sign in to allocate.' };
    if (!daemon.state.tunnel_active) {
      return {
        color: 'yellow' as const,
        label: 'AIL',
        detail: 'AIL gateway provisioned but WireGuard tunnel is down. Reconnect to use it.',
      };
    }
    return {
      color: 'green' as const,
      label: 'AIL',
      detail: 'AIL gateway is reachable. Click to open it in Pod Inspector.',
    };
  }, [daemon.state]);

  const unitsText = daemon.state
    ? t('status.unitsUsed', { used: daemon.state.units_used, limit: daemon.state.units_limit })
    : t('status.unitsUnknown');

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[200] grid items-center px-2 text-xs font-medium select-none"
      style={{
        height: 28,
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '1px solid var(--chrome-border)',
        color: 'var(--chrome-text-primary)',
      }}
    >
      {/* Left: logo menu + active app contextual menus, macOS-style. */}
      <div ref={leftMenuRef} className="flex items-center justify-self-start gap-1 min-w-0">
        <div className="relative">
          <button
            onClick={() => {
              setOpenMenuId(null);
              setSysMenuOpen(!sysMenuOpen);
            }}
            aria-label="Tytus menu"
            aria-expanded={sysMenuOpen}
            title="Tytus menu"
            className="h-7 w-8 rounded-md hover:bg-[var(--chrome-hover)] transition-colors flex items-center justify-center shrink-0"
          >
            <img src={BRAND_MARK} alt="tytusOS" width={24} height={24} className="block" />
          </button>

          {sysMenuOpen && (
            <div
              className="absolute top-full left-0 mt-1 py-1.5 rounded-xl z-[5000]"
              style={{
                background: 'var(--bg-context-menu)',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--border-default)',
                width: 288,
                animation: 'menuAppear 120ms cubic-bezier(0, 0, 0.2, 1)',
              }}
            >
              <MenuAction icon={<Info size={14} />} label={t('top.aboutTytusOS')} onClick={() => { closeMenus(); navigateSettings('about'); }} />
              <MenuAction icon={<Settings size={14} />} label={t('top.systemSettings')} onClick={() => { closeMenus(); navigateSettings('account'); }} />
              <div className="my-1 mx-2" style={{ height: 1, background: 'var(--border-subtle)' }} />
              <MenuAction icon={<Grid3X3 size={14} />} label={t('top.openApps')} onClick={() => { closeMenus(); handleActivities(); }} />
              <div className="my-1 mx-2" style={{ height: 1, background: 'var(--border-subtle)' }} />
              <MenuAction icon={<Lock size={14} />} label={t('top.lockScreen')} onClick={() => { closeMenus(); dispatch({ type: 'LOCK' }); }} />
              <MenuAction
                icon={<LogOut size={14} />}
                label={signingOut ? t('top.signingOut') : t('top.logOutUser', { user: userLabel.includes('@') ? userLabel.split('@')[0] : userLabel })}
                disabled={signingOut}
                onClick={() => {
                  closeMenus();
                  setSignOutConfirmOpen(true);
                }}
              />
              {signOutError && (
                <div className="px-3 py-1 text-[10px]" style={{ color: '#FFCDD2' }}>
                  {signOutError}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-0.5 min-w-0">
          <span className="h-6 px-2 flex items-center text-[12px] font-bold whitespace-nowrap text-[var(--chrome-text-primary)]">
            {localizedMenuModel.appLabel}
          </span>
          {localizedMenuModel.groups.map((group) => (
            <MenuGroupButton
              key={group.id}
              group={group}
              open={openMenuId === group.id}
              anyOpen={Boolean(openMenuId)}
              onOpen={() => {
                setSysMenuOpen(false);
                setOpenMenuId((current) => (current === group.id ? null : group.id));
              }}
              onHoverOpen={() => setOpenMenuId(group.id)}
              onItem={handleMenuItem}
            />
          ))}
        </div>
      </div>

      <div aria-hidden="true" />

      {/* Right: only real production status + notification + date/time. */}
      <div className="flex items-center gap-1 justify-self-end min-w-0">
        <StatusIconButton
          icon={<Server size={13} />}
          label={t(`status.${pill.label}`)}
          title={t('status.daemonTitle', { label: t(`status.${pill.label}`), detail: pill.detail })}
          color={PILL_TEXT[pill.color]}
          onClick={() => executeShellAction('open-settings-daemon')}
        />

        {fleet && pill.color !== 'red' && (
          <StatusIconButton
            icon={<Box size={13} />}
            label={t(fleet.agents === 1 ? 'status.podSingular' : 'status.podPlural', { count: fleet.agents })}
            title={
              fleet.agents === 0
                ? t('status.noPodsYet')
                : t('status.podsDetail', { count: fleet.agents, jobs: fleet.activeJobs, units: unitsText })
            }
            color={PILL_TEXT[fleet.color]}
            onClick={() => executeShellAction('open-pods')}
          />
        )}

        {ailStatus && pill.color !== 'red' && (
          <StatusIconButton
            icon={<Sparkles size={13} />}
            label={ailStatus.label}
            title={ailStatus.detail}
            color={PILL_TEXT[ailStatus.color]}
            onClick={() => executeShellAction('open-pods')}
          />
        )}

        <button
          onClick={handleClockClick}
          aria-label="Open notification center"
          title="Notifications"
          className="h-6 w-7 rounded-md hover:bg-[var(--chrome-hover)] transition-colors flex items-center justify-center text-[var(--chrome-text-secondary)] hover:text-[var(--chrome-text-primary)]"
        >
          <Bell size={13} />
        </button>

        <button
          onClick={handleClockClick}
          aria-label={`${formattedTime} — open notification center`}
          title={formattedDate}
          className="h-6 px-2 rounded-md hover:bg-[var(--chrome-hover)] transition-colors text-xs font-semibold whitespace-nowrap flex items-center"
        >
          {formattedTime}
        </button>
      </div>

      <style>{`
        @keyframes menuAppear {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {signOutConfirmOpen && (
        <div
          className="fixed inset-0 z-[6000] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm sign out"
        >
          <div
            className="w-[420px] rounded-2xl p-5"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              boxShadow: 'var(--shadow-lg)',
              color: 'var(--text-primary)',
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: 'rgba(244,67,54,0.12)', color: '#FFCDD2' }}
              >
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-base font-semibold">{t('top.confirmLogoutTitle')}</h2>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {t('top.confirmLogoutBody')}
                </p>
                {signOutError && (
                  <p className="mt-3 text-xs" style={{ color: '#FFCDD2' }}>
                    {signOutError}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSignOutConfirmOpen(false);
                  setSignOutError(null);
                }}
                disabled={signingOut}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                style={{
                  background: 'var(--bg-control)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                {t('top.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                style={{
                  background: '#D32F2F',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                {signingOut ? t('top.signingOut') : t('top.logOut')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const MenuGroupButton = ({
  group,
  open,
  anyOpen,
  onOpen,
  onHoverOpen,
  onItem,
}: {
  group: ShellMenuGroup;
  open: boolean;
  anyOpen: boolean;
  onOpen: () => void;
  onHoverOpen: () => void;
  onItem: (item: ShellMenuItem) => void;
}) => (
  <div className="relative" onMouseEnter={() => { if (anyOpen) onHoverOpen(); }}>
    <button
      onClick={onOpen}
      className="h-6 px-2 rounded-md hover:bg-[var(--chrome-hover)] transition-colors text-[12px] font-semibold whitespace-nowrap"
      aria-expanded={open}
    >
      {group.label}
    </button>
    {open && (
      <div
        className="absolute top-full left-0 mt-1 py-1.5 rounded-xl z-[5000] min-w-52"
        style={{
          background: 'var(--bg-context-menu)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border-default)',
          animation: 'menuAppear 120ms cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        {group.items.map((item) => (
          <button
            key={item.id}
            onClick={() => onItem(item)}
            disabled={item.disabled}
            className="w-full px-3 py-2 text-sm text-left transition-colors disabled:opacity-45 disabled:cursor-default hover:enabled:bg-[var(--bg-hover)]"
            style={{ color: item.danger ? '#FFCDD2' : 'var(--text-primary)' }}
          >
            {item.label}
          </button>
        ))}
      </div>
    )}
  </div>
);

const StatusIconButton = ({
  icon,
  label,
  title,
  color,
  dot,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  color: string;
  dot?: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="h-6 px-1.5 rounded-md hover:bg-[var(--chrome-hover)] transition-colors flex items-center gap-1.5"
    style={{ color }}
  >
    {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} aria-hidden="true" />}
    {icon}
    <span className="hidden xl:inline text-[11px] font-semibold">{label}</span>
  </button>
);

const MenuAction = ({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-hover)] transition-colors text-left disabled:opacity-60"
    onClick={onClick}
    disabled={disabled}
  >
    <span className="text-[var(--text-secondary)]">{icon}</span>
    {label}
  </button>
);

export default TopPanel;
