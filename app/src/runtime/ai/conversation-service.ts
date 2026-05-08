import type {
  AiEvent,
  AiArtifact,
  AiCreateArtifactInput,
  AiListThreadsInput,
  AiCreateThreadInput,
  AiMessage,
  AiSearchMemoryInput,
  AiSendMessageInput,
  AiStatus,
  AiThread,
  AiWriteMemoryInput,
  DaemonApi,
} from '@tytus/host-api';
import type { Db } from '@/lib/db/types';
import { contextToSystemMessage, sanitizeContext } from './context-sanitizer';
import { LlmGateway } from './llm-gateway';
import type { OpenAiChatMessage } from './openai-stream';
import { createAiRepo, type AiRepo } from './message-repo';

export interface ConversationServiceOpts {
  db: Db;
  daemon: DaemonApi;
  appId: string;
  repo?: AiRepo;
  gateway?: LlmGateway;
}

export class ConversationService {
  private readonly repo: AiRepo;
  private readonly gateway: LlmGateway;
  private readonly opts: ConversationServiceOpts;

  constructor(opts: ConversationServiceOpts) {
    this.opts = opts;
    this.repo = opts.repo ?? createAiRepo(opts.db);
    this.gateway = opts.gateway ?? new LlmGateway(opts.daemon);
  }

  status(signal?: AbortSignal): Promise<AiStatus> {
    return this.gateway.status(signal) as Promise<AiStatus>;
  }

  listModels(input?: { gatewayPreference?: AiSendMessageInput['gatewayPreference']; signal?: AbortSignal }) {
    return this.gateway.listModels(input);
  }

  listThreads(input?: AiListThreadsInput): Promise<AiThread[]> {
    return this.repo.listThreads({
      appId: this.opts.appId,
      workspaceKey: input?.workspaceKey,
      status: input?.status ?? 'active',
    });
  }

  createThread(input?: AiCreateThreadInput): Promise<AiThread> {
    return this.repo.createThread({
      appId: this.opts.appId,
      workspaceKey: input?.workspaceKey ?? 'default',
      title: input?.title,
      mode: input?.mode,
      privacy: input?.privacy,
    });
  }

  listMessages(threadId: string): Promise<AiMessage[]> {
    return this.repo.listMessages(threadId, this.opts.appId);
  }

  async *sendMessage(input: AiSendMessageInput): AsyncIterable<AiEvent> {
    const body = input.body.trim();
    if (!body) throw new Error('host.ai.sendMessage: body is empty');
    const thread = await this.repo.getThread(input.threadId, this.opts.appId);
    if (!thread) throw new Error(`host.ai.sendMessage: thread not found: ${input.threadId}`);

    const runId = await this.repo.createRun({
      appId: this.opts.appId,
      threadId: thread.id,
      model: input.model ?? 'auto',
    });
    yield { type: 'run_started', runId, threadId: thread.id };

    const user = await this.repo.appendMessage({
      appId: this.opts.appId,
      threadId: thread.id,
      role: 'user',
      body,
      status: 'complete',
      runId,
      model: input.model ?? 'auto',
    });
    yield { type: 'message_created', message: user };

    let assistant = await this.repo.appendMessage({
      appId: this.opts.appId,
      threadId: thread.id,
      role: 'assistant',
      body: '',
      status: 'streaming',
      runId,
      model: input.model ?? 'auto',
    });
    yield { type: 'message_created', message: assistant };

    try {
      const history = await this.repo.listMessages(thread.id, this.opts.appId);
      const messages = this.toOpenAiMessages(history, input.context);
      let full = '';
      let gatewayLabel: string | null = null;
      const requestedModel = input.model?.trim() || 'auto';
      for await (const chunk of this.gateway.chat({
        messages,
        model: requestedModel,
        gatewayPreference: input.gatewayPreference ?? 'auto',
        signal: input.signal,
      })) {
        gatewayLabel = requestedModel === 'auto'
          ? chunk.candidate.label
          : `${chunk.candidate.label} · ${requestedModel}`;
        full += chunk.token;
        yield { type: 'token', messageId: assistant.id, token: chunk.token, body: full };
      }
      assistant = await this.repo.updateMessage({
        appId: this.opts.appId,
        threadId: thread.id,
        id: assistant.id,
        body: full || '(empty response)',
        status: 'complete',
        model: input.model ?? 'auto',
        gatewayLabel,
        error: null,
      });
      await this.repo.updateRun({ id: runId, status: 'complete', gatewayLabel });
      yield { type: 'message_updated', message: assistant };
      yield { type: 'done', runId, message: assistant };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assistant = await this.repo.updateMessage({
        appId: this.opts.appId,
        threadId: thread.id,
        id: assistant.id,
        body: message,
        status: 'error',
        error: message,
      });
      await this.repo.updateRun({ id: runId, status: 'error', error: message });
      await this.repo.recordOutbox({
        appId: this.opts.appId,
        threadId: thread.id,
        error: message,
        payload: {
          kind: 'ai.sendMessage',
          body,
          model: input.model ?? 'auto',
          gatewayPreference: input.gatewayPreference ?? 'auto',
          mode: input.mode ?? thread.mode,
          privacy: input.privacy ?? thread.privacy,
          context: input.context ?? [],
          failedAt: Date.now(),
        },
      }).catch(() => undefined);
      yield { type: 'run_failed', runId, messageId: assistant.id, error: message };
      yield { type: 'message_updated', message: assistant };
    }
  }

  cancelRun(runId: string): Promise<void> {
    void runId;
    return Promise.resolve();
  }

  deleteThread(threadId: string): Promise<void> {
    return this.repo.deleteThread(threadId, this.opts.appId);
  }

  searchMemory(input: AiSearchMemoryInput) {
    return this.repo.searchMemory(this.opts.appId, input.query, input.limit);
  }

  writeMemory(input: AiWriteMemoryInput) {
    return this.repo.writeMemory(this.opts.appId, input);
  }

  listArtifacts(input: { threadId: string }): Promise<AiArtifact[]> {
    return this.repo.listArtifacts(this.opts.appId, input.threadId);
  }

  createArtifact(input: AiCreateArtifactInput): Promise<AiArtifact> {
    return this.repo.createArtifact(this.opts.appId, input);
  }

  deleteArtifact(artifactId: string): Promise<void> {
    return this.repo.deleteArtifact(this.opts.appId, artifactId);
  }

  private toOpenAiMessages(history: AiMessage[], context: AiSendMessageInput['context']): OpenAiChatMessage[] {
    const messages: OpenAiChatMessage[] = [];
    const ctx = contextToSystemMessage(sanitizeContext(context));
    if (ctx) messages.push({ role: 'system', content: ctx });
    for (const msg of history) {
      if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') continue;
      if (msg.status === 'error') continue;
      if (!msg.body.trim() && msg.role !== 'assistant') continue;
      messages.push({ role: msg.role, content: msg.body });
    }
    return messages.slice(-24);
  }
}
