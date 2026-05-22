export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

export type AiPrivacyMode = 'cloud' | 'local' | 'no-memory';

export type AiThreadStatus = 'active' | 'archived';

export type AiMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export type AiGatewaySource = 'included' | 'tunnel' | 'local' | 'none';

export type AiGatewayPreference = 'auto' | 'remote' | 'local';

export interface AiStatus {
  available: boolean;
  source: AiGatewaySource;
  label: string;
  model?: string;
  reason?: string;
}

export interface AiModelInfo {
  id: string;
  source: AiGatewaySource;
  gatewayLabel: string;
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

export interface AiUpdateThreadInput {
  threadId: string;
  title?: string;
  status?: AiThreadStatus;
}

export interface AiSendMessageInput {
  threadId: string;
  body: string;
  /**
   * User routing preference. `remote` means Tytus AIL only
   * (public/proxied or tunnel), `local` means local switchAILocal only,
   * `auto` keeps the existing failover order.
   */
  gatewayPreference?: AiGatewayPreference;
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

export interface AiListModelsInput {
  gatewayPreference?: AiGatewayPreference;
  signal?: AbortSignal;
}

export interface AiEmbedTextInput {
  input: string;
  /**
   * User routing preference. `remote` means Tytus AIL only
   * (public/proxied or tunnel), `local` means local switchAILocal only,
   * `auto` keeps the existing failover order.
   */
  gatewayPreference?: AiGatewayPreference;
  /** Optional model alias understood by the selected AIL gateway. */
  model?: string;
  signal?: AbortSignal;
}

export interface AiEmbeddingResult {
  embedding: number[];
  model: string;
  gatewayLabel: string;
  source: AiGatewaySource;
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

/**
 * Local Cortex profile snapshot — sprint
 * `2026-05-21-chat-with-pods-local-cortex-parity`.
 *
 * `cloud` means chat routes through the Provider → remote Cortex on Strato.
 * `local` means chat routes through the bundled Cortex docker stack on
 * `127.0.0.1:<port>`. `available === false` means the user is in local
 * profile but the stack is unreachable — apps must treat this as cloud
 * for routing decisions, but they can surface a "fix in Settings" hint.
 */
export interface CortexProfile {
  profile: 'cloud' | 'local';
  available: boolean;
  cortexVersion?: string;
  port?: number;
}

export interface CortexSearchInput {
  query: string;
  /** Default: 5. Hard cap: 50 (Cortex-side). */
  limit?: number;
  /** Default: "tytus-os". Scope memories to a particular app. */
  appId?: string;
  /** 0..1. Filters out hits below this cosine similarity. */
  minSimilarity?: number;
}

export interface CortexMemoryHit {
  id: string;
  content: string;
  similarity: number;
  createdAt: string;
}

export interface AiApi {
  status(signal?: AbortSignal): Promise<AiStatus>;
  listModels(input?: AiListModelsInput): Promise<AiModelInfo[]>;
  embedText(input: AiEmbedTextInput): Promise<AiEmbeddingResult>;
  listThreads(input?: AiListThreadsInput): Promise<AiThread[]>;
  createThread(input?: AiCreateThreadInput): Promise<AiThread>;
  updateThread(input: AiUpdateThreadInput): Promise<AiThread>;
  listMessages(threadId: string): Promise<AiMessage[]>;
  sendMessage(input: AiSendMessageInput): AsyncIterable<AiEvent>;
  cancelRun(runId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  searchMemory(input: AiSearchMemoryInput): Promise<AiMemoryHit[]>;
  writeMemory(input: AiWriteMemoryInput): Promise<AiMemoryHit>;
  listArtifacts(input: AiListArtifactsInput): Promise<AiArtifact[]>;
  createArtifact(input: AiCreateArtifactInput): Promise<AiArtifact>;
  deleteArtifact(artifactId: string): Promise<void>;

  /**
   * Local Cortex profile + reachability. Apps call this to decide whether
   * to show Cortex-backed UI (recall, status chip) and to label which
   * Cortex is serving the current chat. Resolves with `{profile:'cloud',
   * available:true}` when the user is on cloud (today's default).
   *
   * Never throws — daemon unreachable returns
   * `{profile:'cloud', available:false}` (safer default than crashing).
   */
  cortexProfile(signal?: AbortSignal): Promise<CortexProfile>;

  /**
   * Semantic search over local Cortex's long-term memory. Read-only.
   * Returns `[]` when profile=cloud, when no user token is present, or
   * when local Cortex is unreachable — callers can render "no recall
   * available" without branching on errors.
   *
   * Cortex has no public memory-write endpoint today (sprint Q19);
   * memories are populated implicitly by chats that route through
   * `/v1/chat`. Search results reflect those consolidated turns.
   */
  cortexSearch(
    input: CortexSearchInput,
    signal?: AbortSignal,
  ): Promise<CortexMemoryHit[]>;
}
