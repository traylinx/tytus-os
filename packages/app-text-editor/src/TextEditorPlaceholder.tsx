import type { HostClient } from '@tytus/host-api';
import { FileText } from 'lucide-react';

interface Props {
  host: HostClient;
}

export function TextEditorPlaceholder(_props: Props) {
  return (
    <div
      data-testid="text-editor-placeholder"
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
      <FileText size={32} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
        Text Editor
      </div>
      <div style={{ fontSize: 12, maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
        Skeleton ready. Phase 5 of SPRINT-TYTUS-APP-SYSTEM-V1 will lift the
        legacy editor source from W7-deleted history into this package, then
        carve it into its own git repo for independent development.
      </div>
    </div>
  );
}
