import { revealSecret } from '@/lib/secrets';
import type { IncludedPod } from '@/types/daemon';

export interface Juli3taGatewayCandidate {
  url: string;
  apiKey: string;
  podId: string;
  source: 'included' | 'local';
  label: string;
}

export const LOCAL_AIL_URL = 'http://localhost:18080/v1';
export const LOCAL_AIL_KEY = 'sk-test-123';

const hasV1Suffix = (url: string): boolean => /\/v1\/?$/i.test(url);

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

  for (const p of included) {
    const apiKey = revealSecret(p.user_key, 'user_gesture');
    const podLabel = p.pod_id || 'included';

    // Browser users need the remote public mirror when the WireGuard/local
    // AIL address is not reachable from their machine or browser profile.
    // Try the public cloud URL first, then the tunnel endpoint for LAN/WG
    // installs where that path is faster.
    const publicUrl = normalizeAilGatewayUrl(p.public_url);
    if (publicUrl) {
      pushUnique(out, seenUrls, {
        url: publicUrl,
        apiKey,
        podId: `${podLabel}:remote`,
        source: 'included',
        label: `AIL gateway ${podLabel} (remote)`,
      });
    }

    const tunnelUrl = normalizeAilGatewayUrl(p.endpoint);
    if (tunnelUrl) {
      pushUnique(out, seenUrls, {
        url: tunnelUrl,
        apiKey,
        podId: `${podLabel}:tunnel`,
        source: 'included',
        label: `AIL gateway ${podLabel} (tunnel)`,
      });
    }
  }

  pushUnique(out, seenUrls, {
    url: LOCAL_AIL_URL,
    apiKey: LOCAL_AIL_KEY,
    podId: 'local',
    source: 'local',
    label: 'Local AIL',
  });

  return out;
};
