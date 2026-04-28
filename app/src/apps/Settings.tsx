// ============================================================
// System Settings — Full system preferences panel
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Wifi, Bluetooth, Image, Palette, Bell, Volume2, Battery,
  Monitor, Mouse, Keyboard, Printer, Disc, Clock, User,
  Star, Eye, Info, Search, Check,
  Server, LogOut, Power, Loader2,
  CreditCard, Box, Sparkles, ExternalLink, AlertTriangle, X,
  Copy, EyeOff, RefreshCw,
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useHashRoute } from '@/hooks/useHashRoute';
import { useJobStream } from '@/hooks/useJobStream';
import { computePill } from '@/lib/statusPill';
import { maskSecret, maskTokenUrl, revealSecret, revealTokenUrl } from '@/lib/secrets';
import type {
  Catalog,
  CatalogAgent,
  DaemonSettings,
  Tier,
} from '@/types/daemon';

interface SettingCategory {
  id: string;
  label: string;
  icon: React.ReactNode;
}

// Tytus-first ordering: identity + private-AI controls live above the
// fold; OS-feel preferences (wifi, sound, etc.) follow a divider so
// they don't bury Pods/Agents on a low monitor.
const TYTUS_CATEGORIES: SettingCategory[] = [
  { id: 'account', label: 'Account', icon: <User size={18} /> },
  { id: 'plan', label: 'Plan & Units', icon: <CreditCard size={18} /> },
  { id: 'pods', label: 'Pods', icon: <Box size={18} /> },
  { id: 'agents', label: 'Agents', icon: <Sparkles size={18} /> },
  { id: 'daemon', label: 'Daemon', icon: <Server size={18} /> },
];

const SYSTEM_CATEGORIES: SettingCategory[] = [
  { id: 'wifi', label: 'Wi-Fi', icon: <Wifi size={18} /> },
  { id: 'bluetooth', label: 'Bluetooth', icon: <Bluetooth size={18} /> },
  { id: 'background', label: 'Background', icon: <Image size={18} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={18} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={18} /> },
  { id: 'sound', label: 'Sound', icon: <Volume2 size={18} /> },
  { id: 'power', label: 'Power', icon: <Battery size={18} /> },
  { id: 'display', label: 'Display', icon: <Monitor size={18} /> },
  { id: 'mouse', label: 'Mouse & Touchpad', icon: <Mouse size={18} /> },
  { id: 'keyboard', label: 'Keyboard', icon: <Keyboard size={18} /> },
  { id: 'printers', label: 'Printers', icon: <Printer size={18} /> },
  { id: 'removable', label: 'Removable Media', icon: <Disc size={18} /> },
  { id: 'datetime', label: 'Date & Time', icon: <Clock size={18} /> },
  { id: 'users', label: 'Users', icon: <User size={18} /> },
  { id: 'defaultapps', label: 'Default Apps', icon: <Star size={18} /> },
  { id: 'privacy', label: 'Privacy', icon: <Eye size={18} /> },
  { id: 'about', label: 'About', icon: <Info size={18} /> },
];

const ACCENT_COLORS = [
  { name: 'Purple', value: '#7C4DFF' },
  { name: 'Blue', value: '#2196F3' },
  { name: 'Teal', value: '#009688' },
  { name: 'Green', value: '#4CAF50' },
  { name: 'Yellow', value: '#FFEB3B' },
  { name: 'Orange', value: '#FF9800' },
  { name: 'Red', value: '#F44336' },
  { name: 'Pink', value: '#E91E63' },
];

const WALLPAPERS = [
  { id: '/wallpaper-default.jpg', name: 'Default' },
  { id: '/wallpaper-light.jpg', name: 'Light' },
  { id: '/wallpaper-nature.jpg', name: 'Nature' },
  { id: '/wallpaper-tech.jpg', name: 'Tech' },
];

const CategoryButton: React.FC<{
  cat: SettingCategory;
  active: boolean;
  onSelect: () => void;
}> = ({ cat, active, onSelect }) => (
  <button
    onClick={onSelect}
    className="flex items-center gap-3 w-full px-3 py-2.5 text-sm transition-colors"
    style={{
      background: active ? 'var(--bg-selected)' : 'transparent',
      color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
      borderLeft: active
        ? '3px solid var(--accent-primary)'
        : '3px solid transparent',
    }}
  >
    {cat.icon}
    {cat.label}
  </button>
);

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    className="relative h-6 rounded-full transition-colors duration-150"
    style={{
      width: 40,
      background: value ? 'var(--accent-primary)' : 'var(--border-default)',
    }}
  >
    <div
      className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-150"
      style={{ left: value ? 18 : 2 }}
    />
  </button>
);

const Slider: React.FC<{ value: number; min?: number; max?: number; onChange: (v: number) => void }> = ({ value, min = 0, max = 100, onChange }) => (
  <input
    type="range"
    min={min}
    max={max}
    value={value}
    onChange={e => onChange(Number(e.target.value))}
    className="w-32 h-1 rounded-full appearance-none cursor-pointer"
    style={{
      background: `linear-gradient(to right, var(--accent-primary) ${(value - min) / (max - min) * 100}%, var(--border-default) ${(value - min) / (max - min) * 100}%)`,
    }}
  />
);

const TIER_RANK: Record<Tier, number> = {
  explorer: 0,
  creator: 1,
  operator: 2,
};

const PROVIDER_BILLING_URL = 'https://tytus.traylinx.com/account/plan';

const ACTIVE_CATEGORY_STORAGE_KEY = 'tytus_settings_active_category';

