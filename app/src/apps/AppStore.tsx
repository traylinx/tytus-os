import { type FC, useEffect, useState, useMemo } from 'react';
import { Store, Search, CheckCircle2, Download, ExternalLink, Package, Loader2, AlertCircle } from 'lucide-react';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useWindows } from '@/hooks/useOSStore';
import type { StoreApp } from '@/types/daemon';
import { TytusAppsTab } from './TytusAppsTab';

const CATEGORIES = ['All', 'Developer Tools', 'AI & ML', 'Communication'] as const;

type ActiveTab = 'tytus' | 'desktop';

const AppStore: FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('tytus');
  const { openWindow } = useWindows();

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-window)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 shrink-0"
        style={{ height: 48, background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
      >
        <Store size={18} style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>App Store</span>
      </div>

      {/* Top-level tabs (per D28) */}
      <div
        className="flex items-center gap-0 px-4 shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <TabButton
          label="Tytus Apps"
          active={activeTab === 'tytus'}
          onClick={() => setActiveTab('tytus')}
          testId="appstore-tab-tytus"
        />
        <TabButton
          label="Desktop"
          active={activeTab === 'desktop'}
          onClick={() => setActiveTab('desktop')}
          testId="appstore-tab-desktop"
        />
      </div>

      {/* Active tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'tytus' ? (
          <TytusAppsTab onOpen={(appId) => openWindow(appId)} />
        ) : (
          <DesktopAppsTab />
        )}
      </div>
    </div>
  );
};

const TabButton: FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}> = ({ label, active, onClick, testId }) => (
  <button
    data-testid={testId}
    onClick={onClick}
    className="px-3 py-2 transition-colors"
    style={{
      fontSize: 13,
      fontWeight: 500,
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      background: 'transparent',
      border: 'none',
      borderBottom: '2px solid ' + (active ? 'var(--accent-primary)' : 'transparent'),
      cursor: 'pointer',
    }}
  >
    {label}
  </button>
);

/** "Desktop" tab — daemon-backed brew/curl-installable catalog. The
 *  pre-D28 AppStore content lives here intact; the rewrite kept this
 *  surface unchanged so existing users see no functional regression. */
const DesktopAppsTab: FC = () => {
  const client = useDaemonClient();
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [checkResults, setCheckResults] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const r = await client.getStoreApps();
      if (cancelled) return;
      if (r.ok) {
        setApps(r.value);
        setChecking(true);
        const ids = r.value.map((a) => a.id);
        const c = await client.postStoreAppsCheck(ids);
        if (cancelled) return;
        if (c.ok) {
          const map: Record<string, boolean> = {};
          for (const res of c.value.results) {
            map[res.id] = res.installed;
          }
          setCheckResults(map);
        }
        setChecking(false);
      } else {
        setError(r.error.message);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [client]);

  const filtered = useMemo(() => {
    let list = apps;
    if (activeCategory !== 'All') {
      list = list.filter((a) => a.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q),
      );
    }
    return list;
  }, [apps, activeCategory, search]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" data-testid="appstore-desktop-loading">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading app catalog…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <AlertCircle size={28} style={{ color: 'var(--accent-error)' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Failed to load catalog: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search + Categories */}
      <div className="px-4 pt-3 pb-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-3 rounded-input" style={{ background: 'var(--bg-input)', padding: '6px 10px', border: '1px solid var(--border-default)' }}>
          <Search size={14} style={{ color: 'var(--text-disabled)' }} />
          <input
            type="text"
            placeholder="Search apps…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent outline-none flex-1 rounded-input"
            style={{ fontSize: 13, color: 'var(--text-primary)' }}
          />
          {checking && (
            <span className="flex items-center gap-1" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              <Loader2 size={12} className="animate-spin" /> Checking…
            </span>
          )}
        </div>
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="px-3 py-1 rounded-full transition-colors"
              style={{
                fontSize: 12,
                fontWeight: 500,
                background: activeCategory === cat ? 'var(--accent-primary)' : 'var(--bg-chrome)',
                color: activeCategory === cat ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                border: '1px solid ' + (activeCategory === cat ? 'var(--accent-primary)' : 'var(--border-subtle)'),
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* App Grid */}
      <div className="flex-1 overflow-auto p-4 custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Package size={32} style={{ color: 'var(--text-disabled)' }} />
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No apps found</span>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {filtered.map((app) => (
              <AppCard key={app.id} app={app} installed={checkResults[app.id] ?? false} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const AppCard: FC<{ app: StoreApp; installed: boolean }> = ({ app, installed }) => {
  const platform = navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'linux';
  const installCmd = app.install[platform] ?? Object.values(app.install)[0] ?? '';

  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-lg transition-colors"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{ width: 40, height: 40, background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
        >
          <Package size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{app.name}</span>
            {installed ? (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                style={{ fontSize: 10, fontWeight: 600, background: 'rgba(76,175,80,0.15)', color: 'var(--accent-success)' }}
              >
                <CheckCircle2 size={10} /> Installed
              </span>
            ) : (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                style={{ fontSize: 10, fontWeight: 600, background: 'rgba(124,77,255,0.10)', color: 'var(--accent-primary)' }}
              >
                <Download size={10} /> Available
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{app.category}</span>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {app.description}
      </p>

      {installCmd && !installed && (
        <div
          className="px-2 py-1.5 rounded-md"
          style={{ background: 'var(--bg-input)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-primary)', wordBreak: 'break-all' }}
        >
          {installCmd}
        </div>
      )}

      <div className="flex gap-2 mt-auto">
        {installed ? (
          <span
            className="flex items-center gap-1 px-3 py-1.5 rounded-md"
            style={{ fontSize: 12, fontWeight: 500, background: 'rgba(76,175,80,0.15)', color: 'var(--accent-success)', border: '1px solid rgba(76,175,80,0.3)' }}
          >
            <CheckCircle2 size={13} /> Installed on your machine
          </span>
        ) : (
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90"
            style={{ fontSize: 12, fontWeight: 600, background: 'var(--accent-primary)', color: 'var(--text-on-accent)', textDecoration: 'none' }}
          >
            <ExternalLink size={13} /> Get {app.name}
          </a>
        )}
      </div>
    </div>
  );
};

export default AppStore;
