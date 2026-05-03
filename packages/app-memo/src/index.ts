/**
 * @tytus/app-memo — Memo workspace package entry. Skeleton in
 * M7 PR-M7.1; the real Memo UI (atomic notes + outliner mode +
 * [[wikilink]] resolution + Brain append on save) lifts in
 * PR-M7.2+.
 *
 * Memo's M7 spec scope per the milestones doc:
 *   - Atomic note model (one note = one .tytus-memo.json file)
 *   - Outliner mode with bullet hierarchy + indent/outdent
 *   - Bidirectional [[wikilink]] resolution against app_memo_links
 *   - Brain bridge: optional `mirror to Brain` toggle per memo,
 *     emits a brain.append patch on save (M8 endpoint)
 *   - Engine integration: textRead + textPatch + brainSearch +
 *     fileRefRead tools at createSession
 *
 * The placeholder boot keeps the loader path live so end-to-end
 * mount + manifest validation works today; subsequent sub-PRs
 * lift the actual note model + link resolver.
 */

import type { AppBootEnv } from '@tytus/host-api';

export default function bootMemo(env: AppBootEnv) {
  void env;
  // eslint-disable-next-line react-refresh/only-export-components
  return function MemoPlaceholder() {
    return {
      __tytus_placeholder: true,
      message:
        'Memo extraction in progress (M7 PR-M7.2+). Manifest + migrations + workspace package landed; atomic note model + [[wikilink]] resolver + Brain bridge lift in subsequent sub-PRs.',
    };
  };
}