const Settings: React.FC = () => {
  const { state, dispatch } = useOS();
  const route = useHashRoute();
  // Initial category resolution: hash route wins (deep-link), then
  // localStorage (returning user), then 'account' default.
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    if (route.kind === 'settings' && route.section) return route.section;
    try {
      const saved = localStorage.getItem(ACTIVE_CATEGORY_STORAGE_KEY);
      if (saved) return saved;
    } catch {
      // localStorage can throw in private-mode / sandboxed contexts.
    }
    return 'account';
  });

  // Persist on every change so reload restores the last-viewed panel.
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_CATEGORY_STORAGE_KEY, activeCategory);
    } catch {
      // best-effort — see above
    }
  }, [activeCategory]);
  const [search, setSearch] = useState('');
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const pill = computePill(daemon.status, daemon.state, daemon.error);

  // Deep-link: navigate(#/settings/agents) flips the active panel.
  // Deliberate setState-in-effect — we're syncing UI state from a URL
  // hash (an external store), not deriving state from props.
  useEffect(() => {
    if (route.kind !== 'settings') return;
    if (!route.section) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setActiveCategory(route.section);
  }, [route]);

  const [daemonSettings, setDaemonSettings] = useState<DaemonSettings | null>(null);
  const [daemonSettingsErr, setDaemonSettingsErr] = useState<string | null>(null);
  const [pendingSetting, setPendingSetting] = useState<keyof DaemonSettings | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [lifecycleErr, setLifecycleErr] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutErr, setSignOutErr] = useState<string | null>(null);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  // Catalog state — loaded on demand when the user opens the Agents tab.
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  // Bumped by Retry button to re-fire getCatalog without depending on
  // the activeCategory effect's other inputs.
  const [catalogReloadNonce, setCatalogReloadNonce] = useState(0);

  // Install wizard state. `pendingAgent` is the chosen card before install
  // fires; once we have a job_id, `installJob` is set and the modal swaps
  // to the streaming pane.
  const [pendingAgent, setPendingAgent] = useState<CatalogAgent | null>(null);
  const [installJob, setInstallJob] = useState<{ id: string; agent: CatalogAgent } | null>(null);
  const [installSubmitting, setInstallSubmitting] = useState(false);
  const [installSubmitErr, setInstallSubmitErr] = useState<string | null>(null);

  // Load daemon settings on mount + when daemon comes online.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = await client.getSettings();
      if (cancelled) return;
      if (r.ok) {
        setDaemonSettings(r.value);
        setDaemonSettingsErr(null);
      } else if (r.error.code !== 'daemon_offline') {
        setDaemonSettingsErr(r.error.message);
      }
    };
    if (daemon.status === 'online') load();
    return () => {
      cancelled = true;
    };
  }, [client, daemon.status]);

  const toggleAutostart = useCallback(
    async (key: keyof DaemonSettings) => {
      if (!daemonSettings) return;
      const next = !daemonSettings[key];
      setPendingSetting(key);
      const r =
        key === 'autostart_tray'
          ? await client.postSettingsAutostartTray(next)
          : await client.postSettingsAutostartTunnel(next);
      setPendingSetting(null);
      if (r.ok) {
        setDaemonSettings({ ...daemonSettings, [key]: next });
      } else {
        setDaemonSettingsErr(r.error.message);
      }
    },
    [client, daemonSettings],
  );

  const runLifecycle = useCallback(
    async (action: 'start' | 'stop' | 'restart') => {
      setLifecycleAction(action);
      setLifecycleErr(null);
      const r =
        action === 'start'
          ? await client.postDaemonStart()
          : action === 'stop'
            ? await client.postDaemonStop()
            : await client.postDaemonRestart();
      setLifecycleAction(null);
      if (!r.ok) {
        setLifecycleErr(r.error.message);
      } else {
        daemon.refresh();
      }
    },
    [client, daemon],
  );

  // Load catalog when Agents tab opens (and re-load after a successful
  // install so newly available units are reflected if the catalog ever
  // gates them). The lint rule warns about setState-in-effect, but
  // we're syncing local UI state with the result of a network fetch —
  // there's no other place this initialisation can live.
  useEffect(() => {
    if (activeCategory !== 'agents') return;
    if (daemon.status !== 'online') return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setCatalogLoading(true);
    setCatalogErr(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    client.getCatalog().then((r) => {
      if (cancelled) return;
      setCatalogLoading(false);
      if (r.ok) {
        setCatalog(r.value);
      } else if (r.error.code !== 'daemon_offline') {
        setCatalogErr(r.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeCategory, client, daemon.status, catalogReloadNonce]);

  // Deep-link install: navigate(#/settings/agents?install=<id|auto>)
  // pre-opens the wizard with the matching (or cheapest installable)
  // agent. Consumed once — we strip the param to avoid re-firing on
  // user navigation.
  const installParamConsumedRef = useRef(false);
  useEffect(() => {
    if (route.kind !== 'settings' || route.section !== 'agents') return;
    if (!catalog || !daemon.state) return;
    if (installParamConsumedRef.current) return;
    const want = route.params.get('install');
    if (!want) return;

    const tier = daemon.state.tier;
    const remaining = daemon.state.units_limit - daemon.state.units_used;
    const userRank = TIER_RANK[tier];
    const installable = catalog.agents.filter(
      (a) => userRank >= TIER_RANK[a.min_plan] && remaining >= a.units,
    );

    let pick: CatalogAgent | undefined;
    if (want === 'auto') {
      // Cheapest first; nemoclaw at 1u beats hermes at 2u.
      pick = [...installable].sort((a, b) => a.units - b.units)[0];
    } else {
      pick = catalog.agents.find((a) => a.id === want);
    }
    if (!pick) return;

    installParamConsumedRef.current = true;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setPendingAgent(pick);
    // Strip ?install so refresh / back-nav doesn't re-trigger.
    const cleaned = new URLSearchParams(route.params);
    cleaned.delete('install');
    if (typeof location !== 'undefined') {
      const q = cleaned.toString();
      location.hash = `#/settings/agents${q ? `?${q}` : ''}`;
    }
  }, [route, catalog, daemon.state]);

  const startInstall = useCallback(async () => {
    if (!pendingAgent) return;
    setInstallSubmitting(true);
    setInstallSubmitErr(null);
    const r = await client.postInstall(pendingAgent.id);
    setInstallSubmitting(false);
    if (!r.ok) {
      setInstallSubmitErr(r.error.message);
      return;
    }
    setInstallJob({ id: r.value.job_id, agent: pendingAgent });
  }, [client, pendingAgent]);

  const retryInstall = useCallback(() => {
    // Drop the failed/lost job but keep pendingAgent so the wizard
    // returns to the confirm step with the same selection.
    setInstallJob(null);
    setInstallSubmitErr(null);
  }, []);

  const closeInstallWizard = useCallback(() => {
    setPendingAgent(null);
    setInstallJob(null);
    setInstallSubmitErr(null);
    daemon.refresh();
  }, [daemon]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setSignOutErr(null);
    const r = await client.postLogout();
    setSigningOut(false);
    if (!r.ok) {
      setSignOutErr(r.error.message);
      return;
    }
    setSignOutConfirmOpen(false);
    dispatch({ type: 'LOGOUT' });
    daemon.refresh();
  }, [client, dispatch, daemon]);

  // Settings state (loaded from localStorage)
  const [settings, setSettings] = useState<Record<string, unknown>>(() => {
    try { return JSON.parse(localStorage.getItem('tytus_settings') || '{}'); } catch { return {}; }
  });

  const updateSetting = useCallback((key: string, value: unknown) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem('tytus_settings', JSON.stringify(next));
      return next;
    });
  }, []);

  const s = (key: string, def: unknown) => settings[key] ?? def;

  // While searching: flatten both groups and filter; sidebar renders a
  // single list. Otherwise: render the two groups with a divider.
  const ALL_CATEGORIES = useMemo(
    () => [...TYTUS_CATEGORIES, ...SYSTEM_CATEGORIES],
    [],
  );
  const filteredCategories = search
    ? ALL_CATEGORIES.filter(c =>
        c.label.toLowerCase().includes(search.toLowerCase()),
      )
    : null;

  const renderPanel = () => {
    switch (activeCategory) {
      case 'account':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Account</h2>
            <div
              className="p-4 rounded-lg flex items-center gap-4"
              style={{ background: 'var(--bg-card, rgba(255,255,255,0.03))', border: '1px solid var(--border-subtle)' }}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #7C4DFF, #4A148C)' }}
              >
                <User size={28} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--text-primary)] font-semibold truncate">
                  {daemon.state?.email ?? 'Not signed in'}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Tier:{' '}
                  <span className="font-medium">
                    {daemon.state?.tier ?? '—'}
                  </span>
                  {daemon.state && (
                    <>
                      {' · '}
                      {daemon.state.units_used}/{daemon.state.units_limit} units
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => setSignOutConfirmOpen(true)}
                disabled={signingOut || !daemon.state?.logged_in}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50"
                style={{
                  background: 'rgba(244,67,54,0.10)',
                  border: '1px solid rgba(244,67,54,0.30)',
                  color: '#FFCDD2',
                }}
              >
                <LogOut size={14} />
                Sign out
              </button>
              {signOutErr && (
                <div className="text-xs" style={{ color: '#F44336' }}>
                  {signOutErr}
                </div>
              )}
              <div className="text-[11px] text-[var(--text-secondary)]">
                Sign-in is initiated from the Tytus tray menu (
                <strong>Sign in</strong>). TytusOS will pick up the new session automatically.
              </div>
            </div>
          </div>
        );

      case 'daemon':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Daemon</h2>

            <div
              className="p-4 rounded-lg flex items-start gap-3"
              style={{ background: 'var(--bg-card, rgba(255,255,255,0.03))', border: '1px solid var(--border-subtle)' }}
            >
              <span
                className="w-3 h-3 rounded-full mt-1.5"
                style={{
                  background:
                    pill.color === 'green' ? '#4CAF50'
                      : pill.color === 'yellow' ? '#FFC107'
                        : pill.color === 'red' ? '#F44336' : '#9E9E9E',
                }}
                aria-hidden="true"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{pill.label}</div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">{pill.detail}</div>
                {daemon.state && (
                  <div className="text-[11px] text-[var(--text-secondary)] mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <span>PID</span><span className="font-mono">{daemon.state.daemon_pid}</span>
                    <span>Uptime</span><span className="font-mono">{Math.round(daemon.state.uptime_secs / 60)}m</span>
                    <span>Tunnel</span><span className="font-mono">{daemon.state.tunnel_active ? 'active' : 'down'}</span>
                    <span>Keychain</span><span className="font-mono">{daemon.state.keychain_healthy ? 'healthy' : 'unhealthy'}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Lifecycle</div>
              <div className="flex flex-wrap gap-2">
                {(['start', 'restart', 'stop'] as const).map((action) => (
                  <button
                    key={action}
                    onClick={() => runLifecycle(action)}
                    disabled={lifecycleAction !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-60"
                    style={{
                      background: 'var(--bg-hover, rgba(255,255,255,0.04))',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {lifecycleAction === action ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Power size={12} />
                    )}
                    {action.charAt(0).toUpperCase() + action.slice(1)}
                  </button>
                ))}
              </div>
              {lifecycleErr && (
                <div className="text-xs" style={{ color: '#F44336' }}>
                  {lifecycleErr}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Autostart</div>
              {!daemonSettings && !daemonSettingsErr && (
                <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Loading settings…
                </div>
              )}
              {daemonSettingsErr && (
                <div className="text-xs" style={{ color: '#F44336' }}>{daemonSettingsErr}</div>
              )}
              {daemonSettings && (
                <>
                  <div className="flex items-center justify-between py-2 px-3 rounded-md" style={{ background: 'var(--bg-hover, rgba(255,255,255,0.02))' }}>
                    <div>
                      <div className="text-sm text-[var(--text-primary)]">Tray autostart</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Launch the menu-bar app at login.</div>
                    </div>
                    {pendingSetting === 'autostart_tray' ? (
                      <Loader2 size={14} className="animate-spin text-[var(--text-secondary)]" />
                    ) : (
                      <Toggle
                        value={daemonSettings.autostart_tray}
                        onChange={() => toggleAutostart('autostart_tray')}
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-between py-2 px-3 rounded-md" style={{ background: 'var(--bg-hover, rgba(255,255,255,0.02))' }}>
                    <div>
                      <div className="text-sm text-[var(--text-primary)]">Tunnel autostart</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Bring up the WireGuard tunnel at login.</div>
                    </div>
                    {pendingSetting === 'autostart_tunnel' ? (
                      <Loader2 size={14} className="animate-spin text-[var(--text-secondary)]" />
                    ) : (
                      <Toggle
                        value={daemonSettings.autostart_tunnel}
                        onChange={() => toggleAutostart('autostart_tunnel')}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );

      case 'plan':
        return <PlanPanel
          state={daemon.state}
          onUpgrade={() => client.postOpenExternal(PROVIDER_BILLING_URL)}
          onRefresh={daemon.refresh}
        />;

      case 'pods':
        return <PodsPanel
          state={daemon.state}
          onAllocate={() => setActiveCategory('agents')}
          onRefresh={daemon.refresh}
        />;

      case 'agents':
        return <AgentsPanel
          state={daemon.state}
          catalog={catalog}
          loading={catalogLoading}
          error={catalogErr}
          onPick={(a) => setPendingAgent(a)}
          onRetry={() => setCatalogReloadNonce((n) => n + 1)}
        />;

      case 'wifi':
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Wi-Fi</h2>
            <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-sm text-[var(--text-primary)]">Wi-Fi</div>
                <div className="text-xs text-[var(--text-secondary)]">{s('wifi_enabled', true) ? 'Connected to HomeNetwork' : 'Off'}</div>
              </div>
              <Toggle value={!!s('wifi_enabled', true)} onChange={v => updateSetting('wifi_enabled', v)} />
            </div>
            {!!s('wifi_enabled', true) && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Known Networks</div>
                {['HomeNetwork', 'Office_WiFi', 'CoffeeShop_Guest'].map(n => (
                  <div key={n} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-hover)]">
                    <div className="flex items-center gap-2">
                      <Wifi size={14} className="text-[var(--accent-primary)]" />
                      <span className="text-sm text-[var(--text-primary)]">{n}</span>
                    </div>
                    <Check size={14} className="text-[var(--accent-primary)]" />
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'appearance':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Appearance</h2>
            <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-sm text-[var(--text-primary)]">Dark Mode</div>
                <div className="text-xs text-[var(--text-secondary)]">Use dark theme across the system</div>
              </div>
              <Toggle value={state.theme.mode === 'dark'} onChange={() => dispatch({ type: 'TOGGLE_THEME' })} />
            </div>
            <div className="space-y-3">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Accent Color</div>
              <div className="flex gap-3 flex-wrap">
                {ACCENT_COLORS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => dispatch({ type: 'SET_THEME', theme: { accent: c.value } })}
                    className="w-10 h-10 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: c.value,
                      boxShadow: state.theme.accent === c.value ? `0 0 0 3px white, 0 0 0 5px ${c.value}` : 'none',
                    }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          </div>
        );

      case 'background':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Background</h2>
            <div className="grid grid-cols-2 gap-4">
              {WALLPAPERS.map(w => (
                <button
                  key={w.id}
                  onClick={() => dispatch({ type: 'SET_THEME', theme: { wallpaper: w.id } })}
                  className="relative rounded-lg overflow-hidden border-2 transition-all hover:scale-[1.02]"
                  style={{
                    borderColor: state.theme.wallpaper === w.id ? 'var(--accent-primary)' : 'transparent',
                    aspectRatio: '16/9',
                  }}
                >
                  <img src={w.id} alt={w.name} className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-xs text-white" style={{ background: 'rgba(0,0,0,0.6)' }}>
                    {w.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Notifications</h2>
            <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-sm text-[var(--text-primary)]">Do Not Disturb</div>
                <div className="text-xs text-[var(--text-secondary)]">Silence all notifications</div>
              </div>
              <Toggle value={!!s('dnd', false)} onChange={v => updateSetting('dnd', v)} />
            </div>
            <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mt-4">Per-App Settings</div>
            {['Calendar', 'Todo List', 'Reminders', 'Email'].map(app => (
              <div key={app} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-hover)]">
                <span className="text-sm text-[var(--text-primary)]">{app}</span>
                <Toggle value={!!s(`notif_${app}`, true)} onChange={v => updateSetting(`notif_${app}`, v)} />
              </div>
            ))}
          </div>
        );

      case 'sound':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Sound</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-[var(--text-primary)]">Output Volume</div>
                <Slider value={s('output_vol', 75) as number} onChange={v => updateSetting('output_vol', v)} />
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-[var(--text-primary)]">Input Volume</div>
                <Slider value={s('input_vol', 60) as number} onChange={v => updateSetting('input_vol', v)} />
              </div>
              <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div>
                  <div className="text-sm text-[var(--text-primary)]">Output Device</div>
                </div>
                <select
                  className="text-xs bg-[var(--bg-input)] text-[var(--text-primary)] border rounded-md px-2 py-1 outline-none"
                  style={{ borderColor: 'var(--border-default)' }}
                  value={s('output_device', 'speakers') as string}
                  onChange={e => updateSetting('output_device', e.target.value)}
                >
                  <option value="speakers">Built-in Speakers</option>
                  <option value="headphones">Headphones</option>
                  <option value="hdmi">HDMI</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-[var(--text-primary)]">Alert Sound</div>
                <Toggle value={!!s('alert_sound', true)} onChange={v => updateSetting('alert_sound', v)} />
              </div>
            </div>
          </div>
        );

      case 'display':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Display</h2>
            <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-sm text-[var(--text-primary)]">Resolution</div>
              </div>
              <select
                className="text-xs bg-[var(--bg-input)] text-[var(--text-primary)] border rounded-md px-2 py-1 outline-none"
                style={{ borderColor: 'var(--border-default)' }}
                value={s('resolution', '1920x1080') as string}
                onChange={e => updateSetting('resolution', e.target.value)}
              >
                <option value="1920x1080">1920 x 1080</option>
                <option value="2560x1440">2560 x 1440</option>
                <option value="3840x2160">3840 x 2160</option>
                <option value="1280x720">1280 x 720</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">Scale</div>
              <select
                className="text-xs bg-[var(--bg-input)] text-[var(--text-primary)] border rounded-md px-2 py-1 outline-none"
                style={{ borderColor: 'var(--border-default)' }}
                value={s('scale', '100') as string}
                onChange={e => updateSetting('scale', e.target.value)}
              >
                <option value="100">100%</option>
                <option value="125">125%</option>
                <option value="150">150%</option>
                <option value="200">200%</option>
              </select>
            </div>
          </div>
        );

      case 'power':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Power</h2>
            <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-sm text-[var(--text-primary)]">Screen Blank</div>
                <div className="text-xs text-[var(--text-secondary)]">Turn off screen after inactivity</div>
              </div>
              <select
                className="text-xs bg-[var(--bg-input)] text-[var(--text-primary)] border rounded-md px-2 py-1 outline-none"
                style={{ borderColor: 'var(--border-default)' }}
                value={s('screen_blank', '5min') as string}
                onChange={e => updateSetting('screen_blank', e.target.value)}
              >
                <option value="1min">1 minute</option>
                <option value="5min">5 minutes</option>
                <option value="10min">10 minutes</option>
                <option value="never">Never</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">Automatic Suspend</div>
              <Toggle value={!!s('auto_suspend', true)} onChange={v => updateSetting('auto_suspend', v)} />
            </div>
          </div>
        );

      case 'datetime':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Date & Time</h2>
            <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-sm text-[var(--text-primary)]">24-Hour Time</div>
              </div>
              <Toggle value={!!s('24h', false)} onChange={v => updateSetting('24h', v)} />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">Time Zone</div>
              <select
                className="text-xs bg-[var(--bg-input)] text-[var(--text-primary)] border rounded-md px-2 py-1 outline-none"
                style={{ borderColor: 'var(--border-default)' }}
                value={s('timezone', 'UTC') as string}
                onChange={e => updateSetting('timezone', e.target.value)}
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern Time</option>
                <option value="America/Chicago">Central Time</option>
                <option value="America/Denver">Mountain Time</option>
                <option value="America/Los_Angeles">Pacific Time</option>
                <option value="Europe/London">London</option>
                <option value="Europe/Paris">Paris</option>
                <option value="Asia/Tokyo">Tokyo</option>
              </select>
            </div>
          </div>
        );

      case 'privacy':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Privacy</h2>
            <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-sm text-[var(--text-primary)]">Screen Lock</div>
                <div className="text-xs text-[var(--text-secondary)]">Lock screen after screen blank</div>
              </div>
              <Toggle value={!!s('screen_lock', true)} onChange={v => updateSetting('screen_lock', v)} />
            </div>
            <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-sm text-[var(--text-primary)]">Usage Data</div>
                <div className="text-xs text-[var(--text-secondary)]">Send anonymous usage statistics</div>
              </div>
              <Toggle value={!!s('usage_data', false)} onChange={v => updateSetting('usage_data', v)} />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">Location Services</div>
              <Toggle value={!!s('location', false)} onChange={v => updateSetting('location', v)} />
            </div>
          </div>
        );

      case 'about':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">About</h2>
            <div className="flex flex-col items-center py-6">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' }}>
                <span className="text-3xl font-bold text-white">U</span>
              </div>
              <div className="text-xl font-semibold text-[var(--text-primary)]">TytusOS</div>
              <div className="text-sm text-[var(--text-secondary)]">Version 24.04 LTS</div>
            </div>
            <div className="space-y-3">
              {[
                ['Device Name', 'tytusos-desktop'],
                ['Memory', '8 GB'],
                ['Processor', 'WebAssembly Virtual CPU'],
                ['Graphics', 'WebGL 2.0'],
                ['Storage', '50 GB (Browser localStorage)'],
                ['Browser', navigator.userAgent.slice(0, 50) + '...'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="text-sm text-[var(--text-secondary)]">{label}</span>
                  <span className="text-sm text-[var(--text-primary)]">{value}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                <div className="h-full rounded-full" style={{ width: '42%', background: 'var(--accent-primary)' }} />
              </div>
              <span className="text-xs text-[var(--text-secondary)]">Storage: 21 GB / 50 GB</span>
            </div>
            <button
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ background: 'var(--accent-primary)' }}
              onClick={() => alert('You are up to date!')}
            >
              Check for Updates
            </button>
          </div>
        );

      default:
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              {ALL_CATEGORIES.find(c => c.id === activeCategory)?.label}
            </h2>
            <div className="flex items-center justify-center h-32">
              <span className="text-sm text-[var(--text-secondary)]">Settings for this category are not yet implemented.</span>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex h-full" style={{ background: 'var(--bg-window)' }}>
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-titlebar)' }}>
        <div className="p-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'var(--bg-input)' }}>
            <Search size={14} className="text-[var(--text-secondary)]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search settings..."
              className="flex-1 bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredCategories
            ? filteredCategories.map(cat => (
                <CategoryButton
                  key={cat.id}
                  cat={cat}
                  active={activeCategory === cat.id}
                  onSelect={() => { setActiveCategory(cat.id); setSearch(''); }}
                />
              ))
            : (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] opacity-70">
                  Tytus
                </div>
                {TYTUS_CATEGORIES.map(cat => (
                  <CategoryButton
                    key={cat.id}
                    cat={cat}
                    active={activeCategory === cat.id}
                    onSelect={() => setActiveCategory(cat.id)}
                  />
                ))}
                <div
                  className="my-2 mx-3"
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                />
                <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] opacity-70">
                  System
                </div>
                {SYSTEM_CATEGORIES.map(cat => (
                  <CategoryButton
                    key={cat.id}
                    cat={cat}
                    active={activeCategory === cat.id}
                    onSelect={() => setActiveCategory(cat.id)}
                  />
                ))}
              </>
            )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        {renderPanel()}
      </div>

      {/* Install wizard modal */}
      {(pendingAgent || installJob) && (
        <InstallWizard
          agent={(installJob?.agent ?? pendingAgent) as CatalogAgent}
          jobId={installJob?.id ?? null}
          submitting={installSubmitting}
          submitErr={installSubmitErr}
          jobStreamUrl={installJob ? client.jobStreamUrl(installJob.id) : null}
          onConfirm={startInstall}
          onRetry={retryInstall}
          onSuccess={daemon.refresh}
          onClose={closeInstallWizard}
        />
      )}

      {/* Sign-out confirmation. /api/logout revokes ALL pod allocations
          server-side; never call it without a confirmation step. */}
      {signOutConfirmOpen && (
        <SignOutConfirm
          podCount={daemon.state?.agents.length ?? 0}
          submitting={signingOut}
          onConfirm={signOut}
          onCancel={() => setSignOutConfirmOpen(false)}
        />
      )}
    </div>
  );
};

// ============================================================
// Plan & Units panel
// ============================================================

interface PlanPanelProps {
  state: import('@/types/daemon').StateSnapshot | null;
  onUpgrade: () => void;
  onRefresh: () => void;
}

const PlanPanel: React.FC<PlanPanelProps> = ({ state, onUpgrade, onRefresh }) => {
  if (!state) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Plan & Units</h2>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" /> Loading plan…
        </div>
      </div>
    );
  }

  const pct = state.units_limit > 0
    ? Math.min(100, Math.round((state.units_used / state.units_limit) * 100))
    : 0;
  const remaining = Math.max(0, state.units_limit - state.units_used);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Plan & Units</h2>
        <RefreshButton onClick={onRefresh} />
      </div>

      <div
        className="p-5 rounded-lg"
        style={{ background: 'var(--bg-card, rgba(255,255,255,0.03))', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Tier</div>
            <div className="text-lg font-semibold text-[var(--text-primary)] capitalize">
              {state.tier}
            </div>
          </div>
          <button
            onClick={onUpgrade}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: 'rgba(124,77,255,0.12)',
              border: '1px solid rgba(124,77,255,0.30)',
              color: '#D6C8FF',
            }}
          >
            Upgrade plan <ExternalLink size={11} />
          </button>
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-1.5">
            <span>{state.units_used} of {state.units_limit} units used</span>
            <span>{remaining} available</span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: 'var(--border-subtle)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: pct >= 100
                  ? '#F44336'
                  : pct >= 75
                    ? '#FFC107'
                    : 'var(--accent-primary)',
              }}
            />
          </div>
        </div>
      </div>

      {state.agents.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Breakdown
          </div>
          <div className="space-y-1">
            {state.agents.map((a) => (
              <div
                key={a.pod_id}
                className="flex items-center justify-between py-1.5 px-3 rounded-md text-xs"
                style={{
                  background: 'var(--bg-card, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <span className="text-[var(--text-primary)]">
                  Pod {a.pod_id} · {a.agent_type}
                </span>
                <span className="font-mono text-[var(--text-secondary)]">
                  {a.units} unit{a.units === 1 ? '' : 's'}
                </span>
              </div>
            ))}
            <div
              className="flex items-center justify-between py-1.5 px-3 text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              <span>Total</span>
              <span className="font-mono">{state.units_used} of {state.units_limit}</span>
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-[var(--text-secondary)]">
        Units are consumed by allocated agents (nemoclaw = 1 unit, hermes = 2 units).
        Included AIL pods don't count against your unit budget.
      </div>
    </div>
  );
};

// ============================================================
// Pods panel
// ============================================================

interface PodsPanelProps {
  state: import('@/types/daemon').StateSnapshot | null;
  onAllocate: () => void;
  onRefresh: () => void;
}

const PodsPanel: React.FC<PodsPanelProps> = ({ state, onAllocate, onRefresh }) => {
  // Bumped by RefreshButton clicks; PodCard reads it to re-probe
  // /api/pod/ready without us coupling to daemon poll timing.
  const [readyNonce, setReadyNonce] = useState(0);
  const handleRefresh = useCallback(() => {
    onRefresh();
    setReadyNonce((n) => n + 1);
  }, [onRefresh]);
  if (!state) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Pods</h2>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" /> Loading pods…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Pods</h2>
        <div className="flex items-center gap-2">
          <RefreshButton onClick={handleRefresh} />
          <button
            onClick={onAllocate}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
            style={{ background: 'var(--accent-primary)' }}
          >
            + Allocate pod
          </button>
        </div>
      </div>

      {state.agents.length === 0 && state.included.length === 0 && (
        <div
          className="p-6 rounded-lg flex flex-col items-center text-center gap-3"
          style={{
            background: 'var(--bg-card, rgba(255,255,255,0.03))',
            border: '1px dashed var(--border-default)',
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(124,77,255,0.12)',
              border: '1px solid rgba(124,77,255,0.25)',
            }}
          >
            <Box size={18} className="text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">
              No pods yet
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-1 max-w-[280px]">
              Allocate your first pod to start using Tytus. The Agents tab
              has the catalog of available agents.
            </div>
          </div>
          <button
            onClick={onAllocate}
            className="mt-1 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
            style={{ background: 'var(--accent-primary)' }}
          >
            Browse agents →
          </button>
        </div>
      )}

      {state.agents.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Allocated ({state.agents.length})
          </div>
          <div className="space-y-2">
            {state.agents.map((a) => (
              <PodCard key={a.pod_id} agent={a} refreshNonce={readyNonce} />
            ))}
          </div>
        </div>
      )}

      {state.included.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Included ({state.included.length})
          </div>
          <div className="space-y-2">
            {state.included.map((p) => (
              <div
                key={p.pod_id}
                className="p-3 rounded-lg flex items-center gap-3 opacity-80"
                style={{ background: 'var(--bg-card, rgba(255,255,255,0.03))', border: '1px solid var(--border-subtle)' }}
              >
                <Sparkles size={20} className="text-[var(--text-secondary)] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {p.kind.toUpperCase()} · {p.endpoint}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    Free with your account · doesn't count against units
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Pod card — connection details with copy + reveal
// ============================================================

interface PodCardProps {
  agent: import('@/types/daemon').Agent;
  /** Bumped by parent's RefreshButton to re-probe pod readiness. */
  refreshNonce?: number;
}

type ReadyDot = { color: string; label: string } | null;

const PodCard: React.FC<PodCardProps> = ({ agent, refreshNonce = 0 }) => {
  const client = useDaemonClient();
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [uiRevealed, setUiRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [ready, setReady] = useState<ReadyDot>(null);

  // Lazy /api/pod/ready probe. Re-runs when refreshNonce changes
  // (parent's Refresh button) so the dot reflects the latest probe.
  useEffect(() => {
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setReady({ color: '#9E9E9E', label: 'Probing…' });
    client.getPodReady(agent.pod_id).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setReady({ color: '#9E9E9E', label: 'Probe failed' });
        return;
      }
      if (r.value.ready) {
        setReady({ color: '#4CAF50', label: 'Ready' });
      } else {
        setReady({ color: '#FFC107', label: r.value.reason || 'Not ready' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, agent.pod_id, refreshNonce]);

  const copyToClipboard = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
    } catch {
      // Clipboard API can reject in non-secure contexts; ignore — the
      // user can still select+copy from the displayed value.
    }
  }, []);

  const openPod = useCallback(async () => {
    setOpening(true);
    setOpenErr(null);
    const r = await client.postPodOpen(agent.pod_id);
    setOpening(false);
    if (!r.ok) setOpenErr(r.error.message);
  }, [client, agent.pod_id]);

  return (
    <div
      className="p-3 rounded-lg flex flex-col gap-2"
      style={{
        background: 'var(--bg-card, rgba(255,255,255,0.03))',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <Box size={20} className="text-[var(--accent-primary)]" />
          {ready && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full"
              style={{
                background: ready.color,
                boxShadow: '0 0 0 2px var(--bg-card, #1E1E1E)',
              }}
              title={ready.label}
              aria-label={ready.label}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate">
            Pod {agent.pod_id} · {agent.agent_type}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
            {agent.units} unit{agent.units === 1 ? '' : 's'} ·{' '}
            <span style={{ color: ready?.color ?? 'var(--text-secondary)' }}>
              {ready?.label ?? '…'}
            </span>
          </div>
        </div>
        <button
          onClick={openPod}
          disabled={opening}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-60"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          {opening ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <ExternalLink size={11} />
          )}
          Open
        </button>
      </div>

      {openErr && (
        <div className="text-[11px]" style={{ color: '#FFB4A2' }}>
          Couldn't open pod URL: {openErr}
        </div>
      )}

      <div className="grid grid-cols-[80px_1fr_auto] gap-x-2 gap-y-1.5 text-[11px] items-center mt-1">
        <span className="text-[var(--text-secondary)]">API URL</span>
        <code
          className="font-mono text-[var(--text-primary)] truncate"
          style={{ background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: 3 }}
          title={agent.api_url}
        >
          {agent.api_url}
        </code>
        <CopyBtn
          label="api"
          isCopied={copied === 'api'}
          onClick={() => copyToClipboard('api', agent.api_url)}
        />

        <span className="text-[var(--text-secondary)]">Public</span>
        <code
          className="font-mono text-[var(--text-primary)] truncate"
          style={{ background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: 3 }}
          title={agent.public_url}
        >
          {agent.public_url}
        </code>
        <CopyBtn
          label="public"
          isCopied={copied === 'public'}
          onClick={() => copyToClipboard('public', agent.public_url)}
        />

        <span className="text-[var(--text-secondary)]">UI URL</span>
        <code
          className="font-mono text-[var(--text-primary)] truncate"
          style={{ background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: 3 }}
        >
          {uiRevealed
            ? revealTokenUrl(agent.ui_url, 'user_gesture')
            : maskTokenUrl(agent.ui_url)}
        </code>
        <div className="flex items-center gap-1">
          <RevealBtn
            revealed={uiRevealed}
            onToggle={() => setUiRevealed((v) => !v)}
          />
          <CopyBtn
            label="ui"
            isCopied={copied === 'ui'}
            onClick={() =>
              copyToClipboard('ui', revealTokenUrl(agent.ui_url, 'user_gesture'))
            }
          />
        </div>

        <span className="text-[var(--text-secondary)]">Key</span>
        <code
          className="font-mono text-[var(--text-primary)] truncate"
          style={{ background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: 3 }}
        >
          {keyRevealed
            ? revealSecret(agent.user_key, 'user_gesture')
            : maskSecret(agent.user_key)}
        </code>
        <div className="flex items-center gap-1">
          <RevealBtn
            revealed={keyRevealed}
            onToggle={() => setKeyRevealed((v) => !v)}
          />
          <CopyBtn
            label="key"
            isCopied={copied === 'key'}
            onClick={() =>
              copyToClipboard('key', revealSecret(agent.user_key, 'user_gesture'))
            }
          />
        </div>
      </div>
    </div>
  );
};

const RefreshButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  // Local "spinning" flag — useDaemonState.refresh() is fire-and-forget,
  // so we just animate for a fixed window to give the click visible
  // feedback. Default poll is 2s, so 800ms is comfortably under the
  // next natural state update.
  const [spinning, setSpinning] = useState(false);
  const spin = useCallback(() => {
    setSpinning(true);
    onClick();
    setTimeout(() => setSpinning(false), 800);
  }, [onClick]);
  return (
    <button
      onClick={spin}
      aria-label="Refresh"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-colors"
      style={{
        background: 'var(--bg-hover, rgba(255,255,255,0.04))',
        border: '1px solid var(--border-default)',
        color: 'var(--text-secondary)',
      }}
    >
      <RefreshCw size={11} className={spinning ? 'animate-spin' : undefined} />
      Refresh
    </button>
  );
};

const CopyBtn: React.FC<{
  label: string;
  isCopied: boolean;
  onClick: () => void;
}> = ({ label, isCopied, onClick }) => (
  <button
    onClick={onClick}
    aria-label={`Copy ${label}`}
    className="p-1 rounded transition-colors"
    style={{
      background: isCopied ? 'rgba(76,175,80,0.18)' : 'transparent',
      color: isCopied ? '#A5D6A7' : 'var(--text-secondary)',
    }}
  >
    {isCopied ? <Check size={12} /> : <Copy size={12} />}
  </button>
);

const RevealBtn: React.FC<{
  revealed: boolean;
  onToggle: () => void;
}> = ({ revealed, onToggle }) => (
  <button
    onClick={onToggle}
    aria-label={revealed ? 'Hide value' : 'Show value'}
    className="p-1 rounded transition-colors"
    style={{ background: 'transparent', color: 'var(--text-secondary)' }}
  >
    {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
  </button>
);

// ============================================================
// Agents catalog panel
// ============================================================

interface AgentsPanelProps {
  state: import('@/types/daemon').StateSnapshot | null;
  catalog: Catalog | null;
  loading: boolean;
  error: string | null;
  onPick: (agent: CatalogAgent) => void;
  onRetry: () => void;
}

const AgentsPanel: React.FC<AgentsPanelProps> = ({ state, catalog, loading, error, onPick, onRetry }) => {
  const tier = state?.tier ?? 'explorer';
  const unitsRemaining = state ? state.units_limit - state.units_used : 0;
  const userTierRank = TIER_RANK[tier];

  // Count allocated pods per agent_type so the catalog can show
  // "1 running on pod 02" — feedback after a successful install and a
  // hint that the agent can be installed multiple times.
  const allocatedByType = useMemo(() => {
    const map = new Map<string, { count: number; pods: string[] }>();
    if (!state) return map;
    for (const a of state.agents) {
      const entry = map.get(a.agent_type) ?? { count: 0, pods: [] };
      entry.count += 1;
      entry.pods.push(a.pod_id);
      map.set(a.agent_type, entry);
    }
    return map;
  }, [state]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Agents</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Install an agent into a pod. Each install consumes the agent's unit cost.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" /> Loading catalog…
        </div>
      )}

      {error && (
        <div
          className="p-3 rounded-lg flex items-start gap-2 text-xs"
          style={{
            background: 'rgba(244,67,54,0.10)',
            border: '1px solid rgba(244,67,54,0.30)',
            color: '#FFCDD2',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div>Couldn't load catalog: {error}</div>
            <button
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#FFCDD2',
              }}
            >
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        </div>
      )}

      {catalog && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {catalog.agents.map((a) => {
            const tierRank = TIER_RANK[a.min_plan];
            const tierOk = userTierRank >= tierRank;
            const fits = unitsRemaining >= a.units;
            const installable = tierOk && fits;
            const reason = !tierOk
              ? `Requires ${a.min_plan} plan or higher`
              : !fits
                ? `Needs ${a.units} unit${a.units === 1 ? '' : 's'}, only ${unitsRemaining} available`
                : null;
            return (
              <div
                key={a.id}
                className="p-4 rounded-lg flex flex-col gap-3"
                style={{
                  background: 'var(--bg-card, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{a.name}</div>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{a.tagline}</div>
                  </div>
                  <div
                    className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      background: 'rgba(124,77,255,0.12)',
                      color: '#D6C8FF',
                    }}
                  >
                    {a.units} unit{a.units === 1 ? '' : 's'}
                  </div>
                </div>
                {(() => {
                  const allocated = allocatedByType.get(a.id);
                  if (!allocated) return null;
                  return (
                    <div
                      className="text-[10px] px-2 py-1 rounded-md flex items-center gap-1.5 self-start"
                      style={{
                        background: 'rgba(76,175,80,0.10)',
                        border: '1px solid rgba(76,175,80,0.25)',
                        color: '#A5D6A7',
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: '#4CAF50' }}
                      />
                      {allocated.count} running on pod
                      {allocated.count > 1 ? 's' : ''} {allocated.pods.join(', ')}
                    </div>
                  );
                })()}
                <div className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  {a.description}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <div className="text-[10px] text-[var(--text-secondary)]">
                    Min plan: <span className="capitalize">{a.min_plan}</span>
                  </div>
                  <button
                    onClick={() => onPick(a)}
                    disabled={!installable}
                    title={reason ?? undefined}
                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: installable
                        ? 'var(--accent-primary)'
                        : 'var(--bg-hover, rgba(255,255,255,0.04))',
                      color: installable ? 'white' : 'var(--text-secondary)',
                      border: installable
                        ? 'none'
                        : '1px solid var(--border-default)',
                    }}
                  >
                    {installable ? 'Install' : reason}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Install wizard modal — confirm + stream
// ============================================================

interface InstallWizardProps {
  agent: CatalogAgent;
  jobId: string | null;
  submitting: boolean;
  submitErr: string | null;
  jobStreamUrl: string | null;
  onConfirm: () => void;
  onRetry: () => void;
  onSuccess: () => void;
  onClose: () => void;
}

const InstallWizard: React.FC<InstallWizardProps> = ({
  agent,
  jobId,
  submitting,
  submitErr,
  jobStreamUrl,
  onConfirm,
  onRetry,
  onSuccess,
  onClose,
}) => {
  const stream = useJobStream({ url: jobStreamUrl });
  const isStreaming = jobId !== null;
  const isDone = stream.status === 'success' || stream.status === 'failed' || stream.status === 'lost';
  const isInstalling = isStreaming && !isDone;
  const linesRendered = useMemo(
    () => stream.lines.slice(-200).join('\n'),
    [stream.lines],
  );

  // Refresh daemon state once when the install completes successfully.
  // Done lives outside the modal — without this, the new pod wouldn't
  // appear in the Pods panel until the user closed the modal.
  const successFiredRef = useRef(false);
  useEffect(() => {
    if (stream.status === 'success' && !successFiredRef.current) {
      successFiredRef.current = true;
      onSuccess();
    }
  }, [stream.status, onSuccess]);

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-[520px] max-h-[80vh] rounded-xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-window, #1E1E1E)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        }}
      >
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {!isStreaming && `Install ${agent.name}`}
              {isInstalling && `Installing ${agent.name}…`}
              {stream.status === 'success' && `${agent.name} installed`}
              {stream.status === 'failed' && `Install failed`}
              {stream.status === 'lost' && `Stream lost`}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
              {agent.units} unit{agent.units === 1 ? '' : 's'} · min plan {agent.min_plan}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isInstalling}
            className="p-1 rounded-md transition-colors disabled:opacity-30"
            style={{ background: 'transparent', color: 'var(--text-secondary)' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
          {!isStreaming && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                {agent.description}
              </p>
              <div
                className="p-3 rounded-md text-[11px] flex items-start gap-2"
                style={{
                  background: 'rgba(124,77,255,0.08)',
                  border: '1px solid rgba(124,77,255,0.20)',
                  color: '#CFCFCF',
                }}
              >
                <Sparkles size={12} className="flex-shrink-0 mt-0.5" />
                <span>
                  The daemon will pick a free pod slot automatically. Allocation,
                  image pull, and container start typically take 30–90 seconds.
                </span>
              </div>
              {submitErr && (
                <div
                  className="p-3 rounded-md text-xs flex items-start gap-2"
                  style={{
                    background: 'rgba(244,67,54,0.10)',
                    border: '1px solid rgba(244,67,54,0.30)',
                    color: '#FFCDD2',
                  }}
                >
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{submitErr}</span>
                </div>
              )}
            </div>
          )}

          {isStreaming && (
            <div
              className="rounded-md p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
              style={{
                background: '#0A0A0A',
                color: '#A0E0A0',
                minHeight: 200,
                maxHeight: 400,
                overflowY: 'auto',
              }}
            >
              {stream.lines.length === 0 && stream.status === 'subscribing' && (
                <span className="text-[var(--text-secondary)]">Connecting to install stream…</span>
              )}
              {linesRendered}
              {stream.status === 'success' && (
                <div className="mt-2 text-[#A0E0A0]">✓ Install complete</div>
              )}
              {stream.status === 'failed' && (
                <div className="mt-2" style={{ color: '#FF8A80' }}>
                  ✗ Install exited with code {stream.exitCode ?? '?'}
                </div>
              )}
              {stream.status === 'lost' && (
                <div className="mt-2" style={{ color: '#FFB74D' }}>
                  Stream disconnected. Check Settings → Pods to verify.
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {!isStreaming && (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-xs transition-colors"
                style={{
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={submitting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-60"
                style={{ background: 'var(--accent-primary)', color: 'white' }}
              >
                {submitting && <Loader2 size={12} className="animate-spin" />}
                Install
              </button>
            </>
          )}
          {isInstalling && (
            <span className="text-[11px] text-[var(--text-secondary)]">
              Cancel disabled while install runs.
            </span>
          )}
          {isDone && (stream.status === 'failed' || stream.status === 'lost') && (
            <button
              onClick={onRetry}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
              }}
            >
              Retry
            </button>
          )}
          {isDone && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors"
              style={{ background: 'var(--accent-primary)' }}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Sign-out confirmation modal
// ============================================================

interface SignOutConfirmProps {
  podCount: number;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const SignOutConfirm: React.FC<SignOutConfirmProps> = ({
  podCount,
  submitting,
  onConfirm,
  onCancel,
}) => (
  <div
    className="fixed inset-0 z-[6000] flex items-center justify-center"
    style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
  >
    <div
      className="w-[440px] rounded-xl flex flex-col overflow-hidden"
      style={{
        background: 'var(--bg-window, #1E1E1E)',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
      }}
    >
      <div className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: 'rgba(244,67,54,0.12)',
            border: '1px solid rgba(244,67,54,0.30)',
          }}
        >
          <AlertTriangle size={18} style={{ color: '#F44336' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Sign out of Tytus?
          </div>
          <div className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            Signing out{' '}
            <strong style={{ color: '#FFCDD2' }}>
              revokes all pod allocations
            </strong>
            {podCount > 0 ? (
              <>
                {' '}— including {podCount} pod{podCount === 1 ? '' : 's'}{' '}
                you have running. Workspace data on those pods will be
                permanently lost.
              </>
            ) : (
              <> on this account.</>
            )}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-2">
            You can always sign in again from the Tytus tray menu.
          </div>
        </div>
      </div>

      <div
        className="px-5 py-3 flex items-center justify-end gap-2"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={submitting}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-60"
          style={{
            background: '#D32F2F',
            color: 'white',
          }}
        >
          {submitting && <Loader2 size={12} className="animate-spin" />}
          Sign out and revoke pods
        </button>
      </div>
    </div>
  </div>
);

export default Settings;
