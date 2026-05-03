/**
 * @tytus/app-sheet — Sheet workspace package entry.
 *
 * Default export is the boot function the loader calls with AppBootEnv.
 * Returns a React component bound to this app's HostClient + AppDb +
 * (W6 PR-Sheet-Engine) the engine session factory.
 *
 * Migrated from the M4.1 placeholder boot in PR-M4.2 of the apps-platform
 * sprint. The legacy in-tree app at `app/src/apps/Spreadsheet.tsx` stays
 * in place for the dual-source transition; the W6 cleanup PR removes it
 * once the loader-driven boot path verifies end-to-end.
 *
 * Scope progression:
 *   - M4.2: multi-cell grid + CSV import + ⌘K shell-menu stub
 *   - M4.4 (this PR): ⌘K → engine session pipe (modal + banner +
 *     Apply/Discard) wired to the three new sheet-specific tools.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { Sheet } from './Sheet';

export default function bootSheet(env: AppBootEnv) {
  const db = env.host.storage.current();
  // eslint-disable-next-line react-refresh/only-export-components
  return function SheetApp() {
    return <Sheet db={db} host={env.host} createSession={env.createSession} />;
  };
}
