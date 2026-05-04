import type { HostClient } from '@tytus/host-api';
import { Eye } from 'lucide-react';

interface Props {
  host: HostClient;
}

export function MarkdownPreviewPlaceholder(_props: Props) {
  return (
    <div
      data-testid="markdown-preview-placeholder"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <Eye size={32} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
        Markdown Preview
      </div>
      <div style={{ fontSize: 12, maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
        Skeleton ready. Phase 5 lifts the legacy preview into this package,
        then carves it into its own git repo for independent development.
      </div>
    </div>
  );
}
