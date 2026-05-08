import type {
  AiContextPart,
  AiGatewaySource,
  AiMemoryHit,
  AiMessage,
  AiMessageStatus,
  AiPrivacyMode,
  AiRole,
  AiStatus,
  AiThread,
  AiThreadStatus,
} from '@tytus/host-api';

export type {
  AiContextPart,
  AiGatewaySource,
  AiMemoryHit,
  AiMessage,
  AiMessageStatus,
  AiPrivacyMode,
  AiRole,
  AiStatus,
  AiThread,
  AiThreadStatus,
};

export interface Clock {
  now(): number;
  id(prefix: string): string;
}

export const defaultClock: Clock = {
  now: () => Date.now(),
  id(prefix: string): string {
    const cryptoObj = globalThis.crypto as Crypto | undefined;
    const raw = cryptoObj?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `${prefix}_${raw.replace(/-/g, '').slice(0, 24)}`;
  },
};

export interface AiThreadRow {
  id: string;
  app_id: string;
  workspace_key: string;
  title: string;
  mode: string;
  privacy: AiPrivacyMode;
  status: AiThreadStatus;
  created_at: number;
  updated_at: number;
  last_message_at: number | null;
}

export interface AiMessageRow {
  id: string;
  thread_id: string;
  role: AiRole;
  body: string;
  status: AiMessageStatus;
  model: string | null;
  gateway_label: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export const mapThread = (row: AiThreadRow): AiThread => ({
  id: row.id,
  appId: row.app_id,
  workspaceKey: row.workspace_key,
  title: row.title,
  mode: row.mode,
  privacy: row.privacy,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastMessageAt: row.last_message_at,
});

export const mapMessage = (row: AiMessageRow): AiMessage => ({
  id: row.id,
  threadId: row.thread_id,
  role: row.role,
  body: row.body,
  status: row.status,
  model: row.model,
  gatewayLabel: row.gateway_label,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
