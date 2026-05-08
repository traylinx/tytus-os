export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

export type AiPrivacyMode = 'cloud' | 'local' | 'no-memory';

export type AiThreadStatus = 'active' | 'archived';

export type AiMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export type AiGatewaySource = 'included' | 'tunnel' | 'local' | 'none';

export interface AiStatus {
  available: boolean;
  source: AiGatewaySource;
  label: string;
  model?: string;
  reason?: string;
}

export interface AiThread {
  id: string;
  appId: string;
  workspaceKey: string;
  title: string;
  mode: string;
  privacy: AiPrivacyMode;
  status: AiThreadStatus;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | null;
}

export interface AiMessage {
  id: string;
  threadId: string;
  role: AiRole;
  body: string;
  status: AiMessageStatus;
  model: string | null;
  gatewayLabel: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AiContextPart {
  kind: 'file' | 'selection' | 'workspace' | 'note';
  title: string;
  text: string;
}

export interface AiMemoryHit {
  id: string;
  appId: string;
  title: string;
  body: string;
  score: number;
  createdAt: number;
  updatedAt: number;
}

export interface AiArtifact {
  id: string;
  threadId: string;
  messageId: string | null;
  appId: string;
  title: string;
  kind: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export type AiEvent =
  | { type: 'run_started'; runId: string; threadId: string }
  | { type: 'message_created'; message: AiMessage }
  | { type: 'token'; messageId: string; token: string; body: string }
  | { type: 'message_updated'; message: AiMessage }
  | { type: 'run_failed'; runId: string; messageId?: string; error: string }
  | { type: 'done'; runId: string; message: AiMessage };

export interface AiListThreadsInput {
  workspaceKey?: string;
  status?: AiThreadStatus;
}

export interface AiCreateThreadInput {
  workspaceKey?: string;
  title?: string;
  mode?: string;
  privacy?: AiPrivacyMode;
}

export interface AiSendMessageInput {
  threadId: string;
  body: string;
  model?: string;
  mode?: string;
  privacy?: AiPrivacyMode;
  context?: AiContextPart[];
  signal?: AbortSignal;
}

export interface AiSearchMemoryInput {
  query: string;
  limit?: number;
}

export interface AiWriteMemoryInput {
  title: string;
  body: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AiListArtifactsInput {
  threadId: string;
}

export interface AiCreateArtifactInput {
  threadId: string;
  messageId?: string | null;
  title: string;
  kind: string;
  body: string;
}

export interface AiApi {
  status(signal?: AbortSignal): Promise<AiStatus>;
  listThreads(input?: AiListThreadsInput): Promise<AiThread[]>;
  createThread(input?: AiCreateThreadInput): Promise<AiThread>;
  listMessages(threadId: string): Promise<AiMessage[]>;
  sendMessage(input: AiSendMessageInput): AsyncIterable<AiEvent>;
  cancelRun(runId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  searchMemory(input: AiSearchMemoryInput): Promise<AiMemoryHit[]>;
  writeMemory(input: AiWriteMemoryInput): Promise<AiMemoryHit>;
  listArtifacts(input: AiListArtifactsInput): Promise<AiArtifact[]>;
  createArtifact(input: AiCreateArtifactInput): Promise<AiArtifact>;
  deleteArtifact(artifactId: string): Promise<void>;
}
