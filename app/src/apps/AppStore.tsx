import {
  type CSSProperties,
  type FC,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  AppWindow,
  BookOpen,
  Bot,
  Box,
  Building2,
  Code2,
  FileCode,
  FileText,
  Headphones,
  Image,
  MessageCircle,
  Mic,
  Music,
  Plug,
  Terminal,
  CheckCircle2,
  Download,
  Loader2,
  Package,
  Search,
  Sparkles,
  Store,
  X,
} from 'lucide-react';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useWindows } from '@/hooks/useOSStore';
import { getDb } from '@/lib/db';
import {
  listInstalledApps,
  type InstalledAppRow,
} from '@/runtime/installed-apps-repo';
import {
  InstallerError,
  installAppFromManifestUrl,
  reinstallApp,
  uninstallApp,
} from '@/runtime/installer';
import type { StoreApp, StoreAppCheckResult, StoreAppLlmStatus } from '@/types/daemon';
import { useI18n } from '@/i18n';
import { BRAND_LOGOS } from './brandLogos';
import { getExternalAppLogo } from './externalAppLogos';
import { FEATURED_APPS, type FeaturedApp, loadFeaturedApps } from './featured-apps-catalog';
import { isHiddenLegacyApp } from './product-replacements';
import { BrandIcon, isBrandIconName } from '@/components/BrandIcon';

type SourceFilter = 'all' | 'desktop' | 'tytus' | 'installed' | 'available';

type TytusAppKind = 'system' | 'bundled' | 'installed' | 'featured';

type UnifiedApp =
  | { source: 'desktop'; key: string; app: StoreApp; check?: StoreAppCheckResult }
  | { source: 'tytus'; key: string; kind: Exclude<TytusAppKind, 'featured'>; row: InstalledAppRow }
  | { source: 'tytus'; key: string; kind: 'featured'; featured: FeaturedApp };

interface AppStoreProps {
  loadInstalledApps?: () => Promise<InstalledAppRow[]>;
  onInstallFromUrl?: (manifestUrl: string) => Promise<InstalledAppRow>;
  onUninstall?: (appId: string) => Promise<void>;
  onReinstall?: (appId: string) => Promise<InstalledAppRow>;
  loadFeatured?: () => Promise<FeaturedApp[]>;
}

function normalizeCategory(category: string | undefined): string {
  if (!category) return 'AI & ML';
  if (category === 'DevTools') return 'Developer Tools';
  return category;
}

function getTytusRowKind(row: InstalledAppRow): Exclude<TytusAppKind, 'featured'> {
  if (row.kind === 'installed') return 'installed';
  if (row.kind === 'bundled' && row.builtinProtected) return 'system';
  return 'bundled';
}

function installerErrorText(t: (key: string, params?: Record<string, string | number>) => string, err: unknown): string {
  if (err instanceof InstallerError) {
    return t(`appStore.error.${err.code}`);
  }
  return err instanceof Error ? err.message : t('appStore.error.unexpected');
}

