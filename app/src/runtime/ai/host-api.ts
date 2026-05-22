import type {
  AiApi,
  CortexMemoryHit,
  CortexProfile,
  CortexSearchInput,
  DaemonApi,
  Manifest,
} from '@tytus/host-api';
import { PermissionDeniedError } from '@tytus/host-api';
import { getDb } from '@/lib/db';
import { ConversationService } from './conversation-service';

const hasPermission = (manifest: Manifest, permission: string): boolean =>
  (manifest.permissions ?? []).includes(permission as never);

const requirePermission = (manifest: Manifest, appId: string, permission: string): void => {
  if (!hasPermission(manifest, permission)) {
    throw new PermissionDeniedError({
      appId,
      permission,
      message: `App "${appId}" did not declare permission "${permission}".`,
    });
  }
};

export const makeAiApi = (opts: {
  appId: string;
  manifest: Manifest;
  daemon: DaemonApi;
}): AiApi => {
  let service: ConversationService | null = null;
  const getService = (): ConversationService => {
    const db = getDb();
    if (!db) {
      throw new Error('host.ai: SQLite DB not initialized yet. Call initDb() at shell boot or setDbForTesting() in tests.');
    }
    service ??= new ConversationService({ db, daemon: opts.daemon, appId: opts.appId });
    return service;
  };

  return {
    status(signal) {
      return getService().status(signal);
    },
    listModels(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().listModels(input);
    },
    embedText(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().embedText(input);
    },
    listThreads(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().listThreads(input);
    },
    createThread(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().createThread(input);
    },
    updateThread(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().updateThread(input);
    },
    listMessages(threadId) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().listMessages(threadId);
    },
    sendMessage(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().sendMessage(input);
    },
    cancelRun(runId) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().cancelRun(runId);
    },
    deleteThread(threadId) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().deleteThread(threadId);
    },
    searchMemory(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.memory.read');
      return getService().searchMemory(input);
    },
    writeMemory(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.memory.write');
      return getService().writeMemory(input);
    },
    listArtifacts(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.artifacts');
      return getService().listArtifacts(input);
    },
    createArtifact(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.artifacts');
      return getService().createArtifact(input);
    },
    deleteArtifact(artifactId) {
      requirePermission(opts.manifest, opts.appId, 'ai.artifacts');
      return getService().deleteArtifact(artifactId);
    },

    // Local Cortex surface (sprint 2026-05-21-chat-with-pods-local-cortex-parity).
    // Apps that read memory must declare `ai.memory.read` — the same
    // permission that gates `searchMemory`. Both return safe defaults on
    // failure so apps can render without try/catch.
    async cortexProfile(signal) {
      requirePermission(opts.manifest, opts.appId, 'ai.memory.read');
      try {
        const res = await fetch('/api/cortex/status', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          signal,
        });
        if (!res.ok) {
          return { profile: 'cloud', available: false };
        }
        const body = (await res.json()) as {
          profile?: string;
          api_reachable?: boolean;
          local_port?: number;
          local_version_pinned?: string | null;
          internal_service_token_present?: boolean;
        } | null;
        const profile: 'cloud' | 'local' =
          body?.profile === 'local' ? 'local' : 'cloud';
        // "available" === actually routable. Profile=local + reachable +
        // service token present. Anything less, the tray daemon falls back
        // to cloud (see resolve_cortex_upstream); apps should treat
        // available=false as "show a 'fix in Settings' hint".
        const available =
          profile === 'local'
            ? Boolean(
                body?.api_reachable &&
                  body?.internal_service_token_present,
              )
            : true;
        const result: CortexProfile = { profile, available };
        if (typeof body?.local_port === 'number') {
          result.port = body.local_port;
        }
        if (typeof body?.local_version_pinned === 'string') {
          result.cortexVersion = body.local_version_pinned;
        }
        return result;
      } catch {
        return { profile: 'cloud', available: false };
      }
    },

    async cortexSearch(input: CortexSearchInput, signal) {
      requirePermission(opts.manifest, opts.appId, 'ai.memory.read');
      const query = input.query.trim();
      if (!query) return [];
      const payload: Record<string, unknown> = {
        query,
        limit: input.limit ?? 5,
        app_id: input.appId ?? 'tytus-os',
      };
      if (typeof input.minSimilarity === 'number') {
        payload.min_similarity = input.minSimilarity;
      }
      try {
        const res = await fetch('/api/cortex/memory/search', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
          signal,
        });
        if (!res.ok) return [];
        const body = (await res.json()) as {
          results?: Array<{
            id?: string;
            content?: string;
            similarity?: number;
            created_at?: string;
          }>;
        } | null;
        const results = body?.results ?? [];
        return results.flatMap<CortexMemoryHit>((r) => {
          if (
            typeof r.id !== 'string' ||
            typeof r.content !== 'string' ||
            typeof r.similarity !== 'number' ||
            typeof r.created_at !== 'string'
          ) {
            return [];
          }
          return [
            {
              id: r.id,
              content: r.content,
              similarity: r.similarity,
              createdAt: r.created_at,
            },
          ];
        });
      } catch {
        return [];
      }
    },
  };
};
