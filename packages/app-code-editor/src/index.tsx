/**
 * @tytus/app-code-editor — Code Editor workspace package entry.
 *
 * Skeleton phase: placeholder. Phase 5 lifts the legacy
 * `app/src/apps/CodeEditor.tsx` source into this package, then carves
 * to its own git repo (`tytus-app-code-editor`).
 */

import type { AppBootEnv } from '@tytus/host-api';
import { CodeEditorPlaceholder } from './CodeEditorPlaceholder';

export default function bootCodeEditor(env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function CodeEditorApp() {
    return <CodeEditorPlaceholder host={env.host} />;
  };
}