const AppStore: FC<AppStoreProps> = ({
  loadInstalledApps,
  onInstallFromUrl,
  onUninstall,
  onReinstall,
  loadFeatured,
}) => {
  const client = useDaemonClient();
  const { openWindow } = useWindows();
  const { t } = useI18n();

  const [desktopApps, setDesktopApps] = useState<StoreApp[]>([]);
  const [checkResults, setCheckResults] = useState<Record<string, StoreAppCheckResult>>({});
  const [desktopLoading, setDesktopLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [openingAll, setOpeningAll] = useState(false);
  const [openAllMsg, setOpenAllMsg] = useState<string | null>(null);

  const [tytusRows, setTytusRows] = useState<InstalledAppRow[]>([]);
  const [featured, setFeatured] = useState<FeaturedApp[]>(FEATURED_APPS);
  const [tytusLoading, setTytusLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyTytusId, setBusyTytusId] = useState<string | null>(null);
  const [pendingConfirmId, setPendingConfirmId] = useState<string | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [tytusFeedback, setTytusFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  const refreshInstallChecks = useCallback(async (ids: string[], options?: { silent?: boolean }) => {
    if (ids.length === 0) return;
    if (!options?.silent) setChecking(true);
    try {
      const c = await client.postStoreAppsCheck(ids);
      if (c.ok) {
        const map: Record<string, StoreAppCheckResult> = {};
        for (const res of c.value.results) map[res.id] = res;
        setCheckResults((prev) => ({ ...prev, ...map }));
      }
    } finally {
      if (!options?.silent) setChecking(false);
    }
  }, [client]);

  const refreshTytusApps = useCallback(() => setReloadKey((n) => n + 1), []);

  const doInstall = useCallback(async (manifestUrl: string): Promise<InstalledAppRow> => {
    if (onInstallFromUrl) return onInstallFromUrl(manifestUrl);
    const db = getDb();
    if (!db) throw new InstallerError('fetch_failed', { reason: 'db not initialized' });
    try {
      return await installAppFromManifestUrl({ manifestUrl, db });
    } catch (err) {
      if (err instanceof InstallerError && err.code === 'duplicate') {
        const existingId = (err.details as { existingId?: string } | undefined)?.existingId;
        if (existingId) {
          await uninstallApp({ appId: existingId, db });
          return installAppFromManifestUrl({ manifestUrl, db });
        }
      }
      throw err;
    }
  }, [onInstallFromUrl]);

  const doUninstall = useCallback(async (appId: string): Promise<void> => {
    if (onUninstall) return onUninstall(appId);
    const db = getDb();
    if (!db) throw new InstallerError('not_found', { id: appId, reason: 'db not initialized' });
    return uninstallApp({ appId, db });
  }, [onUninstall]);

  const doReinstall = useCallback(async (appId: string): Promise<InstalledAppRow> => {
    if (onReinstall) return onReinstall(appId);
    const db = getDb();
    if (!db) throw new InstallerError('not_found', { id: appId, reason: 'db not initialized' });
    return reinstallApp({ appId, db });
  }, [onReinstall]);

  useEffect(() => {
    let cancelled = false;
    const loadDesktop = async () => {
      setDesktopLoading(true);
      setDesktopError(null);
      const r = await client.getStoreApps();
      if (cancelled) return;
      if (r.ok) {
        setDesktopApps(r.value);
        const ids = r.value.map((a) => a.id);
        const c = await client.postStoreAppsCheck(ids);
        if (cancelled) return;
        if (c.ok) {
          const map: Record<string, StoreAppCheckResult> = {};
          for (const res of c.value.results) map[res.id] = res;
          setCheckResults(map);
        }
      } else {
        setDesktopError(r.error.message);
      }
      setDesktopLoading(false);
    };
    void loadDesktop();
    return () => { cancelled = true; };
  }, [client]);

  useEffect(() => {
    const ids = desktopApps.map((a) => a.id);
    if (ids.length === 0) return;
    const refreshAll = () => void refreshInstallChecks(ids, { silent: true });
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };
    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const interval = window.setInterval(refreshAll, 10_000);
    return () => {
      window.removeEventListener('focus', refreshAll);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [desktopApps, refreshInstallChecks]);

  useEffect(() => {
    let cancelled = false;
    const loadTytus = async () => {
      setTytusLoading(true);
      try {
        const [rows, catalog] = await Promise.all([
          loadInstalledApps
            ? loadInstalledApps()
            : (async () => {
                const db = getDb();
                return db ? listInstalledApps(db) : [];
              })(),
          (loadFeatured ?? loadFeaturedApps)(),
        ]);
        if (cancelled) return;
        setTytusRows(rows.filter((r) => !isHiddenLegacyApp(r.id)));
        setFeatured(catalog);
      } catch {
        if (!cancelled) {
          setTytusRows([]);
          setFeatured(FEATURED_APPS);
        }
      } finally {
        if (!cancelled) setTytusLoading(false);
      }
    };
    void loadTytus();
    return () => { cancelled = true; };
  }, [loadInstalledApps, loadFeatured, reloadKey]);

  const installedDesktopCount = useMemo(
    () => Object.values(checkResults).filter((r) => r.installed && r.status !== 'installed_broken').length,
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
          : t('appStore.desktop.openAll.opened', { count: n, apps: r.value.opened.join(', ') }),
      );
    } else {
      setOpenAllMsg(t('appStore.desktop.openAll.failed', { error: r.error.message }));
    }
  };

  const handleTytusInstall = async (manifestUrl: string, name?: string) => {
    const busyKey = name ? `featured:${name}` : 'install-url';
    setBusyTytusId(busyKey);
    setTytusFeedback(null);
    try {
      const row = await doInstall(manifestUrl);
      setTytusFeedback({ kind: 'ok', text: t('appStore.action.installed', { name: row.manifest.name }) });
      setInstallModalOpen(false);
      refreshTytusApps();
    } catch (err) {
      setTytusFeedback({ kind: 'err', text: t('appStore.unified.actionFailed', { error: installerErrorText(t, err) }) });
    } finally {
      setBusyTytusId(null);
    }
  };

  const handleTytusUninstall = async (row: InstalledAppRow) => {
    if (pendingConfirmId !== row.id) {
      setPendingConfirmId(row.id);
      return;
    }
    setBusyTytusId(row.id);
    setTytusFeedback(null);
    try {
      await doUninstall(row.id);
      setTytusFeedback({ kind: 'ok', text: t('appStore.action.uninstalled', { name: row.manifest.name }) });
      setPendingConfirmId(null);
      refreshTytusApps();
    } catch (err) {
      setTytusFeedback({ kind: 'err', text: t('appStore.unified.actionFailed', { error: installerErrorText(t, err) }) });
    } finally {
      setBusyTytusId(null);
    }
  };

  const handleTytusReinstall = async (row: InstalledAppRow) => {
    setBusyTytusId(row.id);
    setTytusFeedback(null);
    try {
      await doReinstall(row.id);
      setTytusFeedback({ kind: 'ok', text: t('appStore.action.reinstalled', { name: row.manifest.name }) });
      refreshTytusApps();
    } catch (err) {
      setTytusFeedback({ kind: 'err', text: t('appStore.unified.actionFailed', { error: installerErrorText(t, err) }) });
    } finally {
      setBusyTytusId(null);
    }
  };

  const unifiedApps = useMemo<UnifiedApp[]>(() => {
    const desktop: UnifiedApp[] = desktopApps.map((app) => ({ source: 'desktop', key: `desktop:${app.id}`, app, check: checkResults[app.id] }));
    const installedIds = new Set(tytusRows.map((r) => r.id));
    const tytusInstalled: UnifiedApp[] = tytusRows.map((row) => ({ source: 'tytus', key: `tytus:${row.id}`, kind: getTytusRowKind(row), row }));
    const tytusFeatured: UnifiedApp[] = featured
      .filter((app) => !installedIds.has(app.id) && !isHiddenLegacyApp(app.id))
      .map((app) => ({ source: 'tytus', key: `featured:${app.id}`, kind: 'featured', featured: app }));
    return [...desktop, ...tytusInstalled, ...tytusFeatured];
  }, [desktopApps, checkResults, tytusRows, featured]);

  const categoryFilters = useMemo(() => {
    const categories = Array.from(new Set(unifiedApps.map((item) => normalizeCategory(getUnifiedMeta(item).category))));
    categories.sort((a, b) => a.localeCompare(b));
    return ['All', ...categories];
  }, [unifiedApps]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return unifiedApps.filter((item) => {
      const meta = getUnifiedMeta(item);
      if (sourceFilter === 'desktop' && item.source !== 'desktop') return false;
      if (sourceFilter === 'tytus' && item.source !== 'tytus') return false;
      if (sourceFilter === 'installed' && !meta.installed) return false;
      if (sourceFilter === 'available' && meta.installed) return false;
      if (categoryFilter !== 'All' && normalizeCategory(meta.category) !== categoryFilter) return false;
      if (!q) return true;
      return [meta.name, meta.description, meta.category, item.source].join(' ').toLowerCase().includes(q);
    });
  }, [unifiedApps, search, sourceFilter, categoryFilter]);

  const loading = desktopLoading && tytusLoading;
  const sourceFilters: Array<{ id: SourceFilter; label: string }> = [
    { id: 'all', label: t('appStore.filters.all') },
    { id: 'desktop', label: t('appStore.filters.desktop') },
    { id: 'tytus', label: t('appStore.filters.tytus') },
    { id: 'installed', label: t('appStore.filters.installed') },
    { id: 'available', label: t('appStore.filters.available') },
  ];

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-window)' }}>
      <div
        className="flex items-center gap-3 px-4 shrink-0"
        style={{ height: 48, background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
      >
        <Store size={18} style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t('appStore.title')}</span>
      </div>

      <div className="px-4 pt-3 pb-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 rounded-input" style={{ background: 'var(--bg-input)', padding: '6px 10px', border: '1px solid var(--border-default)' }}>
            <Search size={14} style={{ color: 'var(--text-disabled)' }} />
            <input
              type="text"
              placeholder={t('appStore.unified.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent outline-none flex-1 rounded-input"
              style={{ fontSize: 13, color: 'var(--text-primary)' }}
            />
            {(checking || tytusLoading) && (
              <span className="flex items-center gap-1" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                <Loader2 size={12} className="animate-spin" /> {t('appStore.desktop.checking')}
              </span>
            )}
          </div>
          <button
            data-testid="tytus-apps-install-from-url"
            onClick={() => setInstallModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90 shrink-0"
            style={{ fontSize: 12, fontWeight: 600, background: 'var(--bg-chrome)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
          >
            <Download size={13} /> {t('tytusApps.installFromUrl.button')}
          </button>
          <button
            data-testid="appstore-open-all"
            onClick={handleOpenAll}
            disabled={openingAll || checking || installedDesktopCount === 0}
            title={installedDesktopCount === 0 ? t('appStore.desktop.openAll.noInstalledTitle') : t('appStore.desktop.openAll.title', { count: installedDesktopCount })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90 shrink-0"
            style={{
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--accent-primary)',
              color: 'var(--text-on-accent)',
              border: 'none',
              cursor: openingAll || checking || installedDesktopCount === 0 ? 'not-allowed' : 'pointer',
              opacity: openingAll || checking || installedDesktopCount === 0 ? 0.5 : 1,
            }}
          >
            {openingAll ? <Loader2 size={13} className="animate-spin" /> : <AppWindow size={13} />}
            {t('appStore.desktop.openAll.button')}
          </button>
        </div>

        {(openAllMsg || tytusFeedback || desktopError) && (
          <div className="mb-2 flex flex-col gap-1" style={{ fontSize: 11 }}>
            {openAllMsg && <span data-testid="appstore-open-all-msg" style={{ color: 'var(--text-secondary)' }}>{openAllMsg}</span>}
            {tytusFeedback && <span style={{ color: tytusFeedback.kind === 'ok' ? 'var(--accent-success)' : 'var(--accent-error)' }}>{tytusFeedback.text}</span>}
            {desktopError && <span style={{ color: 'var(--accent-warning)' }}>{t('appStore.desktop.loadFailed', { error: desktopError })}</span>}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {sourceFilters.map((filter) => (
            <FilterButton
              key={filter.id}
              label={filter.label}
              active={sourceFilter === filter.id}
              onClick={() => setSourceFilter(filter.id)}
              testId={`appstore-filter-${filter.id}`}
            />
          ))}
          <span style={{ width: 1, background: 'var(--border-subtle)', margin: '0 2px' }} />
          {categoryFilters.map((cat) => (
            <FilterButton
              key={cat}
              label={cat === 'All' ? t('appStore.filters.all') : cat}
              active={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 custom-scrollbar">
        {loading ? (
          <div className="h-full flex items-center justify-center" data-testid="appstore-desktop-loading">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('appStore.unified.loading')}</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Package size={32} style={{ color: 'var(--text-disabled)' }} />
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('appStore.unified.noAppsFound')}</span>
          </div>
        ) : (
          <div data-testid="appstore-unified-grid" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {filtered.map((item) => item.source === 'desktop' ? (
              <DesktopAppCard
                key={item.key}
                app={item.app}
                check={item.check}
                onRefreshCheck={() => refreshInstallChecks([item.app.id])}
              />
            ) : item.kind === 'featured' ? (
              <TytusFeaturedCard
                key={item.key}
                featured={item.featured}
                busy={busyTytusId === `featured:${item.featured.name}`}
                onInstall={() => handleTytusInstall(item.featured.manifestUrl, item.featured.name)}
              />
            ) : (
              <TytusInstalledCard
                key={item.key}
                row={item.row}
                kind={item.kind}
                busy={busyTytusId === item.row.id}
                confirming={pendingConfirmId === item.row.id}
                onOpen={() => openWindow(item.row.id)}
                onUninstall={() => handleTytusUninstall(item.row)}
                onReinstall={() => handleTytusReinstall(item.row)}
              />
            ))}
          </div>
        )}
      </div>

      {installModalOpen && (
        <InstallFromUrlModal
          busy={busyTytusId === 'install-url'}
          onClose={() => setInstallModalOpen(false)}
          onInstall={(url) => handleTytusInstall(url)}
        />
      )}
    </div>
  );
};

function getUnifiedMeta(item: UnifiedApp): { name: string; description: string; category: string; installed: boolean } {
  if (item.source === 'desktop') {
    return {
      name: item.app.name,
      description: item.app.description,
      category: item.app.category,
      installed: item.check?.installed === true && item.check?.status !== 'installed_broken',
    };
  }
  if (item.kind === 'featured') {
    return {
      name: item.featured.name,
      description: item.featured.description,
      category: item.featured.category,
      installed: false,
    };
  }
  return {
    name: item.row.manifest.name,
    description: item.row.manifest.description ?? '',
    category: item.row.manifest.category ?? 'Tytus OS',
    installed: true,
  };
}

const FilterButton: FC<{ label: string; active: boolean; onClick: () => void; testId?: string }> = ({ label, active, onClick, testId }) => (
  <button
    data-testid={testId}
    onClick={onClick}
    className="px-3 py-1 rounded-full transition-colors"
    style={{
      fontSize: 12,
      fontWeight: 500,
      background: active ? 'var(--accent-primary)' : 'var(--bg-chrome)',
      color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
      border: '1px solid ' + (active ? 'var(--accent-primary)' : 'var(--border-subtle)'),
      cursor: 'pointer',
    }}
  >
    {label}
  </button>
);

const CardShell: FC<{ testId?: string; children: ReactNode }> = ({ testId, children }) => (
  <div
    data-testid={testId}
    className="flex flex-col gap-3 p-4 rounded-lg transition-colors"
    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
  >
    {children}
  </div>
);

const SourceBadge: FC<{ source: 'desktop' | 'tytus'; extra?: ReactNode }> = ({ source, extra }) => {
  const { t } = useI18n();
  return (
    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ fontSize: 10, fontWeight: 600, background: 'rgba(124,77,255,0.10)', color: 'var(--accent-primary)' }}>
      {source === 'desktop' ? <AppWindow size={10} /> : <Box size={10} />}
      {source === 'desktop' ? t('appStore.card.source.desktop') : t('appStore.card.source.tytus')}
      {extra}
    </span>
  );
};

const AppIcon: FC<{ id: string; icon?: string; name: string; testIdPrefix?: string }> = ({ id, icon, name, testIdPrefix = 'appcard' }) => {
  const logo = BRAND_LOGOS[id];
  const imageLogo = getExternalAppLogo(id);
  if (logo) {
    return (
      <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 40, height: 40, background: logo.hex }} data-testid={`${testIdPrefix}-logo-${id}`}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d={logo.path} /></svg>
      </div>
    );
  }
  if (imageLogo) {
    return (
      <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 40, height: 40, background: imageLogo.background ?? 'var(--accent-primary)', overflow: 'hidden' }} data-testid={`${testIdPrefix}-logo-${id}`}>
        <img src={imageLogo.src} alt={name} draggable={false} style={{ width: 40 * (imageLogo.scale ?? 1), height: 40 * (imageLogo.scale ?? 1), objectFit: 'contain' }} />
      </div>
    );
  }
  if (icon && isBrandIconName(icon)) {
    return (
      <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 40, height: 40, background: 'var(--accent-primary)', color: 'var(--text-on-accent)', overflow: 'hidden' }} data-testid={`${testIdPrefix}-brand-${id}`}>
        <BrandIcon name={icon} size={22} alt={name} />
      </div>
    );
  }
  const Icon = icon ? (PackageIcon(icon) ?? Package) : Package;
  return (
    <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 40, height: 40, background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }} data-testid={`${testIdPrefix}-icon-${id}`}>
      <Icon size={20} />
    </div>
  );
};

