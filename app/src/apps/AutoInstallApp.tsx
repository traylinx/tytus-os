/**
 * AutoInstallApp — bridge between the launcher's static APP_REGISTRY
 * entries and the live `installed_apps` table.
 *
 * Why this component exists
 * -------------------------
 * The launcher (`APP_REGISTRY`) advertises every known app — including
 * the user-app skeletons that were carved out of the bundled set into
 * standalone repos (markdown-preview, photo-editor, code-editor,
 * text-editor, api-tester). Clicking one of those before it has been
 * installed used to either:
 *
 *   - crash with a stale-row "Failed to resolve module specifier"
 *     error (pre-fix, still triggered by the legacy in-DB row), or
 *   - render an `<AppPlaceholder>` after the orphan-cleanup, which is
 *     less broken but still doesn't open the app.
 *
 * This component closes the loop. When AppRouter sees a click for a
 * canonical id that is in `FEATURED_APPS` but not in `installed_apps`
 * yet, it mounts AutoInstallApp. The component fetches the manifest URL
 * and installs the row in-place, which flips `useInstalledAppIds()` and
 * causes AppRouter to re-render with `WorkspaceAppHost` mounting the
 * freshly-installed app. To the user it looks like a slightly slower
 * "Open" — Installing… → app surface.
 *
 * Errors surface as an inline card with a Retry button. The user can
 * also cancel out of the window.
 */

import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import { getDb, initDb } from '@/lib/db';
import {
  installAppFromManifestUrl,
  InstallerError,
} from '@/runtime/installer';
import { useI18n } from '@/i18n';
import type { FeaturedApp } from './featured-apps-catalog';

interface AutoInstallAppProps {
  appId: string;
  catalogEntry: FeaturedApp;
}

type Status = 'idle' | 'installing' | 'error';

const AutoInstallApp: FC<AutoInstallAppProps> = ({ appId, catalogEntry }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const installedRef = useRef(false);

  const runInstall = useCallback(async () => {
    setStatus('installing');
    setErrorMessage('');
    try {
      let db = getDb();
      if (!db) db = await initDb();
      await installAppFromManifestUrl({
        manifestUrl: catalogEntry.manifestUrl,
        db,
      });
      installedRef.current = true;
      // The installed-apps-cache + installed-apps-events broadcast in
      // installAppFromManifestUrl will re-fire useInstalledAppIds, which
      // re-renders AppRouter and mounts WorkspaceAppHost. This component
      // unmounts in that pass — no further state changes needed here.
    } catch (err) {
      const message =
        err instanceof InstallerError
          ? friendlyErrorMessage(err)
          : (err as Error)?.message ?? 'Install failed.';
      setErrorMessage(message);
      setStatus('error');
    }
  }, [catalogEntry.manifestUrl]);

  useEffect(() => {
    if (installedRef.current) return;
    void runInstall();
  }, [runInstall]);

  if (status === 'error') {
    return (
      <div
        data-testid={`auto-install-error-${appId}`}
        className="w-full h-full flex flex-col items-center justify-center p-8 text-center select-none gap-4"
        style={{ background: 'var(--bg-window)', color: 'var(--text-primary)' }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.4)',
          }}
        >
          <AlertCircle size={28} className="text-red-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">
            Couldn't install {catalogEntry.name}
          </h2>
          <p className="text-xs opacity-60 mt-1 max-w-sm">{errorMessage}</p>
        </div>
        <button
          type="button"
          onClick={runInstall}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{
            background: 'rgba(124,77,255,0.18)',
            border: '1px solid rgba(124,77,255,0.45)',
            color: 'var(--text-primary)',
          }}
        >
          {t('common.tryAgain')}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid={`auto-install-progress-${appId}`}
      className="w-full h-full flex flex-col items-center justify-center p-8 text-center select-none gap-4"
      style={{ background: 'var(--bg-window)', color: 'var(--text-primary)' }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{
          background: 'rgba(124,77,255,0.12)',
          border: '1px solid rgba(124,77,255,0.35)',
        }}
      >
        <Loader2 size={28} className="animate-spin" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Installing {catalogEntry.name}…</h2>
        <p className="text-xs opacity-60 mt-1 max-w-sm">
          {catalogEntry.description}
        </p>
      </div>
    </div>
  );
};

function friendlyErrorMessage(err: InstallerError): string {
  switch (err.code) {
    case 'fetch_failed':
      return 'Could not reach the catalog. Check your connection and try again.';
    case 'parse_failed':
      return 'The manifest at the catalog URL was not valid JSON.';
    case 'invalid_manifest':
      return "The app's manifest failed validation.";
    case 'duplicate':
      return 'This app is already installed.';
    case 'bad_transport':
      return "The app's manifest is missing a remote entry URL.";
    default:
      return err.message;
  }
}

export default AutoInstallApp;
