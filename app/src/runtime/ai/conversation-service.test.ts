import { describe, expect, it } from 'vitest';
import type {
  AiArtifact,
  AiMemoryHit,
  AiMessage,
  AiThread,
  DaemonApi,
} from '@tytus/host-api';
import { ConversationService } from './conversation-service';
import type { AiRepo } from './message-repo';
import type { LlmGateway } from './llm-gateway';

const baseThread: AiThread = {
  id: 'thr_1',
  appId: 'demo',
  workspaceKey: 'default',
  title: 'Test chat',
  mode: 'default',
  privacy: 'cloud',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  lastMessageAt: null,
};

class FakeRepo implements AiRepo {
  messages: AiMessage[] = [];
  outbox: Array<{ appId: string; threadId: string; payload: Record<string, unknown>; error?: string | null }> = [];
  memories: AiMemoryHit[] = [];
  artifacts: AiArtifact[] = [];
  runUpdates: Array<{ id: string; status: string; gatewayLabel?: string | null; error?: string | null }> = [];

  async listThreads() {
    return [baseThread];
  }

  async createThread() {
    return baseThread;
  }

  async getThread(threadId: string, appId: string) {
    return threadId === baseThread.id && appId === baseThread.appId ? baseThread : null;
  }

  async listMessages() {
    return this.messages;
  }

  async appendMessage(input: {
    threadId: string;
    appId: string;
    role: AiMessage['role'];
    body: string;
    status?: AiMessage['status'];
    model?: string | null;
    gatewayLabel?: string | null;
    error?: string | null;
  }) {
    const msg: AiMessage = {
      id: `${input.role}_${this.messages.length + 1}`,
      threadId: input.threadId,
      role: input.role,
      body: input.body,
      status: input.status ?? 'complete',
      model: input.model ?? null,
      gatewayLabel: input.gatewayLabel ?? null,
      error: input.error ?? null,
      createdAt: this.messages.length + 1,
      updatedAt: this.messages.length + 1,
    };
    this.messages.push(msg);
    return msg;
  }

  async updateMessage(input: {
    id: string;
    body?: string;
    status?: AiMessage['status'];
    model?: string | null;
    gatewayLabel?: string | null;
    error?: string | null;
  }) {
    const idx = this.messages.findIndex((m) => m.id === input.id);
    if (idx < 0) throw new Error(`missing ${input.id}`);
    this.messages[idx] = {
      ...this.messages[idx],
      body: input.body ?? this.messages[idx].body,
      status: input.status ?? this.messages[idx].status,
      model: input.model === undefined ? this.messages[idx].model : input.model,
      gatewayLabel: input.gatewayLabel === undefined ? this.messages[idx].gatewayLabel : input.gatewayLabel,
      error: input.error === undefined ? this.messages[idx].error : input.error,
    };
    return this.messages[idx];
  }

  async createRun() {
    return 'run_1';
  }

  async updateRun(input: { id: string; status: string; gatewayLabel?: string | null; error?: string | null }) {
    this.runUpdates.push(input);
  }

  async deleteThread() {}

  async searchMemory() {
    return this.memories;
  }

  async writeMemory(appId: string, input: { title: string; body: string }) {
    const memory: AiMemoryHit = {
      id: `mem_${this.memories.length + 1}`,
      appId,
      title: input.title,
      body: input.body,
      score: 0,
      createdAt: 10,
      updatedAt: 10,
    };
    this.memories.push(memory);
    return memory;
  }

  async listArtifacts(appId: string, threadId: string) {
    return this.artifacts.filter((artifact) => artifact.appId === appId && artifact.threadId === threadId);
  }

  async createArtifact(appId: string, input: {
    threadId: string;
    messageId?: string | null;
    title: string;
    kind: string;
    body: string;
  }) {
    const artifact: AiArtifact = {
      id: `art_${this.artifacts.length + 1}`,
      appId,
      threadId: input.threadId,
      messageId: input.messageId ?? null,
      title: input.title,
      kind: input.kind,
      body: input.body,
      createdAt: 20,
      updatedAt: 20,
    };
    this.artifacts.push(artifact);
    return artifact;
  }

