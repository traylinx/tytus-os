import type { AiApi, DaemonApi, Manifest } from '@tytus/host-api';
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
    listThreads(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().listThreads(input);
    },
    createThread(input) {
      requirePermission(opts.manifest, opts.appId, 'ai.chat');
      return getService().createThread(input);
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
  };
};
