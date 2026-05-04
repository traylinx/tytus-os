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
 * under `migrations/`. We call `db.migrate('migrations/')` once at boot
 * so the per-app `app_api_tester_*` tables exist before the React tree
 * starts issuing queries.
 *
 * Network: `fetch()` is still used directly inside ApiTester (the host
 * api's `daemon.callPodEndpoint` is pod-targeted, not a general
 * proxy). A future host-api bump (`daemon.network.proxyFetch`) should
 * carry that traffic so CORS-blocked endpoints work end-to-end.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { ApiTester } from './ApiTester';

export default function bootApiTester(env: AppBootEnv) {
  const db = env.host.storage.current();
  // Fire-and-forget: the migration runner is idempotent (it tracks
  // applied names in `<sqlAppId>__migrations`), so reloads are safe.
  // The repo functions tolerate the brief window before the schema is
  // up — listCollections/listHistory just return [] on error.
  void db.migrate('migrations/');
  // eslint-disable-next-line react-refresh/only-export-components
  return function ApiTesterApp() {
    return <ApiTester host={env.host} db={db} />;
  };
}
