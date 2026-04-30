import type { ReactNode } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { JobStatus } from '@/hooks/useJobStream';

export interface LogPaneProps {
  lines: string[];
  status?: JobStatus;
  exitCode?: number | null;
  failMessage?: string | null;
  title?: string;
  emptyText?: string;
  maxLines?: number;
  maxHeight?: number | string;
  minHeight?: number | string;
  filterBlank?: boolean;
  className?: string;
  children?: ReactNode;
}

const statusColor = (status?: JobStatus): string => {
  if (status === 'success') return 'var(--terminal-success, #A5D6A7)';
  if (status === 'failed') return 'var(--terminal-error, #FF8A80)';
  if (status === 'lost') return 'var(--terminal-warning, #FFB74D)';
  return 'var(--text-secondary)';
};

const statusIcon = (status?: JobStatus) => {
  if (status === 'streaming' || status === 'subscribing') {
    return <Loader2 size={11} className="animate-spin text-[var(--accent-primary)]" />;
  }
  if (status === 'success') return <Check size={11} style={{ color: statusColor(status) }} />;
  if (status === 'failed' || status === 'lost') {
    return <AlertTriangle size={11} style={{ color: statusColor(status) }} />;
  }
  return null;
};

const LogPane = ({
  lines,
  status,
  exitCode = null,
  failMessage = null,
  title,
  emptyText = 'Waiting for output…',
  maxLines = 500,
  maxHeight = 300,
  minHeight,
  filterBlank = false,
  className = '',
  children,
}: LogPaneProps) => {
  const visibleLines = (filterBlank ? lines.filter((line) => line.trim().length > 0) : lines).slice(-maxLines);
  const content = visibleLines.length > 0 ? visibleLines.join('\n') : emptyText;
  const color = statusColor(status);
  const showHeader = title || status || exitCode !== null || failMessage;

  return (
    <div
      className={`rounded-lg overflow-hidden ${className}`}
      style={{
        background: 'var(--terminal-bg, #0A0A0A)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {showHeader && (
        <div
          className="px-3 py-2 flex items-center gap-2 text-[11px]"
          style={{
            background: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {statusIcon(status)}
          <span className="text-[var(--text-secondary)] truncate">
            {title ?? 'Log'}
            {status && (
              <>
                {' · '}
                <span style={{ color }}>
                  {status}
                  {exitCode !== null && ` (exit ${exitCode})`}
                </span>
              </>
            )}
          </span>
          {failMessage && (
            <span className="ml-auto truncate" style={{ color }} title={failMessage}>
              {failMessage}
            </span>
          )}
        </div>
      )}
      <pre
        className="m-0 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap overflow-auto"
        style={{ color: 'var(--terminal-text, #E0E0E0)', maxHeight, minHeight }}
      >
        {content}
      </pre>
      {children && (
        <div className="px-3 pb-3 font-mono text-[11px] leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
};

export default LogPane;
