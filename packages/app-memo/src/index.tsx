/**
 * @tytus/app-memo — Memo workspace package entry.
 *
 * Default export is the boot function the loader calls with AppBootEnv.
 * Returns a React component bound to this app's HostClient + AppDb.
 *
 * Memo's M7.x scope (current PR — W5 Memo-Brain bridge):
 *   - Atomic note model (one row in app_memo_memos = one memo)
 *   - Outliner mode (render-only first cut: Tab/Shift+Tab on the
 *     body textarea adjusts leading whitespace)
 *   - Bidirectional [[wikilink]] resolver — every save re-parses the
 *     body and reconciles app_memo_links rows
 *   - Brain mirror toggle wired to the W4-shipped @tytus/host-api
 *     daemon clients: saves with mirror_to_brain=true POST a
 *     Logseq-outliner-formatted entry to /api/brain/append; the editor
 *     surfaces "Brain backlinks" — a search of the Brain for the
 *     memo's [[slug]].
 *
 * The bridge is constructed ONCE at boot via createBrainBridge so the
 * editor doesn't pay the cost of re-creating the daemon client per
 * render. baseUrl is the empty string `''` because createDaemonClient
 * already prepends `/api/...` to every path — see the note in
 * lib/brainBridge.ts.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { Memo } from './Memo';
import { createBrainBridge } from './lib/brainBridge';

export default function bootMemo(env: AppBootEnv) {
  const db = env.host.storage.current();
  // Same-origin in the Tytus shell — Vite proxies /api/* to the
  // tytus-cli daemon (see app/vite.config.ts daemonProxyPlugin).
  const brain = createBrainBridge({ baseUrl: '' });
  // eslint-disable-next-line react-refresh/only-export-components
  return function MemoApp() {
    return <Memo db={db} host={env.host} brain={brain} />;
  };
}
