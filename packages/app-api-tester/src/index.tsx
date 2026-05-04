/**
 * @tytus/app-api-tester — API Tester workspace package entry.
 *
 * Phase 5 lift complete: legacy `app/src/apps/ApiTester.tsx` (~2136
 * LOC) resurrected and refactored onto the host-api surfaces. Sync
 * shell-only hooks (`useCurrentWindowArgs`, `useDaemonStateContext`)
 * and the in-tree `@/lib/repo/api*` modules swapped for:
 *   - `host.windows.current.args` for window-args
 *   - `host.daemon.state.included[0]` + `onStateChange` for the
 *     AIL preset gateway
 *   - `host.storage.current()` AppDb handle (per-app SQLite) for
 *     collections + history (see ./repo)
 *
 * Migrations are declared in tytus-app.json (storage.tables) and live
 * under `migrations/`. We gate first paint on `db.migrate()` so a
 * fresh database cannot render repo calls before its tables exist.
 *
 * Network: `fetch()` is still used directly inside ApiTester (the host
 * api's `daemon.callPodEndpoint` is pod-targeted, not a general
 * proxy). A future host-api bump (`daemon.network.proxyFetch`) should
 * carry that traffic so CORS-blocked endpoints work end-to-end.
 */

import { useEffect, useState } from 'react';
import type { AppBootEnv } from '@tytus/host-api';
import { ApiTester } from './ApiTester';

type MigrationState = { ready: boolean; error: string | null };

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export default function bootApiTester(env: AppBootEnv) {
  const db = env.host.storage.current();
  // eslint-disable-next-line react-refresh/only-export-components
  return function ApiTesterApp() {
    const [state, setState] = useState<MigrationState>({
      ready: false,
      error: null,
    });

    useEffect(() => {
      let alive = true;
      void db
        .migrate('migrations/')
        .then(() => {
          if (alive) setState({ ready: true, error: null });
        })
        .catch((err: unknown) => {
          if (alive) setState({ ready: false, error: errorMessage(err) });
        });
      return () => {
        alive = false;
      };
    }, []);

    if (state.error) {
      return <div role="alert">API Tester failed to initialize: {state.error}</div>;
    }
    if (!state.ready) return <div>Preparing API Tester…</div>;
    return <ApiTester host={env.host} db={db} />;
  };
}