function PackageIcon(name: string): FC<{ size?: number; style?: CSSProperties }> | null {
  // Lazily reuse known Lucide names without importing the full namespace into render paths.
  const known: Record<string, FC<{ size?: number; style?: CSSProperties }>> = {
    AppWindow,
    BookOpen,
    Bot,
    Box,
    Building2,
    Code2,
    FileCode,
    FileText,
    Headphones,
    Image,
    MessageCircle,
    Mic,
    Music,
    Package,
    Plug,
    Sparkles,
    Store,
    Terminal,
  };
  return known[name] ?? null;
}

const StatusPill: FC<{ state: 'installed' | 'broken' | 'available' | 'unsupported' | 'featured'; testId?: string }> = ({ state, testId }) => {
  const { t } = useI18n();
  const broken = state === 'broken';
  const installed = state === 'installed';
  const unsupported = state === 'unsupported';
  const featured = state === 'featured';
  return (
    <span
      data-testid={testId}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full"
      style={{
        fontSize: 10,
        fontWeight: 600,
        background: broken ? 'rgba(255,152,0,0.14)' : installed ? 'rgba(76,175,80,0.15)' : unsupported ? 'rgba(158,158,158,0.12)' : 'rgba(124,77,255,0.10)',
        color: broken ? 'var(--accent-warning)' : installed ? 'var(--accent-success)' : unsupported ? 'var(--text-secondary)' : 'var(--accent-primary)',
      }}
    >
      {broken || unsupported ? <AlertCircle size={10} /> : installed ? <CheckCircle2 size={10} /> : <Download size={10} />}
      {broken ? t('appStore.card.installedBroken') : installed ? t('appStore.card.installed') : unsupported ? t('appStore.card.unsupported') : featured ? t('appStore.card.featured') : t('appStore.card.available')}
    </span>
  );
};

