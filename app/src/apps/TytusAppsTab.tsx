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
 *   2. Installed apps (post-v1) — third-party `.tytusapp` zips (M10).
 *      Empty in v1; the section header is shown with a "Coming after
 *      v1" placeholder so users see the future affordance.
 *
 *   3. System apps history (subtle, collapsed by default) — alias rows
 *      (kind='alias') for retired pre-extraction app ids. Each row
 *      shows "→ now part of <X>" with a button to open the live app.
 *
 * The Desktop tab (existing daemon-backed catalog) stays intact in
 * AppStore.tsx as the second top-level tab; this component is the
 * "Tytus Apps" tab content.
 *
 * This file is the standalone component; PR-M5.2 wires it into the
 * top-level AppStore as a tab.
 */

import { type FC, useEffect, useState } from 'react';
import { Box, Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { getDb } from '@/lib/db';
import {
  listInstalledApps,
  type InstalledAppRow,
} from '@/runtime/installed-apps-repo';

interface TytusAppsTabProps {
  /** Optional override — tests pass an in-memory db so the component
   *  renders with deterministic data. Production reads via getDb(). */
  loadInstalledApps?: () => Promise<InstalledAppRow[]>;
  /** Optional click handler for opening an app — wired by AppStore. */
  onOpen?: (appId: string) => void;
}

const SYSTEM_APP_TOOLTIP =
  'System app — auto-updated with Tytus OS. Cannot be uninstalled in v1.';

export const TytusAppsTab: FC<TytusAppsTabProps> = ({
  loadInstalledApps,
  onOpen,
}) => {
  const [rows, setRows] = useState<InstalledAppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

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
  }, [loadInstalledApps]);

  const systemApps = rows
    .filter((r) => r.kind === 'bundled')
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const installedApps = rows
    .filter((r) => r.kind === 'installed')
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const aliasApps = rows
    .filter((r) => r.kind === 'alias')
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

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

      {/* Installed apps (post-v1) */}
      <div style={{ marginTop: 24 }}>
        <SectionHeader
          title="Installed apps"
          subtitle="Third-party apps you install. Available after v1."
          count={installedApps.length}
        />
        {installedApps.length === 0 ? (
          <EmptyHint message="Coming after v1 — third-party app installs." />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {installedApps.map((row) => (
              <SystemAppCard
                key={row.id}
                row={row}
                onOpen={() => onOpen?.(row.id)}
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
          <button
            disabled={isProtected}
            data-testid={`tytus-app-uninstall-${row.id}`}
            title={isProtected ? SYSTEM_APP_TOOLTIP : undefined}
            className="rounded-md px-2 py-1"
            style={{
              fontSize: 12,
              background: 'transparent',
              color: isProtected ? 'var(--text-disabled)' : 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              cursor: isProtected ? 'not-allowed' : 'pointer',
              opacity: isProtected ? 0.5 : 1,
            }}
          >
            Uninstall
          </button>
        </div>
      </div>
    </div>
  );
};

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

export default TytusAppsTab;
