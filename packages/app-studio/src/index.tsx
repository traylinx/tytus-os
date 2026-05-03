/**
 * @tytus/app-studio — Studio workspace package entry.
 *
 * Default export is the boot function the loader calls with AppBootEnv.
 * Returns a React component bound to this app's HostClient + AppDb.
 *
 * Studio's M6.2 spec scope (this PR):
 *   - Multi-block document model (text + media + embedded blocks)
 *   - Block kinds: heading-{1,2,3} | paragraph | bullet | code | image
 *     | embed | separator
 *   - Two-pane editor UI (document list + open-document)
 *   - ⌘K composition command stubs (rewrite / continue / outline)
 *   - Auto-save (debounced text edits, immediate inserts/deletes)
 *
 * Engine integration (rewrite/continue/outline → real Patch.studio.*
 * algebra against the multi-block doc) ships in a follow-up M6.x PR.
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
    return <Studio db={db} host={env.host} />;
  };
}