const DesktopAppCard: FC<{
  app: StoreApp;
  check?: StoreAppCheckResult;
  onRefreshCheck?: () => void;
}> = ({ app, check, onRefreshCheck }) => {
  const client = useDaemonClient();
  const { t } = useI18n();
  const platform = navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'linux';
  const installed = check?.installed ?? false;
  const broken = check?.status === 'installed_broken' || check?.health === 'broken';
  const unsupported = check?.status === 'unsupported' || check?.health === 'unsupported';
  const catalogInstallCmd = app.install[platform] ?? Object.values(app.install)[0] ?? '';
  const dynamicInstaller = check?.install_kind?.startsWith('github_release') || check?.install_kind === 'openwork_source_build_macos' || check?.install_kind?.startsWith('odysseus_native_');
  const installCmd = check ? (unsupported || dynamicInstaller ? '' : (check.install_command ?? check.install_url ?? catalogInstallCmd)) : catalogInstallCmd;
  const installerAvailable = check ? !unsupported && Boolean(check.install_kind || check.install_command || check.install_url || installCmd) : Boolean(installCmd);
  const installLabel = !installerAvailable
    ? t('appStore.card.noCompatibleInstaller')
    : broken
      ? t('appStore.card.repair')
      : unsupported
        ? t('appStore.card.unsupported')
        : check?.install_label ?? t('common.install');
  const docsUrl = app.docs ?? app.url;
  const [busy, setBusy] = useState<null | 'open' | 'install' | 'configureLlm'>(null);
  const [installPolling, setInstallPolling] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [llmStatus, setLlmStatus] = useState<StoreAppLlmStatus | null>(null);
  const [llmStatusLoaded, setLlmStatusLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLlmStatus(null);
      setLlmStatusLoaded(false);
      if (!installed || broken || !app.llm_setup) return;
      const r = await client.getAppLlmStatus(app.id);
      if (cancelled) return;
      setLlmStatusLoaded(true);
      if (r.ok) setLlmStatus(r.value);
      else setLlmStatus({ app_id: app.id, supported: false, configured: false, provider: app.llm_setup.provider, model: app.llm_setup.default_model, base_url: null, key_hint: null, restart_required: true, message: r.error.message });
    };
    void load();
    return () => { cancelled = true; };
  }, [app.id, app.llm_setup, broken, client, installed]);

  const handleOpen = async () => {
    setBusy('open');
    setFeedback(null);
    const r = await client.postAppOpen(app.id);
    setBusy(null);
    setFeedback(r.ok ? { kind: 'ok', text: t('appStore.card.opening', { name: app.name }) } : { kind: 'err', text: r.error.message });
  };

  const handleInstall = async () => {
    setBusy('install');
    setInstallPolling(true);
    setFeedback(null);
    const r = await client.postAppInstall(app.id);
    setBusy(null);
    if (r.ok) {
      setFeedback({ kind: 'ok', text: r.value.action === 'opened_url' ? t('appStore.card.install.openedUrl', { name: app.name }) : t('appStore.card.install.runningTerminal') });
      [0, 5_000, 15_000, 30_000, 60_000, 120_000].forEach((delay) => window.setTimeout(() => onRefreshCheck?.(), delay));
      window.setTimeout(() => setInstallPolling(false), 125_000);
    } else {
      setInstallPolling(false);
      setFeedback({ kind: 'err', text: r.error.message });
    }
  };

  const handleConfigureLlm = async () => {
    setBusy('configureLlm');
    setFeedback(null);
    const r = await client.postAppConfigureLlm(app.id);
    setBusy(null);
    if (r.ok) {
      setFeedback({ kind: 'ok', text: t('appStore.card.llm.success') });
      const status = await client.getAppLlmStatus(app.id);
      if (status.ok) setLlmStatus(status.value);
    } else {
      setFeedback({ kind: 'err', text: t('appStore.card.llm.failed', { error: r.error.message }) });
    }
  };

  const showLlmSetup = installed && !broken && Boolean(app.llm_setup);
  const llmStatusLoading = showLlmSetup && !llmStatusLoaded;
  const llmConfigured = llmStatus?.configured === true;
  const llmSupported = llmStatus?.supported !== false;
  const installInProgress = installerAvailable && (busy === 'install' || (installPolling && !installed));

  return (
    <CardShell>
      <div className="flex items-start gap-3">
        <AppIcon id={app.id} icon={app.icon} name={app.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{app.name}</span>
            <SourceBadge source="desktop" />
            {installed ? <StatusPill state={broken ? 'broken' : 'installed'} /> : unsupported ? <StatusPill state="unsupported" /> : <StatusPill state="available" />}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{app.category}</span>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{app.description}</p>
      {check?.target_label && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t('appStore.card.target', { target: check.target_label })}</div>}
      {installCmd && (!installed || broken) && <MonoHint>{installCmd}</MonoHint>}

      <div className="flex gap-2 mt-auto items-center flex-wrap">
        {installed && !broken ? (
          <PrimaryButton testId={`appcard-open-${app.id}`} onClick={handleOpen} disabled={busy !== null} busy={busy === 'open'} icon={<AppWindow size={13} />}>{t('common.open')}</PrimaryButton>
        ) : installerAvailable ? (
          <PrimaryButton testId={`appcard-install-${app.id}`} onClick={handleInstall} disabled={busy !== null || unsupported || installInProgress} busy={installInProgress} icon={<Download size={13} />}>{installInProgress ? t('appStore.card.install.installing') : installLabel}</PrimaryButton>
        ) : (
          <StaticButton testId={`appcard-no-installer-${app.id}`}><AlertCircle size={13} /> {installLabel}</StaticButton>
        )}
        <SecondaryLink testId={`appcard-docs-${app.id}`} href={docsUrl}><BookOpen size={13} /> {t('common.docs')}</SecondaryLink>
        {showLlmSetup && (
          <PrimaryButton
            testId={`appcard-llm-${app.id}`}
            onClick={handleConfigureLlm}
            disabled={busy !== null || llmStatusLoading || !llmSupported}
            busy={busy === 'configureLlm'}
            icon={<Sparkles size={13} />}
            success={llmConfigured}
            title={llmSupported ? t('appStore.card.llm.title') : t('appStore.card.llm.unsupportedTitle')}
          >
            {busy === 'configureLlm' ? t('appStore.card.llm.configuring') : llmConfigured ? t('appStore.card.llm.ready') : t('appStore.card.llm.button')}
          </PrimaryButton>
        )}
      </div>
      {broken && check?.problems && check.problems.length > 0 && <span data-testid={`appcard-health-${app.id}`} style={{ fontSize: 11, color: 'var(--accent-warning)' }}>{t('appStore.card.health.broken', { problem: check.problems[0] })}</span>}
      {showLlmSetup && (llmStatusLoaded || llmStatus) && <span data-testid={`appcard-llm-status-${app.id}`} style={{ fontSize: 11, color: llmStatus?.configured ? 'var(--accent-success)' : llmStatus?.supported === false ? 'var(--accent-warning)' : 'var(--text-secondary)' }}>{llmStatus?.configured ? t('appStore.card.llm.status.ready') : llmStatus?.supported === false ? t('appStore.card.llm.status.unsupported') : t('appStore.card.llm.status.available')}</span>}
      {feedback && <span data-testid={`appcard-feedback-${app.id}`} style={{ fontSize: 11, color: feedback.kind === 'ok' ? 'var(--accent-success)' : 'var(--accent-error)' }}>{installPolling && !installed ? t('appStore.card.install.checking') : feedback.text}</span>}
    </CardShell>
  );
};

