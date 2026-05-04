import type { HostClient } from '@tytus/host-api';
import { Plug } from 'lucide-react';

interface Props {
  host: HostClient;
}

export function ApiTesterPlaceholder(_props: Props) {
  return (
    <div
      data-testid="api-tester-placeholder"
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
      <Plug size={32} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
        API Tester
      </div>
      <div style={{ fontSize: 12, maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
        Skeleton ready. Phase 5 lifts the legacy tester into this package,
        then carves it into its own git repo for independent development.
      </div>
    </div>
  );
}
