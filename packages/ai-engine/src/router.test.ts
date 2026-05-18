import { describe, expect, it } from 'vitest';
import {
  PodOfflineError,
  discoverModels,
  pickModel,
  resolveEndpoint,
  type Endpoint,
  type ModelInfo,
} from './router';
import type {
  HostClient,
  Juli3taLibraryApi,
  MusicDaemonApi,
  Pod,
} from '@tytus/host-api';

const stubMusic = {} as MusicDaemonApi;
const stubJuli3ta = {} as Juli3taLibraryApi;
const stubChatAgent = async function* () {};

function makeHost(pods: Pod[]): HostClient {
  return {
    appId: 'test',
    fs: {} as never,
    daemon: {
      state: { agents: [], included: pods },
      onStateChange: () => () => {},
      callPodEndpoint: async (_id, _path) =>
        new Response(JSON.stringify({ data: [] })),
      chatAgent: stubChatAgent,
      music: stubMusic,
      juli3taLibrary: stubJuli3ta,
    },
    windows: {} as never,
    notifications: {} as never,
    shellMenu: {} as never,
    i18n: {} as never,
    storage: {} as never,
    events: {} as never,
    media: {} as never,
    assets: {} as never,
  };
}

describe('router — resolveEndpoint', () => {
  it('throws PodOfflineError when no pods are registered', () => {
    expect(() => resolveEndpoint(makeHost([]))).toThrow(PodOfflineError);
  });

  it('throws PodOfflineError when pods exist but none are running', () => {
    const pods: Pod[] = [{ id: 'p1', status: 'starting' }];
    expect(() => resolveEndpoint(makeHost(pods))).toThrow(/all offline/);
  });

  it('throws PodOfflineError when running pod lacks gateway meta', () => {
    const pods: Pod[] = [{ id: 'p1', status: 'running' }];
    expect(() => resolveEndpoint(makeHost(pods))).toThrow(
      /no gateway URL\/key/,
    );
  });

  it('returns endpoint for the alphabetically-first running pod', () => {
    const pods: Pod[] = [
      {
        id: 'pZ',
        status: 'running',
        meta: { gatewayUrl: 'http://z', gatewayKey: 'kz' },
      },
      {
        id: 'pA',
        status: 'running',
        meta: { gatewayUrl: 'http://a', gatewayKey: 'ka' },
      },
    ];
    const ep = resolveEndpoint(makeHost(pods));
    expect(ep.podId).toBe('pA');
    expect(ep.url).toBe('http://a');
    expect(ep.source).toBe('pod');
  });

  it('skips offline pods even when they appear earlier alphabetically', () => {
    const pods: Pod[] = [
      { id: 'pA', status: 'stopped' },
      {
        id: 'pB',
        status: 'running',
        meta: { gatewayUrl: 'http://b', gatewayKey: 'kb' },
      },
    ];
    const ep = resolveEndpoint(makeHost(pods));
    expect(ep.podId).toBe('pB');
  });
});

describe('router — discoverModels', () => {
  it('parses /v1/models response into ModelInfo[]', async () => {
    const host: HostClient = {
      ...makeHost([]),
      daemon: {
        state: { agents: [], included: [] },
        onStateChange: () => () => {},
        callPodEndpoint: async () =>
          new Response(
            JSON.stringify({
              data: [
                { id: 'gpt-4o', context_window: 128000, supports_tools: true },
                { id: 'embed-1', kind: 'embed' },
                { not_an_id: true }, // skipped
              ],
            }),
          ),
        chatAgent: stubChatAgent,
        music: stubMusic,
        juli3taLibrary: stubJuli3ta,
      },
    };
    const ep: Endpoint = {
      url: 'http://x',
      key: 'k',
      source: 'pod',
      podId: 'p',
    };
    const models = await discoverModels(ep, host);
    expect(models).toEqual([
      {
        id: 'gpt-4o',
        kind: 'chat',
        contextWindow: 128000,
        supportsTools: true,
      },
      { id: 'embed-1', kind: 'embed', contextWindow: undefined, supportsTools: undefined },
    ]);
  });

  it('throws PodOfflineError on non-200 response', async () => {
    const host = {
      ...makeHost([]),
      daemon: {
        state: { agents: [], included: [] },
        onStateChange: () => () => {},
        callPodEndpoint: async () =>
          new Response('forbidden', { status: 403 }),
        chatAgent: stubChatAgent,
        music: stubMusic,
        juli3taLibrary: stubJuli3ta,
      },
    } as HostClient;
    const ep: Endpoint = {
      url: 'http://x',
      key: 'k',
      source: 'pod',
      podId: 'p',
    };
    await expect(discoverModels(ep, host)).rejects.toBeInstanceOf(
      PodOfflineError,
    );
  });
});

describe('router — pickModel', () => {
  const models: ModelInfo[] = [
    { id: 'small', kind: 'chat', contextWindow: 32000 },
    { id: 'large', kind: 'chat', contextWindow: 128000 },
    { id: 'embed-a', kind: 'embed' },
    { id: 'embed-b', kind: 'embed' },
  ];

  it('picks highest-context-window chat model', () => {
    expect(pickModel(models, 'chat')?.id).toBe('large');
  });

  it('breaks ties by id alphabetical', () => {
    expect(pickModel(models, 'embed')?.id).toBe('embed-a');
  });

  it('returns null when no model matches the kind', () => {
    expect(pickModel([{ id: 'chat-1', kind: 'chat' }], 'embed')).toBeNull();
  });
});
