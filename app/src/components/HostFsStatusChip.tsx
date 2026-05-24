// ============================================================
// HostFsStatusChip — daemon FS observability indicator
// ============================================================
//
// Hidden when host.fs is 'ok' or still 'unknown' (boot-time). When the
// daemon FS reports errors via the transport callback in host-fs-daemon,
// host-fs-health flips to 'degraded' or 'offline' and this chip appears
// in the TopPanel right rail.
//
// Click → opens Settings → daemon panel (same target as the daemon
// status pill) so the user has one place to debug.

import { HardDrive } from 'lucide-react';
import { useHostFsHealth } from '@/hooks/useHostFsHealth';
import type { HostFsStatus } from '@/runtime/host-fs-health';

const STATUS_COLOR: Record<HostFsStatus, string> = {
  unknown: '#E0E0E0',
  ok: '#A5D6A7',
  degraded: '#FFE082',
  offline: '#FFCDD2',
};

const STATUS_LABEL: Record<HostFsStatus, string> = {
  unknown: 'FS …',
  ok: 'FS',
  degraded: 'FS degraded',
  offline: 'FS offline',
};

function tooltip(snapshot: ReturnType<typeof useHostFsHealth>): string {
  const lines: string[] = [];
  switch (snapshot.status) {
    case 'unknown':
      lines.push('Daemon FS status not yet checked.');
      break;
    case 'ok':
      lines.push('Daemon FS reachable.');
      break;
    case 'degraded':
      lines.push('Daemon FS recent errors — apps that write to user folders may fail.');
      break;
    case 'offline':
      lines.push('Daemon FS unreachable — working offline; apps cannot read or write user folders.');
      break;
  }
  if (snapshot.lastError) lines.push(`Last error: ${snapshot.lastError}`);
  if (snapshot.fallbackOpsCount > 0) {
    lines.push(`Fallback ops: ${snapshot.fallbackOpsCount}`);
  }
  if (snapshot.lastChecked) {
    const ago = Math.max(0, Math.round((Date.now() - snapshot.lastChecked) / 1000));
    lines.push(`Last probe: ${ago}s ago`);
  }
  return lines.join('\n');
}

export interface HostFsStatusChipProps {
  onClick?: () => void;
}

export function HostFsStatusChip({ onClick }: HostFsStatusChipProps) {
  const snapshot = useHostFsHealth();
  // Hidden when daemon FS is healthy or we haven't checked yet (boot
  // flash avoidance). Only show when there's a problem worth surfacing.
  if (snapshot.status === 'ok' || snapshot.status === 'unknown') {
    return null;
  }

  const color = STATUS_COLOR[snapshot.status];
  const label = STATUS_LABEL[snapshot.status];
  const title = tooltip(snapshot);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid="host-fs-status-chip"
      data-status={snapshot.status}
      className="h-6 px-1.5 rounded-md hover:bg-[var(--chrome-hover)] transition-colors flex items-center gap-1.5"
      style={{ color }}
    >
      <HardDrive size={13} />
      <span className="text-xs font-semibold whitespace-nowrap">{label}</span>
    </button>
  );
}
