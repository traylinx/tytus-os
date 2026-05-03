/**
 * @tytus/app-studio — Studio workspace package entry. Skeleton in
 * M6 PR-M6.1; the real Studio UI (multi-block document model,
 * embedded structured blocks, ⌘K composition commands) lifts in
 * PR-M6.2+.
 *
 * Studio's M6 spec scope per the milestones doc:
 *   - Multi-block document model (text + media + embedded blocks)
 *   - ⌘K composition commands (rewrite / continue / outline)
 *   - Engine integration: textRead + textPatch + fileRefRead +
 *     webFetch tools at createSession
 *   - Replaces TextEditor + RichEditor + Notes + AIWriter (4 → 1)
 *
 * The placeholder boot keeps the loader path live so end-to-end
 * mount + manifest validation works today; subsequent sub-PRs
 * lift the actual UI on top.
 */

import type { AppBootEnv } from '@tytus/host-api';

export default function bootStudio(env: AppBootEnv) {
  void env;
  // eslint-disable-next-line react-refresh/only-export-components
  return function StudioPlaceholder() {
    return {
      __tytus_placeholder: true,
      message:
        'Studio extraction in progress (M6 PR-M6.2+). Manifest + migrations + workspace package landed; multi-block document UI + ⌘K composition commands lift in subsequent sub-PRs.',
    };
  };
}
