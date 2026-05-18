import { describe, expect, it } from 'vitest';
import { createSessionWithTransport } from './engine';
import type { PodTransport } from './transport';
import type { AssetResolver } from './types';
import type {
  HostClient,
  Juli3taLibraryApi,
  MusicDaemonApi,
} from '@tytus/host-api';
import type { EngineEvent } from './events';
import { streamFromStrings } from './stream';
import { PodOfflineError } from './router';

function fakeAssets(prompts: Record<string, string>): AssetResolver {
  return {
    text: async (path) => {
      if (path in prompts) return prompts[path];
      throw new Error(`asset not found: ${path}`);
    },
    bytes: async () => new Uint8Array(),
  };
}

function fakeHost(): HostClient {
  return {
    appId: 'sheet',
    fs: {} as never,
    daemon: {
      state: { agents: [], included: [] },
      onStateChange: () => () => {},
      callPodEndpoint: async () => new Response('{"data":[]}'),
      chatAgent: async function* () {},
      music: {} as MusicDaemonApi,
      juli3taLibrary: {} as Juli3taLibraryApi,
    },
    windows: {} as never,
    notifications: {} as never,
    shellMenu: {} as never,
    i18n: {} as never,
    storage: {} as never,
    events: {
      on: () => () => {},
      emit: () => {},
    },
    media: {} as never,
    assets: {} as never,
  };
}

function transportFromEvents(events: Array<Record<string, unknown>>): PodTransport {
  const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return {
    chat: async () => streamFromStrings([sse]),
  };
}

async function collect(
  iter: AsyncIterable<EngineEvent>,
): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

const baseDone = {
  kind: 'done' as const,
  txId: 'tx-A',
  transaction: {
    txId: 'tx-A',
    app: 'sheet' as const,
    baseRevisions: {},
    patches: [],
    filesAffected: [],
    estimatedCost: { tokens: 0, usd: 0 },
    preview: [],
  },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  finishReason: 'stop',
};

describe('createSession — happy path', () => {
  it('streams events and emits a `done` with the assembled Transaction', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({
        'prompts/sheet-default.md': '---\nversion: v1\n---\nYou are Sheet.',
      }),
      transport: transportFromEvents([
        { kind: 'token', text: 'Hello', sourceRevision: 1 },
        baseDone,
      ]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });

    const out = await collect(
      session.send({ intent: 'chat', prompt: 'hi' }) as AsyncIterable<EngineEvent>,
    );
    const kinds = out.map((e) => e.kind);
    expect(kinds).toContain('token');
    expect(kinds[kinds.length - 1]).toBe('done');
  });

  it('updates session.cost from done.usage', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}),
      transport: transportFromEvents([baseDone]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    await collect(session.send({ intent: 'chat', prompt: 'hi' }) as AsyncIterable<EngineEvent>);
    expect(session.cost.promptTokens).toBe(10);
    expect(session.cost.completionTokens).toBe(5);
  });

  it('still emits done when prompt is missing — yields a non-fatal error first', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}), // no prompts
      transport: transportFromEvents([baseDone]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    const out = await collect(session.send({ intent: 'chat', prompt: 'hi' }) as AsyncIterable<EngineEvent>);
    expect(out[0].kind).toBe('error');
    if (out[0].kind === 'error') {
      expect(out[0].retryable).toBe(true);
      expect(out[0].message).toContain('prompt missing');
    }
    expect(out[out.length - 1].kind).toBe('done');
  });
});

describe('createSession — staged patches', () => {
  it('passes through valid staged_patch events', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}),
      transport: transportFromEvents([
        {
          kind: 'staged_patch',
          txId: 'tx-X',
          patch: {
            kind: 'text.insert',
            docId: 'doc-1',
            at: { offset: 0 },
            text: 'hello',
          },
        },
        baseDone,
      ]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    const out = await collect(session.send({ intent: 'edit', prompt: 'add' }) as AsyncIterable<EngineEvent>);
    const staged = out.find((e) => e.kind === 'staged_patch');
    expect(staged).toBeDefined();
  });

  it('rejects invalid staged_patch with patch_invalid error event', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}),
      transport: transportFromEvents([
        {
          kind: 'staged_patch',
          txId: 'tx-X',
          patch: {
            kind: 'sheet.moveRange',
            sheetId: 's1',
            mappings: Array.from({ length: 250 }, (_, i) => ({
              from: `A${i + 1}:A${i + 1}`,
              to: `B${i + 1}`,
            })),
          },
        },
        baseDone,
      ]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    const out = await collect(session.send({ intent: 'edit', prompt: 'sort' }) as AsyncIterable<EngineEvent>);
    const error = out.find(
      (e) => e.kind === 'error' && e.errorKind === 'patch_invalid',
    );
    expect(error).toBeDefined();
  });
});

