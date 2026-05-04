/**
 * @tytus/app-markdown-preview — Markdown Preview workspace package entry.
 *
 * Phase 5 lift: source moved from `app/src/apps/MarkdownPreview.tsx`
 * (~210 LOC) into this package. Shell-internal `useFileSystem` hook
 * replaced by `host.fs.ensureUserFolder` + `host.fs.list/createFile/read`.
 * `markdownToHtml` vendored into ./lib/ so the package has zero
 * shell-tree imports.
 *
 * Next move: enable the `markdownpreview → markdown-preview` alias in
 * AppRouter so saved-state callers route here. Then carve to its own
 * git repo (tytus-app-markdown-preview) per SPRINT-TYTUS-APP-SYSTEM-V1.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { MarkdownPreview } from './MarkdownPreview';

export default function bootMarkdownPreview(env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function MarkdownPreviewApp() {
    return <MarkdownPreview host={env.host} />;
  };
}
