/**
 * @tytus/app-photo-editor — Photo Editor workspace package entry.
 *
 * Phase 5 lift: source moved verbatim from
 * `app/src/apps/PhotoEditor.tsx` (~342 LOC). Pure DOM/canvas — had
 * zero shell-internal imports — so the lift is a single-file move
 * with an export-shape change.
 *
 * Next move: enable the `photoeditor → photo-editor` alias in
 * AppRouter so saved-state callers route here. Then carve to its own
 * git repo (tytus-app-photo-editor) per SPRINT-TYTUS-APP-SYSTEM-V1.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { PhotoEditor } from './PhotoEditor';

export default function bootPhotoEditor(_env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function PhotoEditorApp() {
    return <PhotoEditor />;
  };
}
