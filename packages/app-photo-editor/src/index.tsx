/**
 * @tytus/app-photo-editor — Photo Editor workspace package entry.
 *
 * Skeleton phase: placeholder. Phase 5 lifts the legacy
 * `app/src/apps/PhotoEditor.tsx` source into this package, then carves
 * to its own git repo (`tytus-app-photo-editor`).
 */

import type { AppBootEnv } from '@tytus/host-api';
import { PhotoEditorPlaceholder } from './PhotoEditorPlaceholder';

export default function bootPhotoEditor(env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function PhotoEditorApp() {
    return <PhotoEditorPlaceholder host={env.host} />;
  };
}
