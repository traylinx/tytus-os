/**
 * "Tytus Apps" tab content for the App Store. Renders three sections
 * per D28:
 *
 *   1. System apps (top) — workspace-package apps shipped with this
 *      Tytus OS build (Sheet, Studio, Memo, Music Creator, Music Player,
 *      Voice Recorder once they extract). Read from installed_apps
 *      WHERE kind='bundled'. Uninstall toggle disabled with tooltip:
 *      "System app — auto-updated with Tytus OS".
 *
 *   2. Installed apps (post-v1) — third-party apps the user installs via
 *      "Install from URL" (Phase 3 of SPRINT-TYTUS-APP-SYSTEM-V1). Each
 *      row exposes Open + Uninstall + Reinstall actions.
 *
 *   3. System apps history (subtle, collapsed by default) — alias rows
 *      (kind='alias') for retired pre-extraction app ids. Each row
 *      shows "→ now part of <X>" with a button to open the live app.
 *
 * Phase 3 additions:
 *   - "Install from URL" button at the top of the System apps section,
 *     opening a modal that drives `installAppFromManifestUrl`.
 *   - Uninstall + Reinstall buttons on each kind='installed' row.
 *   - Live refresh after every install / uninstall / reinstall via the
 *     `reloadKey` state-bump pattern (no separate hook needed).
 */

import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Layers, ChevronDown, ChevronRight, Download, Loader2, Sparkles, X } from 'lucide-react';
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
import { useOptionalNotifications } from '@/hooks/useOSStore';
import { FEATURED_APPS, type FeaturedApp, loadFeaturedApps } from './featured-apps-catalog';
import { isHiddenLegacyApp } from './product-replacements';

/** Map an InstallerError code to a user-facing toast message. */
function installerErrorToast(action: 'install' | 'uninstall' | 'reinstall', err: unknown): {
  title: string;
  message: string;
} {
  const verb = action === 'install' ? 'install' : action;
  if (err instanceof InstallerError) {
    switch (err.code) {
      case 'invalid_manifest':
        return { title: `Couldn't ${verb} — invalid manifest`, message: "The app's tytus-app.json failed validation. The publisher needs to fix the manifest." };
      case 'duplicate':
        return { title: 'Already installed', message: 'An app with this id is already in your registry. Uninstall it first or use Reinstall.' };
      case 'not_found':
        return { title: `Couldn't ${verb} — not found`, message: 'No installed app with that id. It may have already been uninstalled.' };
      case 'protected':
        return { title: 'System apps are protected', message: 'This is a built-in app and cannot be uninstalled.' };
      case 'fetch_failed':
        return { title: `Couldn't ${verb} — network error`, message: 'The manifest URL is unreachable. Check your connection and retry.' };
      case 'parse_failed':
        return { title: `Couldn't ${verb} — bad response`, message: 'The manifest URL returned a non-JSON response.' };
      case 'bad_transport':
        return { title: `Couldn't ${verb} — bad manifest`, message: 'Installable apps must declare entry.url (https), not entry.module.' };
      case 'cannot_reinstall':
        return { title: 'Reinstall not supported', message: 'This app was bundled with the OS — there\'s no source URL to refetch from.' };
    }
  }
  return {
    title: `Couldn't ${verb}`,
    message: err instanceof Error ? err.message : 'Unexpected error. Check the console for details.',
  };
}

interface TytusAppsTabProps {
  /** Optional override — tests pass an in-memory db so the component
   *  renders with deterministic data. Production reads via getDb(). */
  loadInstalledApps?: () => Promise<InstalledAppRow[]>;
  /** Optional click handler for opening an app — wired by AppStore. */
  onOpen?: (appId: string) => void;
  /** Test injection: drive install / uninstall / reinstall against an
   *  in-memory db without spinning the worker. Production code reads
   *  from getDb() directly. */
  onInstallFromUrl?: (manifestUrl: string) => Promise<InstalledAppRow>;
  onUninstall?: (appId: string) => Promise<void>;
  onReinstall?: (appId: string) => Promise<InstalledAppRow>;
  /** Test injection: stub the Featured-catalog fetch. Defaults to
   *  loadFeaturedApps() which fetches the remote catalog with fallback. */
  loadFeatured?: () => Promise<FeaturedApp[]>;
}

