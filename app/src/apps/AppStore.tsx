import { type FC, useEffect, useState, useMemo } from 'react';
import { Store, Search, CheckCircle2, Download, Package, Loader2, AlertCircle, AppWindow, BookOpen } from 'lucide-react';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useWindows } from '@/hooks/useOSStore';
import type { StoreApp } from '@/types/daemon';
import { BRAND_LOGOS } from './brandLogos';
import { TytusAppsTab } from './TytusAppsTab';
import { useI18n } from '@/i18n';

const CATEGORIES = ['All', 'Developer Tools', 'AI & ML', 'Communication'] as const;

type ActiveTab = 'tytus' | 'desktop';

const AppStore: FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('tytus');
  const { openWindow } = useWindows();
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-window)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 shrink-0"
        style={{ height: 48, background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
      >
        <Store size={18} style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t('appStore.title')}</span>
      </div>

      {/* Top-level tabs (per D28) */}
      <div
        className="flex items-center gap-0 px-4 shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <TabButton
          label={t('appStore.tabs.tytus')}
          active={activeTab === 'tytus'}
          onClick={() => setActiveTab('tytus')}
          testId="appstore-tab-tytus"
        />
        <TabButton
          label={t('appStore.tabs.desktop')}
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
  const { t } = useI18n();
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [checkResults, setCheckResults] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [openingAll, setOpeningAll] = useState(false);
  const [openAllMsg, setOpenAllMsg] = useState<string | null>(null);

  const installedCount = useMemo(
    () => Object.values(checkResults).filter(Boolean).length,
    [checkResults],
  );

  const handleOpenAll = async () => {
    setOpeningAll(true);
    setOpenAllMsg(null);
    const r = await client.postAppsOpenAll();
    setOpeningAll(false);
    if (r.ok) {
      const n = r.value.opened.length;
      setOpenAllMsg(
        n === 0
          ? t('appStore.desktop.openAll.none')
          : t('appStore.desktop.openAll.opened', {
              count: n,
              apps: r.value.opened.join(', '),
            }),
      );
    } else {
      setOpenAllMsg(t('appStore.desktop.openAll.failed', { error: r.error.message }));
    }
  };

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
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('appStore.desktop.loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <AlertCircle size={28} style={{ color: 'var(--accent-error)' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('appStore.desktop.loadFailed', { error })}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search + Categories */}
      <div className="px-4 pt-3 pb-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 rounded-input" style={{ background: 'var(--bg-input)', padding: '6px 10px', border: '1px solid var(--border-default)' }}>
            <Search size={14} style={{ color: 'var(--text-disabled)' }} />
            <input
              type="text"
              placeholder={t('appStore.desktop.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent outline-none flex-1 rounded-input"
              style={{ fontSize: 13, color: 'var(--text-primary)' }}
            />
            {checking && (
              <span className="flex items-center gap-1" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                <Loader2 size={12} className="animate-spin" /> {t('appStore.desktop.checking')}
              </span>
            )}
          </div>
          <button
            data-testid="appstore-open-all"
            onClick={handleOpenAll}
            disabled={openingAll || checking || installedCount === 0}
            title={installedCount === 0
              ? t('appStore.desktop.openAll.noInstalledTitle')
              : t('appStore.desktop.openAll.title', { count: installedCount })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90 shrink-0"
            style={{
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--accent-primary)',
              color: 'var(--text-on-accent)',
              border: 'none',
              cursor: openingAll || checking || installedCount === 0 ? 'not-allowed' : 'pointer',
              opacity: openingAll || checking || installedCount === 0 ? 0.5 : 1,
            }}
          >
            {openingAll ? <Loader2 size={13} className="animate-spin" /> : <AppWindow size={13} />}
            {t('appStore.desktop.openAll.button')}
          </button>
        </div>
        {openAllMsg && (
          <div className="mb-2" style={{ fontSize: 11, color: 'var(--text-secondary)' }} data-testid="appstore-open-all-msg">
            {openAllMsg}
          </div>
        )}
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
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('appStore.desktop.noAppsFound')}</span>
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
  const client = useDaemonClient();
  const { t } = useI18n();
  const platform = navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'linux';
  const installCmd = app.install[platform] ?? Object.values(app.install)[0] ?? '';
  const docsUrl = app.docs ?? app.url;
  const [busy, setBusy] = useState<null | 'open' | 'install'>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const handleOpen = async () => {
    setBusy('open');
    setFeedback(null);
    const r = await client.postAppOpen(app.id);
    setBusy(null);
    setFeedback(
      r.ok
        ? { kind: 'ok', text: `Opening ${app.name}…` }
        : { kind: 'err', text: r.error.message },
    );
  };

  const handleInstall = async () => {
    setBusy('install');
    setFeedback(null);
    const r = await client.postAppInstall(app.id);
    setBusy(null);
    if (r.ok) {
      setFeedback({
        kind: 'ok',
        text:
          r.value.action === 'opened_url'
            ? `Opened ${app.name} website for install instructions`
            : t('appStore.card.install.runningTerminal'),
      });
    } else {
      setFeedback({ kind: 'err', text: r.error.message });
    }
  };

  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-lg transition-colors"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-start gap-3">
        {(() => {
          const logo = BRAND_LOGOS[app.id];
          return logo ? (
            <div
              className="flex items-center justify-center rounded-lg shrink-0"
              style={{ width: 40, height: 40, background: logo.hex }}
              data-testid={`appcard-logo-${app.id}`}
            >
              <svg width={22} height={22} viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                <path d={logo.path} />
              </svg>
            </div>
          ) : (
            <div
              className="flex items-center justify-center rounded-lg shrink-0"
              style={{ width: 40, height: 40, background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
              data-testid={`appcard-icon-${app.id}`}
            >
              <Package size={20} />
            </div>
          );
        })()}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{app.name}</span>
            {installed ? (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                style={{ fontSize: 10, fontWeight: 600, background: 'rgba(76,175,80,0.15)', color: 'var(--accent-success)' }}
              >
                <CheckCircle2 size={10} /> {t('appStore.card.installed')}
              </span>
            ) : (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                style={{ fontSize: 10, fontWeight: 600, background: 'rgba(124,77,255,0.10)', color: 'var(--accent-primary)' }}
              >
                <Download size={10} /> {t('appStore.card.available')}
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

      <div className="flex gap-2 mt-auto items-center flex-wrap">
        {installed ? (
          <button
            data-testid={`appcard-open-${app.id}`}
            onClick={handleOpen}
            disabled={busy !== null}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90"
            style={{ fontSize: 12, fontWeight: 600, background: 'var(--accent-primary)', color: 'var(--text-on-accent)', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy === 'open' ? 0.6 : 1 }}
          >
            {busy === 'open' ? <Loader2 size={13} className="animate-spin" /> : <AppWindow size={13} />} {t('common.open')}
          </button>
        ) : (
          <button
            data-testid={`appcard-install-${app.id}`}
            onClick={handleInstall}
            disabled={busy !== null}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90"
            style={{ fontSize: 12, fontWeight: 600, background: 'var(--accent-primary)', color: 'var(--text-on-accent)', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy === 'install' ? 0.6 : 1 }}
          >
            {busy === 'install' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {t('common.install')}
          </button>
        )}
        <a
          data-testid={`appcard-docs-${app.id}`}
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors"
          style={{ fontSize: 12, fontWeight: 500, background: 'var(--bg-chrome)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', textDecoration: 'none' }}
        >
          <BookOpen size={13} /> {t('common.docs')}
        </a>
        {installed && (
          <span
            className="flex items-center gap-1 px-2 py-1 rounded-md"
            style={{ fontSize: 11, fontWeight: 500, background: 'rgba(76,175,80,0.12)', color: 'var(--accent-success)' }}
          >
            <CheckCircle2 size={12} /> {t('appStore.card.installed')}
          </span>
        )}
      </div>
      {feedback && (
        <span
          data-testid={`appcard-feedback-${app.id}`}
          style={{ fontSize: 11, color: feedback.kind === 'ok' ? 'var(--accent-success)' : 'var(--accent-error)' }}
        >
          {feedback.text}
        </span>
      )}
    </div>
  );
};

export default AppStore;