describe('createSession — tool dispatch', () => {
  it('dispatches a tool_call through the registered tool and emits tool_result', async () => {
    const session = createSessionWithTransport({
      app: 'studio',
      mode: 'code',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [
        {
          name: 'echo',
          description: 'echo args back',
          parameters: { type: 'object', properties: {} },
          requiresApproval: false,
          execute: async (args) => ({ echo: args }),
        },
      ],
      assets: fakeAssets({}),
      transport: transportFromEvents([
        {
          kind: 'tool_call',
          callId: 'c1',
          tool: 'echo',
          args: { ping: 1 },
        },
        baseDone,
      ]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    const out = await collect(session.send({ intent: 'chat', prompt: 'hi' }) as AsyncIterable<EngineEvent>);
    const tr = out.find((e) => e.kind === 'tool_result');
    expect(tr).toBeDefined();
    if (tr?.kind !== 'tool_result') return;
    expect(tr.ok).toBe(true);
    expect((tr.value as { echo: unknown }).echo).toEqual({ ping: 1 });
  });

  it('reports tool_result.ok=false for unknown tool', async () => {
    const session = createSessionWithTransport({
      app: 'studio',
      mode: 'code',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}),
      transport: transportFromEvents([
        {
          kind: 'tool_call',
          callId: 'c1',
          tool: 'missing',
          args: {},
        },
        baseDone,
      ]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    const out = await collect(session.send({ intent: 'chat', prompt: 'hi' }) as AsyncIterable<EngineEvent>);
    const tr = out.find((e) => e.kind === 'tool_result');
    expect(tr).toBeDefined();
    if (tr?.kind !== 'tool_result') return;
    expect(tr.ok).toBe(false);
    expect(tr.error).toContain('unknown tool');
  });
});

describe('createSession — concurrency', () => {
  it('rejects a second send while one is in flight (drop-newest)', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}),
      // Slow stream — yield nothing until we ask for it.
      transport: {
        chat: async () => ({
          body: (async function* () {
            // hold open
            await new Promise((r) => setTimeout(r, 50));
            yield `data: ${JSON.stringify(baseDone)}\n\n`;
          })(),
        }),
      },
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });

    // Start first request; don't drain it yet.
    const first = session.send({ intent: 'chat', prompt: 'A' });
    const firstIter = first[Symbol.asyncIterator]();
    // Kick the first iteration so inFlight flips on.
    const firstNextPromise = firstIter.next();

    // Second send while first is in flight.
    const second = session.send({ intent: 'chat', prompt: 'B' });
    const secondOut = await collect(second as AsyncIterable<EngineEvent>);
    expect(secondOut[0].kind).toBe('error');
    if (secondOut[0].kind === 'error') {
      expect(secondOut[0].errorKind).toBe('queue_overflow');
    }

    // Drain first to clear in-flight.
    await firstNextPromise;
    for (let i = 0; i < 10; i += 1) {
      const r = await firstIter.next();
      if (r.done) break;
    }
  });
});

describe('createSession — abort', () => {
  it('rejects subsequent send() with errorKind: aborted', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}),
      transport: transportFromEvents([baseDone]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    session.abort();
    const out = await collect(session.send({ intent: 'chat', prompt: 'x' }) as AsyncIterable<EngineEvent>);
    expect(out[0].kind).toBe('error');
    if (out[0].kind === 'error') {
      expect(out[0].errorKind).toBe('aborted');
    }
  });
});

describe('createSession — recordOutcome', () => {
  it('merges outcome via CostReporter for a previously seen txId', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}),
      transport: transportFromEvents([baseDone]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    await collect(session.send({ intent: 'chat', prompt: 'x' }) as AsyncIterable<EngineEvent>);
    // Should not throw.
    await session.recordOutcome('tx-A', {
      accepted: true,
      finalState: 'committed',
    });
  });
});

describe('createSession — pod offline', () => {
  it('yields pod_offline error when transport throws PodOfflineError', async () => {
    const session = createSessionWithTransport({
      app: 'sheet',
      mode: 'default',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({
        // Ensure the prompt loads so the only error is the pod-offline one.
        'prompts/sheet-default.md': '---\nversion: v1\n---\nYou are Sheet.',
      }),
      transport: {
        chat: async () => {
          throw new PodOfflineError('test forced offline');
        },
      },
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    const out = await collect(session.send({ intent: 'chat', prompt: 'x' }) as AsyncIterable<EngineEvent>);
    const err = out.find((e) => e.kind === 'error');
    expect(err).toBeDefined();
    if (err?.kind === 'error') {
      expect(err.errorKind).toBe('pod_offline');
    }
  });
});

describe('createSession — ghostRequest stub', () => {
  it('yields a single error event explaining the M2.5 follow-up status', async () => {
    const session = createSessionWithTransport({
      app: 'studio',
      mode: 'code',
      documentId: 'doc-1',
      documentRevision: 1,
      host: fakeHost(),
      tools: [],
      assets: fakeAssets({}),
      transport: transportFromEvents([baseDone]),
      skipDiscovery: true,
      modelOverride: 'gpt-test',
    });
    const out = await collect(
      session.ghostRequest({ at: 0, after: 400 }) as AsyncIterable<EngineEvent>,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('error');
  });
});
