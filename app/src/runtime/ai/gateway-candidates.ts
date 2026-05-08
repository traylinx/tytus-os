import type { DaemonApi, Pod } from '@tytus/host-api';

export const LOCAL_AIL_URL = 'http://localhost:18080/v1';
export const LOCAL_AIL_KEY = 'sk-test-123';

export interface GatewayCandidate {
  id: string;
  source: 'included' | 'tunnel' | 'local';
  label: string;
  baseUrl: string;
  podId?: string;
  apiKey?: string;
  callViaHost: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

export const normalizeGatewayUrl = (raw: string | null | undefined): string | null => {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const root = trimmed.replace(/\/+$/, '');
  return /\/v1$/i.test(root) ? root : `${root}/v1`;
};

const metaOf = (pod: Pod): Record<string, unknown> =>
  isRecord(pod.meta) ? pod.meta : {};

const apiKeyOf = (pod: Pod): string | null => {
  const meta = metaOf(pod);
  return firstString(meta.gatewayKey, meta.userKey, meta.apiKey, meta.api_key);
};

const pushUnique = (
  out: GatewayCandidate[],
  seen: Set<string>,
  candidate: GatewayCandidate,
): void => {
  const key = `${candidate.source}:${candidate.baseUrl}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(candidate);
};

export const buildGatewayCandidates = (daemon: DaemonApi): GatewayCandidate[] => {
  const out: GatewayCandidate[] = [];
  const seen = new Set<string>();

  for (const pod of daemon.state.included ?? []) {
    if (pod.kind && pod.kind !== 'ail') continue;
    const meta = metaOf(pod);
    const publicUrl = normalizeGatewayUrl(
      firstString(meta.gatewayUrl, meta.publicUrl, pod.publicUrl),
    );
    if (publicUrl && pod.publicUrl) {
      pushUnique(out, seen, {
        id: `${pod.id}:remote`,
        source: 'included',
        label: `AIL gateway ${pod.id} (remote)`,
        baseUrl: publicUrl,
        podId: pod.id,
        callViaHost: true,
      });
    }

    const tunnelUrl = normalizeGatewayUrl(firstString(meta.endpoint, meta.privateUrl));
    const apiKey = apiKeyOf(pod);
    if (tunnelUrl && apiKey) {
      pushUnique(out, seen, {
        id: `${pod.id}:tunnel`,
        source: 'tunnel',
        label: `AIL gateway ${pod.id} (tunnel)`,
        baseUrl: tunnelUrl,
        apiKey,
        callViaHost: false,
      });
    }
  }

  pushUnique(out, seen, {
    id: 'local',
    source: 'local',
    label: 'Local AIL',
    baseUrl: LOCAL_AIL_URL,
    apiKey: LOCAL_AIL_KEY,
    callViaHost: false,
  });

  return out;
};
