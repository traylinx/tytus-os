/**
 * @tytus/app-studio — Studio workspace package entry.
 *
 * Default export is the boot function the loader calls with AppBootEnv.
 * Returns a React component bound to this app's HostClient + AppDb +
 * createSession factory.
 *
 * Studio's M6.x scope adds:
 *   - ⌘K composition commands wired to `createSession({...})` (engine)
 *   - studio.* patch variants flowing through the TransactionRunner
 *   - Apply/Discard ghost preview overlays per staged patch
 *
 * Replaces the legacy in-tree TextEditor + RichEditor + AIWriter triad
 * (Notes already lifted to Memo in W4-C). Legacy apps stay in place
 * for the dual-source transition; the W6 cleanup PR removes them
 * once the loader-driven boot path verifies end-to-end.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { Studio } from './Studio';

export default function bootStudio(env: AppBootEnv) {
  const db = env.host.storage.current();
  // eslint-disable-next-line react-refresh/only-export-components
  return function StudioApp() {
    return (
      <Studio db={db} host={env.host} createSession={env.createSession} />
    );
  };
}
