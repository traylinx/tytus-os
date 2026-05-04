/**
 * @tytus/app-text-editor — Text Editor workspace package entry.
 *
 * Skeleton phase: returns a placeholder component. The Phase 5 lift
 * resurrects the legacy `app/src/apps/TextEditor.tsx` source (542 LOC,
 * deleted in W7 commit a359db8) and wraps its file-system / window
 * bindings around `env.host.fs` + `env.host.windows.current()`.
 *
 * After the lift this package gets carved out to its own git repo
 * (`tytus-app-text-editor`) and consumed via filesystem install +
 * App Store registration.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { TextEditorPlaceholder } from './TextEditorPlaceholder';

export default function bootTextEditor(env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function TextEditorApp() {
    return <TextEditorPlaceholder host={env.host} />;
  };
}
