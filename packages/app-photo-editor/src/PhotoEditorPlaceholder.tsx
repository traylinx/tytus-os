import type { HostClient } from '@tytus/host-api';
import { Image as ImageIcon } from 'lucide-react';

interface Props {
  host: HostClient;
}

export function PhotoEditorPlaceholder(_props: Props) {
  return (
    <div
      data-testid="photo-editor-placeholder"
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
      <ImageIcon size={32} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
        Photo Editor
      </div>
      <div style={{ fontSize: 12, maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
        Skeleton ready. Phase 5 lifts the legacy editor into this package,
        then carves it into its own git repo for independent development.
      </div>
    </div>
  );
}
