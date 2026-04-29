// Shown by Image / Document / Archive viewers at the top of their
// pane when launched via Files → "Open with…". Holds a file-name
// pill + a "(remote pod content not yet rendered)" caveat — Phase 7
// cont gives the user the affordance, the actual remote-file fetch
// is a follow-on (manifest A.exist A7.x).

import type { FC } from 'react';
import { Paperclip } from 'lucide-react';

interface Props {
  file: string;
  podId?: string;
  /** Verb shown in the banner (e.g. "Image Viewer"). */
  appName: string;
}

const OpenedFileBanner: FC<Props> = ({ file, podId, appName }) => (
  <div
    role="status"
    className="px-4 py-2 flex items-center gap-2 text-[11px]"
    style={{
      background: 'rgba(124,77,255,0.10)',
      borderBottom: '1px solid rgba(124,77,255,0.25)',
      color: 'var(--text-primary)',
    }}
  >
    <Paperclip size={12} className="shrink-0" />
    <span>
      <span className="font-semibold">{appName}</span>
      {' opened from Files: '}
      <code className="font-mono">{file}</code>
      {podId && (
        <>
          {' on pod '}
          <code className="font-mono">{podId}</code>
        </>
      )}
      <span className="opacity-70">
        {' '}— remote pod file content is not yet streamed inline; the demo
        view below is a placeholder.
      </span>
    </span>
  </div>
);

export default OpenedFileBanner;