  async deleteArtifact(appId: string, artifactId: string) {
    this.artifacts = this.artifacts.filter(
      (artifact) => artifact.appId !== appId || artifact.id !== artifactId,
    );
  }

  async recordOutbox(input: { appId: string; threadId: string; payload: Record<string, unknown>; error?: string | null }) {
    this.outbox.push(input);
    return 'out_1';
  }
}

const fakeDaemon = {
  state: { agents: [], included: [] },
  onStateChange: () => () => {},
  callPodEndpoint: async () => new Response('{}'),
  music: {},
  juli3taLibrary: {},
} as unknown as DaemonApi;

describe('ConversationService', () => {
  it('records failed sends in the AI outbox for retry/audit', async () => {
    const repo = new FakeRepo();
    const gateway = {
      chat: async function* () {
        yield* [];
        throw new Error('AIL offline');
      },
      status: async () => ({ available: false, source: 'none', label: 'offline' }),
    } as unknown as LlmGateway;
    const service = new ConversationService({
      db: {} as never,
      daemon: fakeDaemon,
      appId: 'demo',
      repo,
      gateway,
    });

    const events = [];
    for await (const event of service.sendMessage({ threadId: 'thr_1', body: 'hello' })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'run_failed' && /AIL offline/.test(e.error))).toBe(true);
    expect(repo.outbox).toHaveLength(1);
    expect(repo.outbox[0].payload.kind).toBe('ai.sendMessage');
    expect(repo.outbox[0].payload.body).toBe('hello');
    expect(repo.runUpdates.at(-1)).toMatchObject({ status: 'error', error: 'AIL offline' });
  });

  it('forwards chat model aliases and routing preference to the LLM gateway', async () => {
    const repo = new FakeRepo();
    const calls: Array<Record<string, unknown>> = [];
    const gateway = {
      chat: async function* (input: Record<string, unknown>) {
        calls.push(input);
        yield { token: 'ok', candidate: { id: 'local', source: 'local', label: 'Local AIL', baseUrl: '', callViaHost: false } };
      },
      status: async () => ({ available: true, source: 'local', label: 'Local AIL' }),
    } as unknown as LlmGateway;
    const service = new ConversationService({
      db: {} as never,
      daemon: fakeDaemon,
      appId: 'demo',
      repo,
      gateway,
    });

    const events = [];
    for await (const event of service.sendMessage({
      threadId: 'thr_1',
      body: 'hello',
      model: 'ail-chat',
      gatewayPreference: 'local',
    })) {
      events.push(event);
    }

    expect(calls[0]).toMatchObject({ model: 'ail-chat', gatewayPreference: 'local' });
    const done = events.find((event) => event.type === 'done');
    expect(done?.message.gatewayLabel).toBe('Local AIL · ail-chat');
  });

  it('writes explicit app memories through the repo', async () => {
    const repo = new FakeRepo();
    const service = new ConversationService({
      db: {} as never,
      daemon: fakeDaemon,
      appId: 'demo',
      repo,
      gateway: {} as LlmGateway,
    });

    const memory = await service.writeMemory({ title: 'Preference', body: 'Use remote AIL first.' });
    expect(memory).toMatchObject({
      appId: 'demo',
      title: 'Preference',
      body: 'Use remote AIL first.',
    });
  });

  it('stores, lists, and deletes AI artifacts through the app-scoped repo', async () => {
    const repo = new FakeRepo();
    const service = new ConversationService({
      db: {} as never,
      daemon: fakeDaemon,
      appId: 'demo',
      repo,
      gateway: {} as LlmGateway,
    });

    const artifact = await service.createArtifact({
      threadId: 'thr_1',
      title: 'Plan',
      kind: 'markdown',
      body: '# Next step',
    });

    expect(artifact).toMatchObject({
      appId: 'demo',
      threadId: 'thr_1',
      messageId: null,
      title: 'Plan',
      kind: 'markdown',
      body: '# Next step',
    });
    await expect(service.listArtifacts({ threadId: 'thr_1' })).resolves.toEqual([artifact]);

    await service.deleteArtifact(artifact.id);
    await expect(service.listArtifacts({ threadId: 'thr_1' })).resolves.toEqual([]);
  });
});
