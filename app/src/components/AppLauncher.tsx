// ============================================================
// AppLauncher — Full-screen overlay with search + app grid
// ============================================================

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useOS } from '@/hooks/useOSStore';
import { getAppById } from '@/apps/registry';
import { useDemoApps } from '@/hooks/useDemoApps';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { getFrequentApps } from '@/lib/repo/appLaunches';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { AppDefinition } from '@/types';
import { useI18n } from '@/i18n';
import { BrandIcon, isBrandIconName } from './BrandIcon';

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  if (isBrandIconName(name)) {
    return <BrandIcon name={name} size={(props.size as number) ?? 24} className={props.className} />;
  }
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  return IconComp ? <IconComp {...props} /> : null;
};

const CATEGORIES = ['Favorites', 'All', 'System', 'Internet', 'Productivity', 'Media', 'DevTools', 'Creative', 'Games'];

const AppLauncher = memo(function AppLauncher() {
  const { state, dispatch } = useOS();
  const { t } = useI18n();
  const { appLauncherOpen, apps, dockItems } = state;
  // Tier-aware default for demo apps: paid tiers (creator/operator)
  // start with demos OFF; Explorer / unknown / pre-state-load default
  // to ON. Once the user toggles in Settings, the stored choice wins.
  const daemon = useDaemonStateContext();
  const { showDemoApps } = useDemoApps(daemon.state?.tier);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [scoredFrequent, setScoredFrequent] = useState<AppDefinition[]>([]);

  // Watch the grid's scroll position so we can show / hide arrow buttons
  useEffect(() => {
    if (!appLauncherOpen) return;
    const el = gridRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollUp(el.scrollTop > 4);
      setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [appLauncherOpen, searchQuery, activeCategory]);

  const scrollGrid = useCallback((dir: 'up' | 'down') => {
    const el = gridRef.current;
    if (!el) return;
    el.scrollBy({ top: dir === 'down' ? el.clientHeight * 0.8 : -el.clientHeight * 0.8, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (appLauncherOpen) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- opening launcher resets transient search state. */
      setSearchQuery('');
      setTimeout(() => inputRef.current?.focus(), 100);
      // Load scored frequent apps from usage history
      getFrequentApps(8).then((scored) => {
        const resolved = scored
          .map((s) => getAppById(s.appId))
          .filter(Boolean) as AppDefinition[];
        setScoredFrequent(resolved);
      });
    }
  }, [appLauncherOpen]);

  // Close on Escape
  useEffect(() => {
    if (!appLauncherOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'SET_APP_LAUNCHER', open: false });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appLauncherOpen, dispatch]);

  const handleLaunch = useCallback(
    (appId: string) => {
      dispatch({ type: 'SET_APP_LAUNCHER', open: false });
      // Small delay so launcher closes first
      setTimeout(() => {
        dispatch({ type: 'OPEN_WINDOW', appId });
      }, 150);
    },
    [dispatch]
  );

  const filteredApps = apps.filter((app) => {
    // Manifest AN8: hide demo apps when the toggle is off, regardless
    // of category or search match. User can opt back in via Settings
    // → Display.
    if (app.isDemo && !showDemoApps) return false;
    const matchesSearch = !searchQuery ||
      t(`app.${app.id}.name`).toLowerCase().includes(searchQuery.toLowerCase()) ||
      t(`app.${app.id}.description`).toLowerCase().includes(searchQuery.toLowerCase()) ||
      t(`category.${app.category}`).toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'All' || activeCategory === 'Favorites'
      ? true
      : app.category === activeCategory;
    const matchesFavorites = activeCategory !== 'Favorites' || dockItems.some((d) => d.appId === app.id && d.isPinned);
    return matchesSearch && matchesCategory && matchesFavorites;
  });

  // Filter the Games category off entirely when demo apps are hidden —
  // an empty category tab is worse than no tab.
  const visibleCategories = CATEGORIES.filter((c) =>
    showDemoApps ? true : c !== 'Games',
  );

  // If user toggles demo apps off while sitting on Games, snap back
  // to All so they don't see an empty grid with no nav target.
  // Deliberate setState-in-effect — syncing local UI state to an
  // external preference change.
  useEffect(() => {
    if (!showDemoApps && activeCategory === 'Games') {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setActiveCategory('All');
    }
  }, [showDemoApps, activeCategory]);

  // Frequent apps: scored by usage, with pinned dock items as fallback
  const frequentApps = scoredFrequent.length > 0
    ? scoredFrequent
    : dockItems
        .filter((d) => d.isPinned)
        .map((d) => getAppById(d.appId))
        .filter(Boolean) as AppDefinition[];

  if (!appLauncherOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('appLauncher.aria')}
      className="fixed inset-0 z-[3000] flex flex-col items-center"
      style={{
        background: 'var(--bg-app-grid)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        animation: 'launcherFade 300ms ease',
        paddingTop: 32,
        paddingBottom: 80,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dispatch({ type: 'SET_APP_LAUNCHER', open: false });
      }}
    >
      {/* Search bar */}
      <div
        className="relative w-[480px] max-w-[90vw]"
        style={{
          animation: 'searchSlideDown 400ms cubic-bezier(0, 0, 0.2, 1) 100ms both',
        }}
      >
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('appLauncher.searchPlaceholder')}
          className="w-full h-11 rounded-full pl-11 pr-10 text-sm outline-none transition-all"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-primary)';
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,77,255,0.15)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-default)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Frequent apps (only when not searching) */}
      {!searchQuery && frequentApps.length > 0 && (
        <div className="mt-6 w-[1000px] max-w-[90vw]"
          style={{ animation: 'searchSlideDown 300ms ease 200ms both' }}
        >
          <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.1em] mb-3">{t('appLauncher.frequentlyUsed')}</p>
          <div className="flex gap-4">
            {frequentApps.slice(0, 6).map((app) => (
              <button
                key={app.id}
                onClick={() => handleLaunch(app.id)}
                className="flex flex-col items-center gap-1 w-16 group"
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform"
                  style={{ background: 'var(--bg-hover)' }}>
                  <DynamicIcon name={app.icon} size={24} className="text-[var(--text-primary)]" />
                </div>
                <span className="text-[10px] text-[var(--text-primary)] text-center truncate max-w-[64px]">{t(`app.${app.id}.name`)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category tabs */}
      {!searchQuery && (
        <div
          className="flex items-center gap-0 mt-4 overflow-x-auto max-w-[90vw]"
          style={{ animation: 'searchSlideDown 300ms ease 250ms both' }}
        >
          {visibleCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="px-4 py-1.5 text-xs font-medium whitespace-nowrap transition-colors relative"
              style={{
                color: activeCategory === cat ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderBottom: activeCategory === cat ? '2px solid var(--accent-primary)' : '2px solid transparent',
              }}
            >
              {t(`category.${cat}`)}
            </button>
          ))}
        </div>
      )}

      {/* App grid wrapper — scroll buttons sit absolutely above/below */}
      <div className="relative mt-4 w-[1000px] max-w-[90vw]" style={{ flex: 1, minHeight: 0 }}>
        {canScrollUp && (
          <button
            onClick={() => scrollGrid('up')}
            aria-label={t('appLauncher.scrollUp')}
            className="absolute left-1/2 -translate-x-1/2 -top-3 w-9 h-9 rounded-full flex items-center justify-center z-10 transition-opacity"
            style={{
              background: 'var(--bg-tooltip, rgba(40,40,40,0.92))',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <ChevronUp size={18} />
          </button>
        )}
        {canScrollDown && (
          <button
            onClick={() => scrollGrid('down')}
            aria-label={t('appLauncher.scrollDown')}
            className="absolute left-1/2 -translate-x-1/2 -bottom-3 w-9 h-9 rounded-full flex items-center justify-center z-10 transition-opacity"
            style={{
              background: 'var(--bg-tooltip, rgba(40,40,40,0.92))',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <ChevronDown size={18} />
          </button>
        )}

      {/* App grid */}
      <div
        ref={gridRef}
        className="h-full overflow-y-auto custom-scrollbar"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
          gap: 16,
          animation: 'gridAppear 300ms cubic-bezier(0.34, 1.56, 0.64, 1) 200ms both',
          padding: '4px',
        }}
      >
        {filteredApps.map((app, index) => (
          <button
            key={app.id}
            onClick={() => handleLaunch(app.id)}
            className="flex flex-col items-center gap-1.5 p-2 rounded-2xl group transition-all"
            style={{
              animation: `iconPop 250ms cubic-bezier(0.34, 1.56, 0.64, 1) ${200 + index * 15}ms both`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.transform = 'scale(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--bg-hover)' }}>
              <DynamicIcon name={app.icon} size={32} className="text-[var(--text-primary)]" />
            </div>
            <span className="text-[10px] text-[var(--text-primary)] text-center truncate max-w-[72px]">
              {t(`app.${app.id}.name`)}
            </span>
          </button>
        ))}

        {filteredApps.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-[var(--text-secondary)]">
            <Search size={48} className="mb-4 opacity-30" />
            <p className="text-sm">{t('appLauncher.noAppsFound')}</p>
          </div>
        )}
      </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); border-radius: 8px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); background-clip: padding-box; border: 2px solid transparent; }
        .custom-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent; }
      `}</style>
      <style>{`
        @keyframes launcherFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes searchSlideDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes gridAppear {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes iconPop {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
});

export default AppLauncher;
