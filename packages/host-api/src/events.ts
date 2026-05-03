import type { Manifest } from './manifest';

/**
 * Typed shell event bus. Add a new event by adding a key to
 * `ShellEventPayload` — `ShellEventName` derives from it automatically.
 */

export interface ShellEventPayload {
  'vfs.changed': {
    fileNodeId: string;
    parentId: string;
    kind: 'created' | 'modified' | 'deleted' | 'renamed';
  };
  'vfs.deleted': { fileNodeId: string; parentId: string };
  'app.installed': { appId: string; manifest: Manifest };
  'app.uninstalled': { appId: string };
  'app.updated': {
    appId: string;
    oldVersion: string;
    newVersion: string;
  };
  'session.aborted': { appId: string; sessionId?: string };
}

export type ShellEventName = keyof ShellEventPayload;

export interface EventsApi {
  on<E extends ShellEventName>(
    name: E,
    fn: (payload: ShellEventPayload[E]) => void,
  ): () => void;
  emit<E extends ShellEventName>(
    name: E,
    payload: ShellEventPayload[E],
  ): void;
}
