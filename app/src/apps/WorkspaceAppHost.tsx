/**
 * WorkspaceAppHost — renders an `installed_apps` row by mounting the
 * workspace package its `entry_url` points at.
 *
 * Boundary responsibilities (W5 PR-DynLoader / M3.6):
 *   1. Look up the row by appId via the live SQLite DB.
 *   2. Hand the row to `loadAppById` from `runtime/dynamic-loader.ts`,
 *      which resolves entryUrl → dynamic import → bootApp(env) →
 *      Component.
 *   3. Render the returned Component inside a Suspense + error
 *      boundary so a failed import (network drop, missing default
 *      export, exception inside bootApp) shows a recoverable error
 *      card instead of crashing the shell.
 *
 * AppRouter consults this component for any appId whose `installed_apps`
 * row has a non-null entryUrl. Legacy in-tree apps still resolve via
 * the static `switch(appId)` fallback.
 */

import {
  Component,
  type ErrorInfo,
  type FC,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import { getDb } from '@/lib/db';
import {
  AppLoadError,
  loadAppById,
  type LoadedApp,
} from '@/runtime/dynamic-loader';

interface WorkspaceAppHostProps {
  appId: string;
}

/**
 * React error boundary for in-app failures that escape the
 * dynamic-loader's normalisation (e.g. an effect inside the mounted
 * Component throws asynchronously). Pairs with the load-time error
 * surface below — between them, the shell never tears down because
 * one app misbehaved.
 */
class AppErrorBoundary extends Component<
  { appId: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to console so dev devtools see the stack; the user-facing
    // card in render() stays compact.
    console.error('[WorkspaceAppHost] uncaught render error', {
      appId: this.props.appId,
      error,
      info,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorCard
          appId={this.props.appId}
          message={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}

const ErrorCard: FC<{ appId: string; message: string }> = ({
  appId,
  message,
}) => (
  <div
    data-testid={`workspace-app-error-${appId}`}
    className="w-full h-full flex flex-col items-center justify-center p-8 text-center select-none"
    style={{ background: 'var(--bg-window)', color: 'var(--text-primary)' }}
  >
    <div
      className="w-14 h-14 rounded-2xl mb-4 flex items-center justify-center"
      style={{
        background: 'rgba(255,99,99,0.12)',
        border: '1px solid rgba(255,99,99,0.35)',
      }}
    >
      <AlertCircle size={28} style={{ color: 'var(--accent-error)' }} />
    </div>
    <h2 className="text-base font-semibold mb-1">Couldn’t open {appId}</h2>
    <p
      className="text-xs opacity-60 max-w-sm"
      style={{ wordBreak: 'break-word' }}
    >
      {message}
    </p>
  </div>
);

const LoadingCard: FC<{ appId: string }> = ({ appId }) => (
  <div
    data-testid={`workspace-app-loading-${appId}`}
    className="w-full h-full flex items-center justify-center"
    style={{ background: 'var(--bg-window)' }}
  >
    <div className="flex flex-col items-center gap-3">
      <Loader2
        size={28}
        className="animate-spin"
        style={{ color: 'var(--accent-primary)' }}
      />
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        Loading {appId}…
      </span>
    </div>
  </div>
);

/**
 * Hook-based loader. Triggers `loadAppById` on mount and re-runs when
 * `appId` changes. State machine: `loading` → `ready` | `error`.
 *
 * We intentionally NOT use React.lazy + import() here — lazy ties the
 * import promise to module identity, but our entry URL is dynamic
 * (resolved through the dynamic-loader's table lookup). A hook gives
 * us the explicit loading + error states the AppRouter needs.
 */
function useLoadedApp(appId: string): {
  loaded: LoadedApp | null;
  error: Error | null;
} {
  const [state, setState] = useState<{
    loaded: LoadedApp | null;
    error: Error | null;
  }>({ loaded: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loaded: null, error: null });

    const run = async () => {
      try {
        const db = getDb();
        if (!db) {
          throw new AppLoadError(
            appId,
            'SQLite DB not initialized. Boot has not completed.',
          );
        }
        const loaded = await loadAppById(appId, db);
        if (cancelled) return;
        setState({ loaded, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          loaded: null,
          error:
            err instanceof Error ? err : new Error(String(err)),
        });
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [appId]);

  return state;
}

const WorkspaceAppHost: FC<WorkspaceAppHostProps> = ({ appId }) => {
  const { loaded, error } = useLoadedApp(appId);

  if (error) {
    return <ErrorCard appId={appId} message={error.message} />;
  }

  if (!loaded) {
    return <LoadingCard appId={appId} />;
  }

  const App = loaded.Component;
  return (
    <AppErrorBoundary appId={appId}>
      <Suspense fallback={<LoadingCard appId={appId} />}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  );
};

export default WorkspaceAppHost;
