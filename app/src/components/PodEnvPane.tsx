import { useCallback, useEffect, useState } from 'react';
import type { FC } from 'react';
import type { DaemonClient } from '@/lib/daemon';
import type { PodEnv, PodEnvVar, Tier } from '@/types/daemon';
import { Eye, EyeOff, RefreshCw, X } from 'lucide-react';

interface Props {
  client: DaemonClient;
  podId: string;
  tier: Tier;
  onClose: () => void;
  onError: (msg: string) => void;
}

const SOURCE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  runtime:           { bg: 'rgba(33,150,243,0.10)',  fg: '#90CAF9', border: 'rgba(33,150,243,0.30)' },
  agent_default:     { bg: 'rgba(158,158,158,0.10)', fg: '#BDBDBD', border: 'rgba(158,158,158,0.30)' },
  channels:          { bg: 'rgba(76,175,80,0.10)',   fg: '#A5D6A7', border: 'rgba(76,175,80,0.30)' },
  operator_override: { bg: 'rgba(255,152,0,0.10)',   fg: '#FFCC80', border: 'rgba(255,152,0,0.30)' },
};

const sourceColor = (s: string | undefined) =>
  SOURCE_COLORS[s || ''] || { bg: 'rgba(255,255,255,0.04)', fg: '#9E9E9E', border: 'rgba(255,255,255,0.10)' };

const sourceLabel = (s: string | undefined) => s || 'unknown';

const PodEnvPane: FC<Props> = ({ client, podId, tier, onClose, onError }) => {
  const [env, setEnv] = useState<PodEnv | null>(null);
  const [loading, setLoading] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [filter, setFilter] = useState('');

  const fetchEnv = useCallback(
    async (revealSecrets: boolean) => {
      setLoading(true);
      const r = await client.getPodEnv(podId, revealSecrets);
      setLoading(false);
      if (!r.ok) {
        if (r.error.status === 403) {
          // Plan tier below Operator. Roll back the reveal toggle and
          // surface a friendly nudge — not a generic error toast.
          setReveal(false);
          onError(
            'Revealing secrets requires the Operator plan tier. Showing redacted values.',
          );
          // Refetch redacted so the pane isn't blank.
          const rr = await client.getPodEnv(podId, false);
          if (rr.ok) setEnv(rr.value);
          return;
        }
        onError(`Couldn't load pod env: ${r.error.message}`);
        return;
      }
      setEnv(r.value);
    },
    [client, podId, onError],
  );

  useEffect(() => {
    void fetchEnv(false);
  }, [fetchEnv]);

  const onToggleReveal = useCallback(async () => {
    if (tier !== 'operator') {
      onError('Reveal requires the Operator plan.');
      return;
    }
    const next = !reveal;
    setReveal(next);
    await fetchEnv(next);
  }, [reveal, tier, fetchEnv, onError]);

  const onRefresh = useCallback(() => {
    void fetchEnv(reveal);
  }, [fetchEnv, reveal]);

  const filteredVars: PodEnvVar[] = (() => {
    if (!env) return [];
    if (!filter.trim()) return env.vars;
    const q = filter.toLowerCase();
    return env.vars.filter((v) => v.key.toLowerCase().includes(q));
  })();

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: '#0A0A0A', border: '1px solid var(--border-subtle)' }}
    >
      <div
        className="px-3 py-2 flex items-center gap-2 text-[11px]"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="text-[var(--text-secondary)]">
          Env (pod {podId}){env?.agent_type ? ` · ${env.agent_type}` : ''} ·{' '}
          <span style={{ color: '#BDBDBD' }}>
            {env ? `${env.vars.length} variable${env.vars.length === 1 ? '' : 's'}` : '…'}
          </span>
        </div>
        <input
          aria-label="Filter env keys"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="ml-auto px-2 py-0.5 rounded-sm text-[10px]"
          style={{
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            width: 110,
          }}
        />
        <button
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh env"
          className="px-2 py-0.5 rounded-sm text-[10px] flex items-center gap-1 disabled:opacity-60"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
          }}
        >
          <RefreshCw size={10} /> Refresh
        </button>
        <button
          onClick={onToggleReveal}
          disabled={loading || tier !== 'operator'}
          title={
            tier !== 'operator'
              ? 'Revealing secrets requires the Operator plan tier'
              : reveal
                ? 'Hide secret values'
                : 'Show secret values (Operator tier)'
          }
          className="px-2 py-0.5 rounded-sm text-[10px] flex items-center gap-1 disabled:opacity-60"
          style={{
            background: reveal ? 'rgba(255,193,7,0.10)' : 'var(--bg-hover, rgba(255,255,255,0.04))',
            color: reveal ? '#FFE082' : 'var(--text-secondary)',
            border: `1px solid ${reveal ? 'rgba(255,193,7,0.30)' : 'var(--border-default)'}`,
          }}
        >
          {reveal ? <EyeOff size={10} /> : <Eye size={10} />}
          {reveal ? 'Hide secrets' : 'Reveal secrets'}
        </button>
        <button
          onClick={onClose}
          aria-label="Close env pane"
          className="px-2 py-0.5 rounded-sm text-[10px] transition-colors"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
          }}
        >
          <X size={10} />
        </button>
      </div>
      <div
        className="font-mono text-[11px] overflow-y-auto custom-scrollbar"
        style={{ maxHeight: 360 }}
      >
        {loading && !env ? (
          <div className="px-3 py-4 text-[var(--text-tertiary)]">Loading…</div>
        ) : filteredVars.length === 0 ? (
          <div className="px-3 py-4 text-[var(--text-tertiary)]">
            {env ? 'No matching env vars.' : 'No env data.'}
          </div>
        ) : (
          <table className="w-full">
            <tbody>
              {filteredVars.map((v) => {
                const c = sourceColor(v.source);
                return (
                  <tr
                    key={v.key}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <td className="px-2 py-1 align-top whitespace-nowrap">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider"
                        style={{
                          background: c.bg,
                          color: c.fg,
                          border: `1px solid ${c.border}`,
                        }}
                      >
                        {sourceLabel(v.source)}
                      </span>
                    </td>
                    <td
                      className="px-2 py-1 align-top whitespace-nowrap"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {v.key}
                    </td>
                    <td
                      className="px-2 py-1 align-top break-all"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {v.value}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PodEnvPane;