const TytusInstalledCard: FC<{
  row: InstalledAppRow;
  kind: Exclude<TytusAppKind, 'featured'>;
  busy: boolean;
  confirming: boolean;
  onOpen: () => void;
  onUninstall: () => void;
  onReinstall: () => void;
}> = ({ row, kind, busy, confirming, onOpen, onUninstall, onReinstall }) => {
  const { t } = useI18n();
  const manifest = row.manifest;
  const reinstallAvailable = row.kind === 'installed' && Boolean(row.manifestUrl);
  const removable = row.kind === 'installed' && !row.builtinProtected;
  const title = row.builtinProtected ? t('appStore.card.uninstallDisabled.system') : undefined;
  return (
    <CardShell testId={`tytus-app-card-${row.id}`}>
      <div className="flex items-start gap-3">
        <AppIcon id={row.id} icon={manifest.icon} name={manifest.name} testIdPrefix="tytus-app" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{manifest.name}</span>
            <SourceBadge source="tytus" />
            <StatusPill state="installed" />
            {manifest.version && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{t('appStore.card.version', { version: manifest.version })}</span>}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{manifest.category ?? (kind === 'system' ? t('tytusApps.sections.system.title') : t('tytusApps.sections.installed.title'))}</span>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{manifest.description ?? ''}</p>
      {kind === 'bundled' && <MonoHint>{t('appStore.card.uninstallDisabled.bundled')}</MonoHint>}
      <div className="flex gap-2 mt-auto items-center flex-wrap">
        <PrimaryButton testId={`tytus-app-open-${row.id}`} onClick={onOpen} icon={<AppWindow size={13} />}>{t('common.open')}</PrimaryButton>
        {removable && (
          <SecondaryButton testId={confirming ? `tytus-app-uninstall-confirm-${row.id}` : `tytus-app-uninstall-${row.id}`} onClick={onUninstall} disabled={busy} danger>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
            {confirming ? t('tytusApps.confirmUninstall') : t('common.uninstall')}
          </SecondaryButton>
        )}
        {reinstallAvailable && <SecondaryButton testId={`tytus-app-reinstall-${row.id}`} onClick={onReinstall} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {t('common.reinstall')}</SecondaryButton>}
        {!removable && <StaticButton title={title}>{t('tytusApps.badge.builtIn')}</StaticButton>}
      </div>
    </CardShell>
  );
};

