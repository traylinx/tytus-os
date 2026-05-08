import type { Db, SqlValue } from '@/lib/db/types';
import type {
  AiArtifact,
  AiArtifactRow,
  AiCreateArtifactInput,
  AiMemoryHit,
  AiMessage,
  AiMessageRow,
  AiMessageStatus,
  AiPrivacyMode,
  AiRole,
  AiThread,
  AiThreadRow,
  AiThreadStatus,
  Clock,
  AiWriteMemoryInput,
} from './types';
import { defaultClock, mapArtifact, mapMessage, mapThread } from './types';
import { ensureAiSchema } from './schema';
import { recordOutboxRow, searchMemoryRows, writeMemoryRow } from './memory-repo';

export interface AiRepo {
  listThreads(input?: {
    appId: string;
    workspaceKey?: string;
    status?: AiThreadStatus;
  }): Promise<AiThread[]>;
  createThread(input: {
    appId: string;
    workspaceKey?: string;
    title?: string;
    mode?: string;
    privacy?: AiPrivacyMode;
  }): Promise<AiThread>;
  updateThread(input: {
    threadId: string;
    appId: string;
    title?: string;
    status?: AiThreadStatus;
  }): Promise<AiThread>;
  getThread(threadId: string, appId: string): Promise<AiThread | null>;
  listMessages(threadId: string, appId: string): Promise<AiMessage[]>;
  appendMessage(input: {
    threadId: string;
    appId: string;
    role: AiRole;
    body: string;
    status?: AiMessageStatus;
    runId?: string | null;
    model?: string | null;
    gatewayLabel?: string | null;
    error?: string | null;
  }): Promise<AiMessage>;
  updateMessage(input: {
    id: string;
    threadId: string;
    appId: string;
    body?: string;
    status?: AiMessageStatus;
    model?: string | null;
    gatewayLabel?: string | null;
    error?: string | null;
  }): Promise<AiMessage>;
  createRun(input: { threadId: string; appId: string; model: string }): Promise<string>;
  updateRun(input: {
    id: string;
    status: string;
    gatewayLabel?: string | null;
    error?: string | null;
  }): Promise<void>;
  deleteThread(threadId: string, appId: string): Promise<void>;
  searchMemory(appId: string, query: string, limit?: number): Promise<AiMemoryHit[]>;
  writeMemory(appId: string, input: AiWriteMemoryInput): Promise<AiMemoryHit>;
  listArtifacts(appId: string, threadId: string): Promise<AiArtifact[]>;
  createArtifact(appId: string, input: AiCreateArtifactInput): Promise<AiArtifact>;
  deleteArtifact(appId: string, artifactId: string): Promise<void>;
  recordOutbox(input: {
    appId: string;
    threadId: string;
    payload: Record<string, unknown>;
    error?: string | null;
  }): Promise<string>;
}

