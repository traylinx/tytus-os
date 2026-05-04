/**
 * @tytus/app-text-editor — Text Editor workspace package entry.
 *
 * Phase 5 lift complete: legacy `app/src/apps/TextEditor.tsx` (542 LOC,
 * deleted in W7 commit a359db8) resurrected and refactored onto the
 * host-api FsApi. Sync `useFileSystem` hook + sync `readFile` /
 * `writeFile` / `createFile` swapped for async `host.fs.{read, write,
 * createFile, ensureUserFolder, list, getNodeById, getIconForFileName}`.
 * Window args read via `host.windows.current.args` instead of the
 * shell-only `useCurrentWindowArgs` hook.
 *
 * Next move: enable the `texteditor → text-editor` alias in
 * AppRouter.tsx so saved-state callers route here, then carve to its
 * own git repo (tytus-app-text-editor).
 */

import type { AppBootEnv } from '@tytus/host-api';
import { TextEditor } from './TextEditor';

export default function bootTextEditor(env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function TextEditorApp() {
    return <TextEditor host={env.host} />;
  };
}