const TytusFeaturedCard: FC<{ featured: FeaturedApp; busy: boolean; onInstall: () => void }> = ({ featured, busy, onInstall }) => {
  const { t } = useI18n();
  return (
    <CardShell testId={`tytus-featured-card-${featured.id}`}>
      <div className="flex items-start gap-3">
        <AppIcon id={featured.id} icon={featured.icon} name={featured.name} testIdPrefix="tytus-featured" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{featured.name}</span>
            <SourceBadge source="tytus" />
            <StatusPill state="featured" />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{featured.category}</span>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{featured.description}</p>
      <div className="flex gap-2 mt-auto items-center flex-wrap">
        <PrimaryButton testId={`tytus-featured-install-${featured.id}`} onClick={onInstall} disabled={busy} busy={busy} icon={<Download size={13} />}>{t('common.install')}</PrimaryButton>
      </div>
    </CardShell>
  );
};

const MonoHint: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="px-2 py-1.5 rounded-md" style={{ background: 'var(--bg-input)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-primary)', wordBreak: 'break-word', userSelect: 'text' }}>{children}</div>
);

const PrimaryButton: FC<{ type?: 'button' | 'submit'; testId?: string; onClick?: () => void; disabled?: boolean; busy?: boolean; success?: boolean; icon?: ReactNode; title?: string; children: ReactNode }> = ({ type = 'button', testId, onClick, disabled, busy, success, icon, title, children }) => (
  <button
    type={type}
    data-testid={testId}
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="flex items-center gap-1 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90"
    style={{
      fontSize: 12,
      fontWeight: 600,
      background: success ? 'rgba(76,175,80,0.14)' : 'var(--accent-primary)',
      color: success ? 'var(--accent-success)' : 'var(--text-on-accent)',
      border: success ? '1px solid rgba(76,175,80,0.35)' : 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }}
  >
    {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
    {children}
  </button>
);

const SecondaryButton: FC<{ testId?: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }> = ({ testId, onClick, disabled, danger, children }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={disabled}
    className="flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors"
    style={{
      fontSize: 12,
      fontWeight: 500,
      background: 'var(--bg-chrome)',
      color: danger ? 'var(--accent-error)' : 'var(--text-secondary)',
      border: '1px solid var(--border-subtle)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }}
  >
    {children}
  </button>
);

const StaticButton: FC<{ testId?: string; title?: string; children: ReactNode }> = ({ testId, title, children }) => (
  <span data-testid={testId} title={title} className="flex items-center gap-1 px-3 py-1.5 rounded-md" style={{ fontSize: 12, fontWeight: 600, background: 'var(--bg-chrome)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>{children}</span>
);

const SecondaryLink: FC<{ testId?: string; href: string; children: ReactNode }> = ({ testId, href, children }) => (
  <a data-testid={testId} href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors" style={{ fontSize: 12, fontWeight: 500, background: 'var(--bg-chrome)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', textDecoration: 'none' }}>{children}</a>
);

const InstallFromUrlModal: FC<{ busy: boolean; onClose: () => void; onInstall: (url: string) => void }> = ({ busy, onClose, onInstall }) => {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (trimmed) onInstall(trimmed);
  };
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)', zIndex: 9999 }}>
      <form data-testid="tytus-apps-install-modal" onSubmit={submit} className="flex flex-col gap-4 rounded-lg p-4" style={{ width: 460, maxWidth: 'calc(100vw - 32px)', background: 'var(--bg-window)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t('tytusApps.installModal.title')}</div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>{t('tytusApps.installModal.description')}</p>
          </div>
          <button type="button" onClick={onClose} data-testid="tytus-apps-install-modal-close" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <input
          data-testid="tytus-apps-install-modal-input"
          autoFocus
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/tytus-app.json"
          className="rounded-input outline-none"
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', padding: '8px 10px', fontSize: 13 }}
        />
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>{t('common.cancel')}</SecondaryButton>
          <PrimaryButton type="submit" testId="tytus-apps-install-modal-submit" disabled={busy || !url.trim()} busy={busy} icon={<Download size={13} />}>{busy ? t('tytusApps.installing') : t('common.install')}</PrimaryButton>
        </div>
      </form>
    </div>
  );
};

export default AppStore;
