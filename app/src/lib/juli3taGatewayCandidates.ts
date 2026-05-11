import { revealSecret } from '@/lib/secrets';
import type { IncludedPod } from '@/types/daemon';

export interface Juli3taGatewayCandidate {
  url: string;
  apiKey: string;
  podId: string;
  source: 'included' | 'local';
  label: string;
  /** Same-origin tray proxy pod id. Present for account AIL pods so browser code never calls pod origins directly. */
  proxyPodId?: string;
}

export const LOCAL_AIL_URL = 'http://localhost:18080/v1';
export const LOCAL_AIL_KEY = 'sk-test-123';

const hasV1Suffix = (url: string): boolean => /\/v1\/?$/i.test(url);

type RawIncludedPod = IncludedPod & {
  api_key?: unknown;
  apiKey?: unknown;
  endpoint?: string | null;
  gatewayUrl?: string | null;
  id?: string | null;
  meta?: unknown;
  podId?: string | null;
  pod_id?: string | null;
  private_url?: string | null;
  privateUrl?: string | null;
  public_url?: string | null;
  publicUrl?: string | null;
  user_key?: unknown;
  userKey?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const revealDaemonUserKey = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  const raw = value._value;
  if (typeof raw === 'string') {
    return revealSecret(value as unknown as IncludedPod['user_key'], 'user_gesture');
  }
  return '';
};

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
};

export const normalizeAilGatewayUrl = (raw: string | null | undefined): string | null => {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const withoutSlash = trimmed.replace(/\/+$/, '');
  return hasV1Suffix(withoutSlash) ? withoutSlash : `${withoutSlash}/v1`;
};

const pushUnique = (
  out: Juli3taGatewayCandidate[],
  seenUrls: Set<string>,
  candidate: Juli3taGatewayCandidate,
): void => {
  if (seenUrls.has(candidate.url)) return;
  seenUrls.add(candidate.url);
  out.push(candidate);
};

export const buildJuli3taGatewayCandidates = (
  included: readonly IncludedPod[],
): Juli3taGatewayCandidate[] => {
  const out: Juli3taGatewayCandidate[] = [];
  const seenUrls = new Set<string>();

  // Prefer the user's local switchAILocal first. JULI3TA Restyle/Cover can need
  // gateway-side provider compatibility shims (MiniMax cover preprocessing);
  // the local gateway is the one we can update immediately. Account AIL remains
  // the fallback when local AIL is not running.
  pushUnique(out, seenUrls, {
    url: LOCAL_AIL_URL,
    apiKey: LOCAL_AIL_KEY,
    podId: 'local',
    source: 'local',
    label: 'Local AIL',
  });

  for (const p of included) {
    const rawPod = p as RawIncludedPod;
    const meta = isRecord(rawPod.meta) ? rawPod.meta : {};
    const apiKey = revealDaemonUserKey(
      rawPod.user_key ??
        rawPod.userKey ??
        rawPod.api_key ??
        rawPod.apiKey ??
        meta.userKey ??
        meta.gatewayKey ??
        meta.apiKey ??
        meta.api_key,
    );
    if (!apiKey) continue;
    const podLabel = firstString(rawPod.pod_id, rawPod.podId, rawPod.id) || 'included';

    // Browser users need the remote public mirror when the WireGuard/local
    // AIL address is not reachable from their machine or browser profile.
    // Try the public cloud URL first, then the tunnel endpoint for LAN/WG
    // installs where that path is faster.
    const publicUrl = normalizeAilGatewayUrl(
      firstString(rawPod.public_url, rawPod.publicUrl, rawPod.gatewayUrl, meta.gatewayUrl, meta.publicUrl),
    );
    if (publicUrl) {
      pushUnique(out, seenUrls, {
        url: publicUrl,
        apiKey,
        podId: `${podLabel}:remote`,
        source: 'included',
        label: `AIL gateway ${podLabel} (remote)`,
        proxyPodId: podLabel,
      });
    }

    const tunnelUrl = normalizeAilGatewayUrl(
      firstString(rawPod.endpoint, rawPod.private_url, rawPod.privateUrl, meta.endpoint, meta.privateUrl),
    );
    if (tunnelUrl) {
      pushUnique(out, seenUrls, {
        url: tunnelUrl,
        apiKey,
        podId: `${podLabel}:tunnel`,
        source: 'included',
        label: `AIL gateway ${podLabel} (tunnel)`,
        proxyPodId: podLabel,
      });
    }
  }

  return out;
};
