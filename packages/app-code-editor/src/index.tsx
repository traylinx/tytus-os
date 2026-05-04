/**
 * @tytus/app-code-editor — Code Editor workspace package entry.
 *
 * Phase 5 lift: source moved from `app/src/apps/CodeEditor.tsx`
 * (~467 LOC) into this package. Shell-internal `useFileSystem` hook
 * replaced by async `host.fs.*` calls (ensureUserFolder + list + read +
 * write + createFile + watch). The inlined FileTree was rewritten to
 * lazy-load each folder via `host.fs.list(parentId)` with a per-id
 * cache and refresh-after-write.
 *
 * Next move: enable the `codeeditor → code-editor` alias in AppRouter
 * so saved-state callers route here. Then carve to its own git repo
 * (tytus-app-code-editor) per SPRINT-TYTUS-APP-SYSTEM-V1.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { CodeEditor } from './CodeEditor';

export default function bootCodeEditor(env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function CodeEditorApp() {
    return <CodeEditor host={env.host} />;
  };
}
