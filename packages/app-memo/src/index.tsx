/**
 * @tytus/app-memo — Memo workspace package entry.
 *
 * Default export is the boot function the loader calls with AppBootEnv.
 * Returns a React component bound to this app's HostClient + AppDb.
 *
 * Memo's M7.2 spec scope (this PR):
 *   - Atomic note model (one row in app_memo_memos = one memo)
 *   - Outliner mode (render-only first cut: Tab/Shift+Tab on the
 *     body textarea adjusts leading whitespace)
 *   - Bidirectional [[wikilink]] resolver — every save re-parses the
 *     body and reconciles app_memo_links rows
 *   - Brain mirror toggle (writes mirror_to_brain bool; engine wiring
 *     for the Brain.append patch lands in M8 PR-M8.x)
 *
 * Migrated from the placeholder boot in M7 PR-M7.1. The legacy
 * in-tree app at app/src/apps/Notes.tsx stays in place for the
 * dual-source transition; a follow-up cleanup PR removes it once the
 * loader-driven boot path verifies end-to-end.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { Memo } from './Memo';

export default function bootMemo(env: AppBootEnv) {
  const db = env.host.storage.current();
  // eslint-disable-next-line react-refresh/only-export-components
  return function MemoApp() {
    return <Memo db={db} host={env.host} />;
  };
}
