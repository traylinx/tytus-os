/**
 * Router — pod-only model resolution in v1.
 *
 * Lifts the gateway-resolution pattern from Music Creator's existing
 * code into the engine workspace package. The contract is opinionated:
 * - Production resolves through `host.daemon` pod state.
 * - No public-provider fallback in v1. If no pod is reachable, the
 *   engine enters degraded mode (Session.status === 'degraded') and
 *   every send/ghostRequest yields an `error { errorKind: 'pod_offline' }`.
 *
 * M3 reconciles this with Music Creator's own gateway dial when the
 * music suite extracts; until then the contract is enforced and the
 * stub picks the first running pod.
 */

import type { HostClient } from '@tytus/host-api';

export interface Endpoint {
  url: string;
  key: string;
  source: 'pod';
  /** The resolved pod id — useful for telemetry + status display. */
  podId: string;
}

export interface ModelInfo {
  id: string;
  /** 'chat' for token streaming, 'embed' for embeddings. */
  kind: 'chat' | 'embed';
  /** Approximate context-window size in tokens. */
  contextWindow?: number;
  /** True if the model supports OpenAI-shape tool calls. */
  supportsTools?: boolean;
}

export class PodOfflineError extends Error {
  readonly errorKind = 'pod_offline' as const;
  constructor(message = 'No reachable pod for AI requests.') {
    super(message);
    this.name = 'PodOfflineError';
  }
}

/**
 * Resolve the gateway endpoint for the active pod. Throws PodOfflineError
 * when no pod is reachable. The shell catches this and shows the
 * "Pod offline" banner.
 *
 * Pod selection rule: first pod whose status is 'running'. Ties broken
 * by id-alphabetical so the choice is stable. The Settings → AI panel
 * (M5+) lets the user pin a specific pod if multiple are running.
 */
export function resolveEndpoint(host: HostClient): Endpoint {
  const pods = host.daemon.state.included;
  const running = pods
    .filter((p) => p.status === 'running')
    .sort((a, b) => a.id.localeCompare(b.id));
  const chosen = running[0];
  if (!chosen) {
    throw new PodOfflineError(
      pods.length === 0
        ? 'No pods registered. Connect a pod in Settings → Pods.'
        : `No running pod (saw ${pods.length} pods, all offline).`,
    );
  }
  // The pod's exposed gateway URL + key live on its meta blob — the
  // exact shape comes from useDaemonStateContext today; we read it
  // permissively so the engine survives meta-shape evolution.
  const meta = (chosen.meta ?? {}) as {
    gatewayUrl?: string;
    gatewayKey?: string;
  };
  if (!meta.gatewayUrl || !meta.gatewayKey) {
    throw new PodOfflineError(
      `Pod ${chosen.id} is running but no gateway URL/key on its meta. Pod readiness check may not have completed.`,
    );
  }
  return {
    url: meta.gatewayUrl,
    key: meta.gatewayKey,
    source: 'pod',
    podId: chosen.id,
  };
}

/**
 * Probe the pod's `/v1/models` endpoint and return the available models.
 * The fetch is delegated through `host.daemon.callPodEndpoint` so the
 * engine doesn't have to hold the gateway key directly.
 */
export async function discoverModels(
  endpoint: Endpoint,
  host: HostClient,
  opts: { signal?: AbortSignal } = {},
): Promise<ModelInfo[]> {
  const res = await host.daemon.callPodEndpoint(endpoint.podId, '/v1/models', {
    method: 'GET',
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new PodOfflineError(
      `discoverModels: ${endpoint.podId} returned ${res.status}`,
    );
  }
  const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
  if (!body.data || !Array.isArray(body.data)) {
    return [];
  }
  return body.data.flatMap((m): ModelInfo[] => {
    if (typeof m.id !== 'string') return [];
    const id = m.id;
    // Heuristic kind classification — gateway's catalog is the canonical
    // truth, but the wire response often includes hints.
    const kind: ModelInfo['kind'] =
      typeof m.kind === 'string' && m.kind === 'embed' ? 'embed' : 'chat';
    const contextWindow =
      typeof m.context_window === 'number' ? m.context_window : undefined;
    const supportsTools =
      m.supports_tools === undefined ? undefined : Boolean(m.supports_tools);
    return [{ id, kind, contextWindow, supportsTools }];
  });
}

/**
 * Pick a model from the discovered set. The "best" model for a kind is
 * deterministic: highest context window first, then alphabetical id.
 * Apps can override later via Settings → AI → Default Model (M8+).
 */
export function pickModel(
  models: ModelInfo[],
  kind: 'chat' | 'embed',
): ModelInfo | null {
  const eligible = models.filter((m) => m.kind === kind);
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => {
    const aw = a.contextWindow ?? 0;
    const bw = b.contextWindow ?? 0;
    if (aw !== bw) return bw - aw;
    return a.id.localeCompare(b.id);
  })[0];
}