const SYSTEM_APP_TOOLTIP =
  'System app — auto-updated with Tytus OS. Cannot be uninstalled in v1.';

export const TytusAppsTab: FC<TytusAppsTabProps> = ({
  loadInstalledApps,
  onOpen,
  onInstallFromUrl,
  onUninstall,
  onReinstall,
  loadFeatured,
}) => {
  const [rows, setRows] = useState<InstalledAppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  /** Featured catalog state — fetched once on mount, refreshed when the
   *  installer triggers a reloadKey bump. Falls back to FEATURED_APPS on
   *  any fetch / parse failure (handled inside loadFeaturedApps). */
  const [featured, setFeatured] = useState<FeaturedApp[]>(FEATURED_APPS);
  /** Per-row busy ids (uninstalling / reinstalling) — disables the
   *  buttons and shows a spinner without re-rendering the whole list. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const { addNotification } = useOptionalNotifications();

  const refresh = useCallback(() => setReloadKey((n) => n + 1), []);

  const surfaceInstallerError = useCallback(
    (action: 'install' | 'uninstall' | 'reinstall', appId: string, err: unknown) => {
      const { title, message } = installerErrorToast(action, err);
      addNotification({
        appId: 'app-store',
        appName: 'App Store',
        appIcon: 'Store',
        title,
        message,
        isRead: false,
      });
      // Keep the console diagnostic for power-user debugging.
      console.error(`[AppStore] ${action} failed`, { appId, err });
    },
    [addNotification],
  );

  // Default db-backed actions. When tests pass overrides, they short-
  // circuit these (so the worker is never touched in unit tests).
  const doInstall = useCallback(
    async (manifestUrl: string): Promise<InstalledAppRow> => {
      if (onInstallFromUrl) return onInstallFromUrl(manifestUrl);
      const db = getDb();
      if (!db) throw new InstallerError('fetch_failed', { reason: 'db not initialized' });
      return installAppFromManifestUrl({ manifestUrl, db });
    },
    [onInstallFromUrl],
  );
  const doUninstall = useCallback(
    async (appId: string): Promise<void> => {
      if (onUninstall) return onUninstall(appId);
      const db = getDb();
      if (!db) throw new InstallerError('not_found', { id: appId, reason: 'db not initialized' });
      return uninstallApp({ appId, db });
    },
    [onUninstall],
  );
  const doReinstall = useCallback(
    async (appId: string): Promise<InstalledAppRow> => {
      if (onReinstall) return onReinstall(appId);
      const db = getDb();
      if (!db) throw new InstallerError('not_found', { id: appId, reason: 'db not initialized' });
      return reinstallApp({ appId, db });
    },
    [onReinstall],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        let list: InstalledAppRow[];
        if (loadInstalledApps) {
          list = await loadInstalledApps();
        } else {
          const db = getDb();
          if (!db) {
            list = [];
          } else {
            list = await listInstalledApps(db);
          }
        }
        if (!cancelled) setRows(list);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadInstalledApps, reloadKey]);

  const systemApps = rows
    .filter((r) => r.kind === 'bundled' && r.builtinProtected && !isHiddenLegacyApp(r.id))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const userBundledApps = rows
    .filter((r) => r.kind === 'bundled' && !r.builtinProtected && !isHiddenLegacyApp(r.id))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const installedApps = rows
    .filter((r) => r.kind === 'installed' && !isHiddenLegacyApp(r.id))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const aliasApps = rows
    .filter((r) => r.kind === 'alias' && !isHiddenLegacyApp(r.id))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

  const handleUninstall = async (row: InstalledAppRow) => {
    setBusyId(row.id);
    try {
      await doUninstall(row.id);
      refresh();
    } catch (err) {
      surfaceInstallerError('uninstall', row.id, err);
    } finally {
      setBusyId(null);
    }
  };

  // Fetch the remote catalog once on mount. Errors fall back to the
  // hardcoded baseline silently (loadFeaturedApps handles that).
  useEffect(() => {
    let cancelled = false;
    const load = loadFeatured ?? loadFeaturedApps;
    void load()
      .then((list) => {
        if (!cancelled) setFeatured(list);
      })
      .catch(() => {
        // loadFeaturedApps already swallows errors and returns the
        // baseline; this catch is just defence-in-depth.
        if (!cancelled) setFeatured(FEATURED_APPS);
      });
    return () => {
      cancelled = true;
    };
  }, [loadFeatured]);

  /** Featured apps NOT yet installed — surface in the catalog section. */
  const availableFeatured = useMemo(() => {
    const knownIds = new Set(rows.map((r) => r.id));
    return featured.filter((f) => !knownIds.has(f.id) && !isHiddenLegacyApp(f.id));
  }, [rows, featured]);

  const handleFeaturedInstall = async (featured: FeaturedApp) => {
    setBusyId(featured.id);
    try {
      await doInstall(featured.manifestUrl);
      refresh();
    } catch (err) {
      surfaceInstallerError('install', featured.id, err);
    } finally {
      setBusyId(null);
    }
  };

  const handleReinstall = async (row: InstalledAppRow) => {
    setBusyId(row.id);
    try {
      await doReinstall(row.id);
      refresh();
    } catch (err) {
      surfaceInstallerError('reinstall', row.id, err);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div
        className="h-full flex items-center justify-center"
        data-testid="tytus-apps-loading"
      >
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Loading installed apps…
        </span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 custom-scrollbar" data-testid="tytus-apps-tab">
      {/* Install from URL button — top of tab */}
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Install third-party apps via a tytus-app.json URL.
        </span>
        <button
          data-testid="tytus-apps-install-from-url"
          onClick={() => setInstallModalOpen(true)}
          className="flex items-center gap-2 rounded-md px-3 py-1.5"
          style={{
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--accent-primary)',
            color: 'var(--text-on-accent)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <Download size={13} /> Install from URL
        </button>
      </div>

      {/* System apps */}
      <SectionHeader
        title="System apps"
        subtitle="Built-in. Auto-updated with Tytus OS."
        count={systemApps.length}
      />
      {systemApps.length === 0 ? (
        <EmptyHint message="No system apps installed yet." />
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
        >
          {systemApps.map((row) => (
            <SystemAppCard
              key={row.id}
              row={row}
              onOpen={() => onOpen?.(row.id)}
            />
          ))}
        </div>
      )}

      {/* Featured apps — curated catalog of installable user apps */}
      {availableFeatured.length > 0 && (
        <div style={{ marginTop: 24 }} data-testid="tytus-apps-featured">
          <SectionHeader
            title="Featured apps"
            subtitle="One-click install from the official tytus-app catalog."
            count={availableFeatured.length}
          />
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {availableFeatured.map((f) => (
              <FeaturedAppCard
                key={f.id}
                featured={f}
                busy={busyId === f.id}
                onInstall={() => handleFeaturedInstall(f)}
              />
            ))}
          </div>
        </div>
      )}

      {/* User-app skeletons (kind='bundled', builtin_protected=0) */}
      {userBundledApps.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionHeader
            title="Bundled user apps"
            subtitle="Workspace skeletons; will install standalone after Phase 5."
            count={userBundledApps.length}
          />
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {userBundledApps.map((row) => (
              <SystemAppCard
                key={row.id}
                row={row}
                onOpen={() => onOpen?.(row.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Installed apps (third-party via Install from URL) */}
      <div style={{ marginTop: 24 }}>
        <SectionHeader
          title="Installed apps"
          subtitle="Third-party apps you install via Install from URL."
          count={installedApps.length}
        />
        {installedApps.length === 0 ? (
          <EmptyHint message="No third-party apps installed. Use Install from URL above." />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {installedApps.map((row) => (
              <InstalledAppCard
                key={row.id}
                row={row}
                busy={busyId === row.id}
                onOpen={() => onOpen?.(row.id)}
                onUninstall={() => handleUninstall(row)}
                onReinstall={
                  row.manifestUrl ? () => handleReinstall(row) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* System apps history (collapsed by default) */}
      {aliasApps.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            data-testid="tytus-apps-history-toggle"
            className="flex items-center gap-2 w-full text-left"
            style={{
              padding: '8px 4px',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            {historyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>System apps history ({aliasApps.length})</span>
          </button>
          {historyOpen && (
            <div className="grid gap-2" style={{ marginTop: 8 }}>
              {aliasApps.map((row) => (
                <AliasRow
                  key={row.id}
                  row={row}
                  onOpen={() => onOpen?.(row.manifest.aliasOf ?? row.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {installModalOpen && (
        <InstallFromUrlModal
          onClose={() => setInstallModalOpen(false)}
          onSuccess={() => {
            setInstallModalOpen(false);
            refresh();
          }}
          doInstall={doInstall}
        />
      )}
    </div>
  );
};

const SectionHeader: FC<{
  title: string;
  subtitle: string;
  count: number;
}> = ({ title, subtitle, count }) => (
  <div style={{ marginBottom: 12 }}>
    <div className="flex items-baseline gap-2">
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
        {title}
      </span>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {count} {count === 1 ? 'app' : 'apps'}
      </span>
    </div>
    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
      {subtitle}
    </div>
  </div>
);

const EmptyHint: FC<{ message: string }> = ({ message }) => (
  <div
    className="flex items-center justify-center"
    style={{
      padding: 24,
      border: '1px dashed var(--border-subtle)',
      borderRadius: 8,
      color: 'var(--text-secondary)',
      fontSize: 13,
    }}
  >
    {message}
  </div>
);

const SystemAppCard: FC<{
  row: InstalledAppRow;
  onOpen: () => void;
}> = ({ row, onOpen }) => {
  const isProtected = row.builtinProtected;
  return (
    <div
      data-testid={`tytus-app-card-${row.id}`}
      className="flex items-start gap-3 rounded-lg p-3"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          background: 'var(--bg-chrome)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box size={20} style={{ color: 'var(--accent-primary)' }} />
      </div>
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {row.manifest.name}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            v{row.manifest.version}
          </span>
          {isProtected && (
            <span
              data-testid={`tytus-app-builtin-badge-${row.id}`}
              className="rounded-full px-1.5 py-0.5"
              style={{
                fontSize: 10,
                fontWeight: 600,
                background: 'rgba(124,77,255,0.10)',
                color: 'var(--accent-primary)',
              }}
            >
              Built-in
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {row.manifest.description}
        </div>
        <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
          <button
            onClick={onOpen}
            data-testid={`tytus-app-open-${row.id}`}
            className="rounded-md px-2 py-1"
            style={{
              fontSize: 12,
              background: 'var(--accent-primary)',
              color: 'var(--text-on-accent)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Open
          </button>
          {isProtected ? (
            <button
              disabled
              data-testid={`tytus-app-uninstall-${row.id}`}
              title={SYSTEM_APP_TOOLTIP}
              className="rounded-md px-2 py-1"
              style={{
                fontSize: 12,
                background: 'transparent',
                color: 'var(--text-disabled)',
                border: '1px solid var(--border-subtle)',
                cursor: 'not-allowed',
                opacity: 0.5,
              }}
            >
              Uninstall
            </button>
          ) : (
            <button
              disabled
              data-testid={`tytus-app-uninstall-${row.id}`}
              title="Bundled user-app skeleton — re-seeds on every boot until Phase 5 ships filesystem-install."
              className="rounded-md px-2 py-1"
              style={{
                fontSize: 12,
                background: 'transparent',
                color: 'var(--text-disabled)',
                border: '1px solid var(--border-subtle)',
                cursor: 'not-allowed',
                opacity: 0.5,
              }}
            >
              Uninstall
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const InstalledAppCard: FC<{
  row: InstalledAppRow;
  busy: boolean;
  onOpen: () => void;
  onUninstall: () => void;
  onReinstall?: () => void;
}> = ({ row, busy, onOpen, onUninstall, onReinstall }) => {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      data-testid={`tytus-app-card-${row.id}`}
      className="flex items-start gap-3 rounded-lg p-3"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          background: 'var(--bg-chrome)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box size={20} style={{ color: 'var(--accent-primary)' }} />
      </div>
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {row.manifest.name}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            v{row.manifest.version}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {row.manifest.description}
        </div>
        <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
          <button
            onClick={onOpen}
            data-testid={`tytus-app-open-${row.id}`}
            className="rounded-md px-2 py-1"
            style={{
              fontSize: 12,
              background: 'var(--accent-primary)',
              color: 'var(--text-on-accent)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Open
          </button>
          {confirming ? (
            <>
              <button
                onClick={() => {
                  setConfirming(false);
                  onUninstall();
                }}
                disabled={busy}
                data-testid={`tytus-app-uninstall-confirm-${row.id}`}
                className="rounded-md px-2 py-1"
                style={{
                  fontSize: 12,
                  background: 'var(--accent-error, #c4302b)',
                  color: 'white',
                  border: 'none',
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : 'Confirm uninstall'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-md px-2 py-1"
                style={{
                  fontSize: 12,
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={busy}
              data-testid={`tytus-app-uninstall-${row.id}`}
              className="rounded-md px-2 py-1"
              style={{
                fontSize: 12,
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              Uninstall
            </button>
          )}
          {onReinstall && (
            <button
              onClick={onReinstall}
              disabled={busy}
              data-testid={`tytus-app-reinstall-${row.id}`}
              title={
                row.manifestUrl
                  ? `Re-fetch manifest from ${row.manifestUrl}`
                  : undefined
              }
              className="rounded-md px-2 py-1"
              style={{
                fontSize: 12,
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : 'Reinstall'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const InstallFromUrlModal: FC<{
  onClose: () => void;
  onSuccess: () => void;
  doInstall: (manifestUrl: string) => Promise<InstalledAppRow>;
}> = ({ onClose, onSuccess, doInstall }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setErrMsg(null);
    try {
      await doInstall(url.trim());
      onSuccess();
    } catch (err) {
      setErrMsg(formatInstallerError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="tytus-apps-install-modal"
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', zIndex: 100 }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="rounded-lg"
        style={{
          width: 480,
          maxWidth: '90%',
          background: 'var(--bg-window)',
          border: '1px solid var(--border-default)',
          padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Install app from URL
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="tytus-apps-install-modal-close"
            className="rounded-md p-1"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <X size={14} />
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
          Paste the URL of a tytus-app.json manifest. The app will be fetched
          and validated before installation.
        </p>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://cdn.jsdelivr.net/gh/.../tytus-app.json"
          data-testid="tytus-apps-install-modal-input"
          autoFocus
          disabled={busy}
          className="w-full rounded-input"
          style={{
            padding: '6px 10px',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        />
        {errMsg && (
          <div
            data-testid="tytus-apps-install-modal-error"
            style={{
              marginTop: 10,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(196,48,43,0.10)',
              color: 'var(--accent-error, #c4302b)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {errMsg}
          </div>
        )}
        <div className="flex items-center justify-end gap-2" style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5"
            style={{
              fontSize: 12,
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !url.trim()}
            data-testid="tytus-apps-install-modal-submit"
            className="flex items-center gap-2 rounded-md px-3 py-1.5"
            style={{
              fontSize: 12,
              fontWeight: 600,
              background: busy ? 'var(--bg-chrome)' : 'var(--accent-primary)',
              color: 'var(--text-on-accent)',
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              opacity: !url.trim() ? 0.6 : 1,
            }}
          >
            {busy ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Installing…
              </>
            ) : (
              'Install'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

/** Pretty-print an `InstallerError` into a single string the modal can
 *  render. Falls back to `String(err)` for unknown errors so the user
 *  always sees something. */
function formatInstallerError(err: unknown): string {
  if (err instanceof InstallerError) {
    const head = `Install failed (${err.code})`;
    if (err.code === 'invalid_manifest' && Array.isArray(err.details)) {
      const issues = (err.details as Array<{ path: string; message: string }>)
        .map((i) => `  ${i.path || '/'}: ${i.message}`)
        .join('\n');
      return `${head}\n${issues}`;
    }
    if (err.code === 'duplicate' && err.details && typeof err.details === 'object') {
      const id = (err.details as { existingId?: string }).existingId ?? '?';
      return `${head}: app id "${id}" is already installed. Uninstall first or use Reinstall.`;
    }
    if (err.code === 'fetch_failed' && err.details && typeof err.details === 'object') {
      const d = err.details as { url?: string; status?: number };
      return `${head}: ${d.url ?? ''}${
        d.status !== undefined ? ` (HTTP ${d.status})` : ''
      }`;
    }
    if (err.code === 'parse_failed') {
      return `${head}: manifest is not valid JSON.`;
    }
    if (err.code === 'bad_transport') {
      return `${head}: installed apps must use entry.url (https), not entry.module.`;
    }
    return head;
  }
  return `Install failed: ${err instanceof Error ? err.message : String(err)}`;
}

const AliasRow: FC<{
  row: InstalledAppRow;
  onOpen: () => void;
}> = ({ row, onOpen }) => {
  const aliasOf = row.manifest.aliasOf ?? '?';
  return (
    <div
      data-testid={`tytus-app-alias-${row.id}`}
      className="flex items-center gap-3 rounded-md p-2"
      style={{
        background: 'transparent',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <Layers size={14} style={{ color: 'var(--text-secondary)' }} />
      <div className="flex-1" style={{ minWidth: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          {row.manifest.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>
          → now part of {aliasOf}
        </span>
      </div>
      <button
        onClick={onOpen}
        className="rounded-md px-2 py-1"
        style={{
          fontSize: 11,
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)',
          cursor: 'pointer',
        }}
      >
        Open {aliasOf}
      </button>
    </div>
  );
};

const FeaturedAppCard: FC<{
  featured: FeaturedApp;
  busy: boolean;
  onInstall: () => void;
}> = ({ featured, busy, onInstall }) => (
  <div
    data-testid={`tytus-featured-card-${featured.id}`}
    className="flex items-start gap-3 rounded-lg p-3"
    style={{
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-tertiary)',
    }}
  >
    <Sparkles size={20} style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: 2 }} />
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {featured.name}
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            padding: '1px 6px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
          }}
        >
          {featured.category}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 8,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {featured.description}
      </div>
      <button
        data-testid={`tytus-featured-install-${featured.id}`}
        onClick={onInstall}
        disabled={busy}
        className="flex items-center gap-1.5 rounded px-2 py-1"
        style={{
          fontSize: 11,
          fontWeight: 600,
          background: busy ? 'var(--bg-secondary)' : 'var(--accent-primary)',
          color: busy ? 'var(--text-secondary)' : 'var(--text-on-accent)',
          border: 'none',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
        {busy ? 'Installing…' : 'Install'}
      </button>
    </div>
  </div>
);

export default TytusAppsTab;