export const createAiRepo = (db: Db, clock: Clock = defaultClock): AiRepo => {
  let ensured: Promise<void> | null = null;
  const ensure = () => (ensured ??= ensureAiSchema(db));

  const threadOwnerWhere = `id = ? AND app_id = ?`;

  return {
    async listThreads(input) {
      await ensure();
      const clauses = ['app_id = ?'];
      const bindings: SqlValue[] = [input?.appId ?? ''];
      if (input?.workspaceKey) {
        clauses.push('workspace_key = ?');
        bindings.push(input.workspaceKey);
      }
      if (input?.status) {
        clauses.push('status = ?');
        bindings.push(input.status);
      }
      const rows = await db.query<AiThreadRow>(
        `SELECT id, app_id, workspace_key, title, mode, privacy, status, created_at, updated_at, last_message_at
           FROM ai_threads
          WHERE ${clauses.join(' AND ')}
          ORDER BY updated_at DESC`,
        bindings,
      );
      return rows.map(mapThread);
    },

    async createThread(input) {
      await ensure();
      const ts = clock.now();
      const id = clock.id('thr');
      await db.run(
        `INSERT INTO ai_threads
          (id, owner_key, app_id, workspace_key, title, mode, privacy, status, created_at, updated_at, last_message_at)
         VALUES (?, 'local', ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
        [
          id,
          input.appId,
          input.workspaceKey ?? 'default',
          input.title?.trim() || 'New chat',
          input.mode ?? 'default',
          input.privacy ?? 'cloud',
          ts,
          ts,
        ],
      );
      const thread = await this.getThread(id, input.appId);
      if (!thread) throw new Error('ai repo failed to create thread');
      return thread;
    },

    async updateThread(input) {
      await ensure();
      const existing = await this.getThread(input.threadId, input.appId);
      if (!existing) throw new Error(`ai thread not found: ${input.threadId}`);
      const title = input.title === undefined ? existing.title : input.title.trim();
      if (input.title !== undefined && !title) throw new Error('host.ai.updateThread: title is empty');
      const status = input.status ?? existing.status;
      const ts = clock.now();
      await db.run(
        `UPDATE ai_threads
            SET title = ?, status = ?, updated_at = ?
          WHERE ${threadOwnerWhere}`,
        [title, status, ts, input.threadId, input.appId],
      );
      const updated = await this.getThread(input.threadId, input.appId);
      if (!updated) throw new Error(`ai thread not found after update: ${input.threadId}`);
      return updated;
    },

    async getThread(threadId, appId) {
      await ensure();
      const rows = await db.query<AiThreadRow>(
        `SELECT id, app_id, workspace_key, title, mode, privacy, status, created_at, updated_at, last_message_at
           FROM ai_threads WHERE ${threadOwnerWhere}`,
        [threadId, appId],
      );
      return rows[0] ? mapThread(rows[0]) : null;
    },

    async listMessages(threadId, appId) {
      await ensure();
      const thread = await this.getThread(threadId, appId);
      if (!thread) return [];
      const rows = await db.query<AiMessageRow>(
        `SELECT id, thread_id, role, body, status, model, gateway_label, error, created_at, updated_at
           FROM ai_messages
          WHERE thread_id = ?
          ORDER BY created_at ASC`,
        [threadId],
      );
      return rows.map(mapMessage);
    },

    async appendMessage(input) {
      await ensure();
      const ts = clock.now();
      const id = clock.id(input.role === 'user' ? 'usr' : 'msg');
      await db.run(
        `INSERT INTO ai_messages
          (id, thread_id, run_id, role, body, status, model, gateway_label, error, created_at, updated_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
        [
          id,
          input.threadId,
          input.runId ?? null,
          input.role,
          input.body,
          input.status ?? 'complete',
          input.model ?? null,
          input.gatewayLabel ?? null,
          input.error ?? null,
          ts,
          ts,
        ],
      );
      await db.run(
        `UPDATE ai_threads SET updated_at = ?, last_message_at = ? WHERE ${threadOwnerWhere}`,
        [ts, ts, input.threadId, input.appId],
      );
      const rows = await db.query<AiMessageRow>(
        `SELECT id, thread_id, role, body, status, model, gateway_label, error, created_at, updated_at
           FROM ai_messages WHERE id = ?`,
        [id],
      );
      if (!rows[0]) throw new Error('ai repo failed to append message');
      return mapMessage(rows[0]);
    },

    async updateMessage(input) {
      await ensure();
      const ts = clock.now();
      const existing = await db.query<AiMessageRow>(
        `SELECT m.id, m.thread_id, m.role, m.body, m.status, m.model, m.gateway_label, m.error, m.created_at, m.updated_at
           FROM ai_messages m
           JOIN ai_threads t ON t.id = m.thread_id
          WHERE m.id = ? AND m.thread_id = ? AND t.app_id = ?`,
        [input.id, input.threadId, input.appId],
      );
      if (!existing[0]) throw new Error(`ai message not found: ${input.id}`);
      const prev = existing[0];
      await db.run(
        `UPDATE ai_messages
            SET body = ?, status = ?, model = ?, gateway_label = ?, error = ?, updated_at = ?
          WHERE id = ?`,
        [
          input.body ?? prev.body,
          input.status ?? prev.status,
          input.model === undefined ? prev.model : input.model,
          input.gatewayLabel === undefined ? prev.gateway_label : input.gatewayLabel,
          input.error === undefined ? prev.error : input.error,
          ts,
          input.id,
        ],
      );
      await db.run(
        `UPDATE ai_threads SET updated_at = ?, last_message_at = ? WHERE ${threadOwnerWhere}`,
        [ts, ts, input.threadId, input.appId],
      );
      const rows = await db.query<AiMessageRow>(
        `SELECT id, thread_id, role, body, status, model, gateway_label, error, created_at, updated_at
           FROM ai_messages WHERE id = ?`,
        [input.id],
      );
      return mapMessage(rows[0]);
    },

    async createRun(input) {
      await ensure();
      const ts = clock.now();
      const id = clock.id('run');
      await db.run(
        `INSERT INTO ai_runs
          (id, thread_id, app_id, status, model, gateway_label, error, created_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, NULL, NULL, ?, ?)`,
        [id, input.threadId, input.appId, input.model, ts, ts],
      );
      return id;
    },

    async updateRun(input) {
      await ensure();
      await db.run(
        `UPDATE ai_runs SET status = ?, gateway_label = COALESCE(?, gateway_label), error = ?, updated_at = ? WHERE id = ?`,
        [input.status, input.gatewayLabel ?? null, input.error ?? null, clock.now(), input.id],
      );
    },

    async deleteThread(threadId, appId) {
      await ensure();
      await db.run(`UPDATE ai_threads SET status = 'archived', updated_at = ? WHERE ${threadOwnerWhere}`, [
        clock.now(),
        threadId,
        appId,
      ]);
    },

    async searchMemory(appId, query, limit = 8) {
      await ensure();
      return searchMemoryRows(db, appId, query, limit);
    },

    async writeMemory(appId, input) {
      await ensure();
      return writeMemoryRow(db, clock, appId, input);
    },

    async listArtifacts(appId, threadId) {
      await ensure();
      const thread = await this.getThread(threadId, appId);
      if (!thread) return [];
      const rows = await db.query<AiArtifactRow>(
        `SELECT id, thread_id, message_id, app_id, title, kind, body, created_at, updated_at
           FROM ai_artifacts
          WHERE thread_id = ? AND app_id = ?
          ORDER BY created_at DESC`,
        [threadId, appId],
      );
      return rows.map(mapArtifact);
    },

    async createArtifact(appId, input) {
      await ensure();
      const thread = await this.getThread(input.threadId, appId);
      if (!thread) throw new Error(`ai thread not found for artifact: ${input.threadId}`);
      const title = input.title.trim();
      const kind = input.kind.trim();
      if (!title) throw new Error('host.ai.createArtifact: title is empty');
      if (!kind) throw new Error('host.ai.createArtifact: kind is empty');
      const ts = clock.now();
      const id = clock.id('art');
      await db.run(
        `INSERT INTO ai_artifacts
          (id, thread_id, message_id, app_id, title, kind, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.threadId,
          input.messageId ?? null,
          appId,
          title,
          kind,
          input.body,
          ts,
          ts,
        ],
      );
      const rows = await db.query<AiArtifactRow>(
        `SELECT id, thread_id, message_id, app_id, title, kind, body, created_at, updated_at
           FROM ai_artifacts
          WHERE id = ? AND app_id = ?`,
        [id, appId],
      );
      if (!rows[0]) throw new Error('ai repo failed to create artifact');
      return mapArtifact(rows[0]);
    },

    async deleteArtifact(appId, artifactId) {
      await ensure();
      await db.run(
        `DELETE FROM ai_artifacts WHERE id = ? AND app_id = ?`,
        [artifactId, appId],
      );
    },

    async recordOutbox(input) {
      await ensure();
      return recordOutboxRow(db, clock, input);
    },
  };
};
