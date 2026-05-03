/**
 * @tytus/app-sheet — Sheet workspace package entry. Skeleton in
 * M4 PR-M4.1; the real Sheet UI (CSV import, grid editor, ⌘K
 * "Add a column for X" command, transaction-modal diff overlay)
 * lifts in PR-M4.2+.
 *
 * Sheet's M4 spec scope is intentionally narrow per the milestones
 * doc:
 *   - ONE ⌘K command: "Add a column for X"
 *   - localStorage → host.fs migration with backup pass
 *   - Engine integration: cellReadRange + cellReadSheet + cellFormula
 *     + fileRefRead + webFetch tools at createSession
 *   - Pod-offline: every legacy Spreadsheet feature still works
 *
 * The placeholder boot keeps the loader path live so end-to-end
 * mount + manifest validation works today; subsequent sub-PRs
 * lift the actual UI on top.
 */

import type { AppBootEnv } from '@tytus/host-api';

export default function bootSheet(env: AppBootEnv) {
  void env;
  // eslint-disable-next-line react-refresh/only-export-components
  return function SheetPlaceholder() {
    return {
      __tytus_placeholder: true,
      message:
        'Sheet extraction in progress (M4 PR-M4.2+). Manifest + migrations + workspace package landed; UI + ⌘K wedge lifts in subsequent sub-PRs.',
    };
  };
}
