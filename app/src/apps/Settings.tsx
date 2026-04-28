// ============================================================
// System Settings — Full system preferences panel
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  Wifi, Bluetooth, Image, Palette, Bell, Volume2, Battery,
  Monitor, Mouse, Keyboard, Printer, Disc, Clock, User,
  Star, Eye, Info, Search, Check,
  Server, LogOut, Power, Loader2,
} from 'lucide-react';
import { useOS } from '@/hooks/useOSStore';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { computePill } from '@/lib/statusPill';
import type { DaemonSettings } from '@/types/daemon';

interface SettingCategory {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const CATEGORIES: SettingCategory[] = [
  { id: 'account', label: 'Account', icon: <User size={18} /> },
  { id: 'daemon', label: 'Daemon', icon: <Server size={18} /> },
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

const Settings: React.FC = () => {
  const { state, dispatch } = useOS();
  const [activeCategory, setActiveCategory] = useState('account');
  const [search, setSearch] = useState('');
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const pill = computePill(daemon.status, daemon.state, daemon.error);

  const [daemonSettings, setDaemonSettings] = useState<DaemonSettings | null>(null);
  const [daemonSettingsErr, setDaemonSettingsErr] = useState<string | null>(null);
  const [pendingSetting, setPendingSetting] = useState<keyof DaemonSettings | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [lifecycleErr, setLifecycleErr] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutErr, setSignOutErr] = useState<string | null>(null);

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

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setSignOutErr(null);
    const r = await client.postLogout();
    setSigningOut(false);
    if (!r.ok) {
      setSignOutErr(r.error.message);
      return;
    }
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

  const filteredCategories = search
    ? CATEGORIES.filter(c => c.label.toLowerCase().includes(search.toLowerCase()))
    : CATEGORIES;

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
                onClick={signOut}
                disabled={signingOut || !daemon.state?.logged_in}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50"
                style={{
                  background: 'rgba(244,67,54,0.10)',
                  border: '1px solid rgba(244,67,54,0.30)',
                  color: '#FFCDD2',
                }}
              >
                {signingOut ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <LogOut size={14} />
                )}
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
              {CATEGORIES.find(c => c.id === activeCategory)?.label}
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
          {filteredCategories.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setActiveCategory(cat.id); setSearch(''); }}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-sm transition-colors"
              style={{
                background: activeCategory === cat.id ? 'var(--bg-selected)' : 'transparent',
                color: activeCategory === cat.id ? 'var(--accent-primary)' : 'var(--text-primary)',
                borderLeft: activeCategory === cat.id ? '3px solid var(--accent-primary)' : '3px solid transparent',
              }}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        {renderPanel()}
      </div>
    </div>
  );
};

export default Settings;
