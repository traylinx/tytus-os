import { describe, expect, it } from 'vitest';
import { asSecret } from '@/lib/secrets';
import type { IncludedPod } from '@/types/daemon';
import {
  buildJuli3taGatewayCandidates,
  normalizeAilGatewayUrl,
} from './juli3taGatewayCandidates';

const included = (overrides: Partial<IncludedPod> = {}): IncludedPod => ({
  endpoint: 'http://10.42.42.1:18080',
  kind: 'ail',
  pod_id: '04',
  public_url: 'https://pod-04.tytus.traylinx.com',
  user_key: asSecret('sk-user-secret'),
  ...overrides,
});

describe('JULI3TA gateway candidate building', () => {
  it('normalizes OpenAI-compatible gateway bases to /v1 exactly once', () => {
    expect(normalizeAilGatewayUrl('https://example.com')).toBe('https://example.com/v1');
    expect(normalizeAilGatewayUrl('https://example.com/v1')).toBe('https://example.com/v1');
    expect(normalizeAilGatewayUrl(' https://example.com/v1/ ')).toBe('https://example.com/v1');
    expect(normalizeAilGatewayUrl('')).toBeNull();
  });

  it('tries remote included AIL before tunnel endpoint before local switchAILocal', () => {
    const candidates = buildJuli3taGatewayCandidates([included()]);

    expect(candidates.map((c) => c.url)).toEqual([
      'https://pod-04.tytus.traylinx.com/v1',
      'http://10.42.42.1:18080/v1',
      'http://localhost:18080/v1',
    ]);
    expect(candidates.map((c) => c.podId)).toEqual(['04:remote', '04:tunnel', 'local']);
    expect(candidates[0]?.label).toBe('AIL gateway 04 (remote)');
    expect(candidates[1]?.label).toBe('AIL gateway 04 (tunnel)');
  });

  it('de-duplicates identical public and tunnel gateway URLs', () => {
    const candidates = buildJuli3taGatewayCandidates([
      included({ endpoint: 'https://pod-04.tytus.traylinx.com/v1/' }),
    ]);

    expect(candidates.map((c) => c.url)).toEqual([
      'https://pod-04.tytus.traylinx.com/v1',
      'http://localhost:18080/v1',
    ]);
  });
});
