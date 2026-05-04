/**
 * @tytus/app-markdown-preview — Markdown Preview workspace package entry.
 *
 * Skeleton phase: placeholder component. Phase 5 lifts the legacy
 * `app/src/apps/MarkdownPreview.tsx` source into this package, then
 * carves to its own git repo (`tytus-app-markdown-preview`).
 */

import type { AppBootEnv } from '@tytus/host-api';
import { MarkdownPreviewPlaceholder } from './MarkdownPreviewPlaceholder';

export default function bootMarkdownPreview(env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function MarkdownPreviewApp() {
    return <MarkdownPreviewPlaceholder host={env.host} />;
  };
}
