import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssetEscapeError,
  AssetTooLargeError,
  PermissionDeniedError,
  type AnyWindowArgs,
  type DaemonState,
  type Manifest,
  type Pod,
  type ShellMenuSpec,
} from '@tytus/host-api';
import type { Db, SqlValue } from '@/lib/db/types';
import { setDbForTesting } from '@/lib/db';
import sheetManifest from '../../../packages/app-sheet/tytus-app.json';
import { seedInstalledApps } from './installed-apps-repo';
import {
  clearNotificationQueue,
  createSessionStub,
  getNotificationQueue,
  getShellEventBus,
  makeAppBootEnv,
  makeHostForApp,
  setDaemonStateProvider,
  setShellMenuActions,
  setWindowsActions,
  type ShellPodDescriptor,
} from './host-impl';

const fakeManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  icon: 'Box',
  category: 'Utilities' as const,
  description: 'Test fixture',
  window: {
    defaultSize: { width: 100, height: 100 },
    minSize: { width: 100, height: 100 },
  },
  permissions: [],
  entry: { module: '/demo/index.js' },
};

const fakeEntryUrls = {
  module: '/demo/index.js',
  assets: 'http://localhost/_apps/demo/assets',
  css: null,
};

afterEach(() => {
  getShellEventBus().__reset();
  clearNotificationQueue();
  setDaemonStateProvider(null);
  setWindowsActions(null);
  setShellMenuActions(null);
  setDbForTesting(null);
  vi.unstubAllGlobals();
});

describe('makeHostForApp — shape', () => {
  it('binds the appId on the returned client', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(host.appId).toBe('demo');
  });

  it('exposes all host namespaces', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    for (const ns of [
      'fs',
      'daemon',
      'windows',
      'notifications',
      'shellMenu',
      'i18n',
      'storage',
      'events',
      'ai',
      'media',
      'assets',
    ] as const) {
      expect(host[ns], `host.${ns} should exist`).toBeDefined();
    }
  });
});

describe('makeHostForApp — host.ai permissions', () => {
  it('blocks artifact APIs unless the app declares ai.artifacts', async () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);

    await expect(Promise.resolve().then(() => host.ai!.listArtifacts({ threadId: 'thr_1' }))).rejects.toThrow(
      PermissionDeniedError,
    );
    await expect(
      Promise.resolve().then(() => host.ai!.createArtifact({
        threadId: 'thr_1',
        title: 'Plan',
        kind: 'markdown',
        body: '# plan',
      })),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(Promise.resolve().then(() => host.ai!.deleteArtifact('art_1'))).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('blocks thread mutation APIs unless the app declares ai.chat', async () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);

    await expect(
      Promise.resolve().then(() => host.ai!.updateThread({ threadId: 'thr_1', title: 'Renamed' })),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe('makeHostForApp — events bus', () => {
  it('delivers payloads to subscribers', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const seen: Array<{ kind: string }> = [];
    const off = host.events.on('vfs.changed', (p) => seen.push({ kind: p.kind }));
    host.events.emit('vfs.changed', {
      fileNodeId: 'x',
      parentId: 'p',
      kind: 'created',
    });
    expect(seen).toEqual([{ kind: 'created' }]);
    off();
    host.events.emit('vfs.changed', {
      fileNodeId: 'y',
      parentId: 'p',
      kind: 'modified',
    });
    expect(seen).toHaveLength(1);
  });

  it('shares the bus across HostClients (singleton)', () => {
    const a = makeHostForApp('a', { ...fakeManifest, id: 'a' }, fakeEntryUrls);
    const b = makeHostForApp('b', { ...fakeManifest, id: 'b' }, fakeEntryUrls);
    const seen: string[] = [];
    a.events.on('app.uninstalled', (p) => seen.push(`a:${p.appId}`));
    b.events.on('app.uninstalled', (p) => seen.push(`b:${p.appId}`));
    b.events.emit('app.uninstalled', { appId: 'gone' });
    expect(seen.sort()).toEqual(['a:gone', 'b:gone']);
  });

  it('isolates listener errors so one bad handler does not break others', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const seen: string[] = [];
    host.events.on('app.uninstalled', () => {
      throw new Error('boom');
    });
    host.events.on('app.uninstalled', (p) => seen.push(p.appId));
    host.events.emit('app.uninstalled', { appId: 'x' });
    expect(seen).toEqual(['x']);
  });
});

describe('makeHostForApp — assets', () => {
  it('rejects path traversal attempts', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(() => host.assets.url('../etc/passwd')).toThrow(AssetEscapeError);
    expect(() => host.assets.url('/abs/path')).toThrow(AssetEscapeError);
  });

  it('produces correct URLs joining the assets root', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(host.assets.url('prompts/sheet.md')).toBe(
      'http://localhost/_apps/demo/assets/prompts/sheet.md',
    );
  });

  it('throws AssetTooLargeError when the asset exceeds 1 MB', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response(big));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    await expect(host.assets.text('big.json')).rejects.toBeInstanceOf(
      AssetTooLargeError,
    );
  });
});

describe('makeHostForApp — i18n passthrough', () => {
  it('returns the key when no vars supplied', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(host.i18n.t('hello.world')).toBe('hello.world');
    expect(host.i18n.locale).toBe('en');
  });

  it('substitutes {var} placeholders from the vars map', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(host.i18n.t('hello, {name}', { name: 'Sebastian' })).toBe(
      'hello, Sebastian',
    );
  });
});

describe('makeHostForApp — notifications', () => {
  it('records each notify call into the inspectable queue', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    host.notifications.notify({ title: 'Saved', body: 'OK', level: 'success' });
    const queue = getNotificationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].appId).toBe('demo');
    expect(queue[0].title).toBe('Saved');
  });
});

describe('makeHostForApp — stubbed namespaces throw with milestone hints', () => {
  it('fs is REAL (localStorage-backed) — PR5 — but throws on missing nodes', async () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    await expect(host.fs.read('does-not-exist')).rejects.toThrow(
      /node not found/,
    );
    // ensureUserFolder pre-seeds; reading the folder doesn't throw.
    const docs = await host.fs.ensureUserFolder('documents');
    expect(typeof docs).toBe('string');
  });

  it('storage.forApp throws permission-denied for app-side calls', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(() => host.storage.forApp('other')).toThrow(
      /privileged path only/,
    );
  });

  it('storage.forSharedKey throws when the bound app did not declare the permission', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(() => host.storage.forSharedKey('voice_recordings')).toThrow(
      PermissionDeniedError,
    );
  });
});

describe('createSessionStub', () => {
  it('throws with an M2 hint when invoked', () => {
    const cs = createSessionStub();
    expect(() =>
      cs({
        app: 'sheet',
        mode: 'default',
        documentId: 'd',
        documentRevision: 0,
        tools: [],
      }),
    ).toThrow(/wired in M2/);
  });
});

describe('makeAppBootEnv', () => {
  it('returns a HostClient + a callable createSession', () => {
    const env = makeAppBootEnv('demo', fakeManifest, fakeEntryUrls);
    expect(env.host.appId).toBe('demo');
    expect(typeof env.createSession).toBe('function');
  });
});

// ─── W2 — daemon.callPodEndpoint ──────────────────────────────────────

describe('daemon.callPodEndpoint', () => {
  const wirePod = (
    pod: Pod | null,
    bearer: string | null = 'tok-abc123',
  ): void => {
    const state: DaemonState = {
      agents: [],
      included: pod ? [pod] : [],
    };
    setDaemonStateProvider({
      getState: () => state,
      getPod: (id) => {
        if (!pod || pod.id !== id) return null;
        return { pod, bearer } satisfies ShellPodDescriptor;
      },
      subscribe: () => () => {},
    });
  };

  it('routes through the same-origin tray proxy without exposing Authorization', async () => {
    wirePod({
      id: 'p1',
      status: 'running',
      publicUrl: 'https://pod-1.example/api',
    });
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchSpy);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const res = await host.daemon.callPodEndpoint('p1', '/v1/models');
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/pods/p1/proxy/v1/models');
    const auth = (init as RequestInit | undefined)?.headers as Headers;
    expect(auth.get('Authorization')).toBeNull();
  });

  it('throws a clear error when the pod is missing from daemon state', async () => {
    wirePod(null);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    await expect(
      host.daemon.callPodEndpoint('missing', '/v1/models'),
    ).rejects.toThrow(/pod "missing" not found/);
  });

  it('preserves caller headers while stripping gateway Authorization', async () => {
    wirePod({
      id: 'p1',
      status: 'running',
      publicUrl: 'https://pod-1.example/api',
    });
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchSpy);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    await host.daemon.callPodEndpoint('p1', '/v1/chat', {
      method: 'POST',
      headers: { 'X-Custom': 'yes' },
      body: '{}',
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get('X-Custom')).toBe('yes');
    expect(headers.get('Authorization')).toBeNull();
    expect(init.method).toBe('POST');
  });
});

describe('daemon state bridge', () => {
  const makeProvider = (stateRef: { current: DaemonState }) => {
    const listeners = new Set<(s: DaemonState) => void>();
    return {
      provider: {
        getState: () => stateRef.current,
        getPod: () => null,
        subscribe: (fn: (s: DaemonState) => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      emit: () => {
        for (const fn of listeners) fn(stateRef.current);
      },
    };
  };

  const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  it('keeps host.daemon.state live when the provider is wired after host creation', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(host.daemon.state.included).toHaveLength(0);

    const stateRef = {
      current: {
        agents: [],
        included: [{ id: 'ail-04', status: 'running' }],
      } satisfies DaemonState,
    };
    const { provider } = makeProvider(stateRef);
    setDaemonStateProvider(provider);

    expect(host.daemon.state.included.map((p) => p.id)).toEqual(['ail-04']);
  });

  it('replays current state to subscribers registered before provider wiring', async () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const seen: string[] = [];
    const off = host.daemon.onStateChange((state) => {
      seen.push(state.included.map((p) => p.id).join(','));
    });

    const stateRef = {
      current: {
        agents: [],
        included: [{ id: 'ail-04', status: 'running' }],
      } satisfies DaemonState,
    };
    const { provider, emit } = makeProvider(stateRef);
    setDaemonStateProvider(provider);
    await tick();

    stateRef.current = {
      agents: [],
      included: [{ id: 'ail-05', status: 'running' }],
    };
    emit();

    off();
    expect(seen).toEqual(['ail-04', 'ail-05']);
  });

  it('replays current state to subscribers registered after provider wiring', async () => {
    const stateRef = {
      current: {
        agents: [],
        included: [{ id: 'ail-04', status: 'running' }],
      } satisfies DaemonState,
    };
    const { provider } = makeProvider(stateRef);
    setDaemonStateProvider(provider);

    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const seen: string[] = [];
    const off = host.daemon.onStateChange((state) => {
      seen.push(state.included.map((p) => p.id).join(','));
    });
    await tick();
    off();

    expect(seen).toEqual(['ail-04']);
  });
});

// ─── W2 — daemon.music ────────────────────────────────────────────────

describe('daemon.music', () => {
  it('search() hits /api/music/search and unwraps the results array', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ results: [{ id: 'v1', source: 'youtube', title: 'Song' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const r = await host.daemon.music.search('test', 5);
    expect(r).toEqual([{ id: 'v1', source: 'youtube', title: 'Song' }]);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/music/search?');
    expect(url).toContain('limit=5');
  });

  it('throws on non-2xx with the daemon\'s error code preserved', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: 'music_unavailable' }), {
          status: 503,
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    await expect(host.daemon.music.getStatus()).rejects.toThrow(
      /music_unavailable/,
    );
  });
});

// ─── W2 — daemon.juli3taLibrary ───────────────────────────────────────

describe('daemon.juli3taLibrary', () => {
  it('saveGeneratedTrack POSTs with an Idempotency-Key derived from id+createdAt', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            rootPath: '/x',
            track: {
              id: 't1',
              title: 'T',
              styleTags: '',
              lyricsPreview: '',
              durationMs: 0,
              bitrate: 0,
              sampleRate: 0,
              sizeBytes: 0,
              createdAt: 42,
              audioDataUrl: '',
              specsJson: '',
              coverDataUrl: '',
              theme: 'dark',
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const r = await host.daemon.juli3taLibrary.saveGeneratedTrack({
      id: 't1',
      title: 'T',
      styleTags: '',
      lyricsPreview: '',
      durationMs: 0,
      bitrate: 0,
      sampleRate: 0,
      sizeBytes: 0,
      createdAt: 42,
      audioDataUrl: '',
      specsJson: '',
      coverDataUrl: '',
      theme: 'dark',
    });
    expect(r.id).toBe('t1');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('juli3ta-save-t1-42');
  });

  it('listGeneratedTracks GETs /api/juli3ta/library/tracks and returns the response shape', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ rootPath: '/Music/JULI3TA', tracks: [] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const r = await host.daemon.juli3taLibrary.listGeneratedTracks();
    expect(r.rootPath).toBe('/Music/JULI3TA');
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/juli3ta/library/tracks');
  });

  it('rejects on non-2xx (delete)', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () => new Response('not found', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    await expect(
      host.daemon.juli3taLibrary.deleteGeneratedTrack('missing'),
    ).rejects.toThrow();
  });
});

// ─── W2 — windows.openOrFocus ─────────────────────────────────────────

describe('windows.openOrFocus', () => {
  it('forwards the call to the wired WindowsActions and returns its window-id', () => {
    const calls: Array<[string, AnyWindowArgs | undefined]> = [];
    setWindowsActions({
      open: () => 'open-id',
      openOrFocus: (id, args) => {
        calls.push([id, args]);
        return 'win-42';
      },
      close: () => {},
      addDesktopIcon: () => {},
      current: (appId) => ({ id: 'cur', appId }),
    });
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const id = host.windows.openOrFocus('music-player', {
      kind: 'open-track',
    } as unknown as AnyWindowArgs);
    expect(id).toBe('win-42');
    expect(calls).toEqual([['music-player', { kind: 'open-track' }]]);
  });

  it('throws a clear error when no WindowsActions are wired', () => {
    setWindowsActions(null);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(() => host.windows.openOrFocus('music-player')).toThrow(
      /no WindowsActions wired/,
    );
  });
});

// ─── W2 — shellMenu.register ──────────────────────────────────────────

describe('shellMenu.register', () => {
  it('forwards the spec to the shell-menu actions and returns its disposer', () => {
    const seen: ShellMenuSpec[] = [];
    let disposed = 0;
    setShellMenuActions({
      registerForApp: (spec) => {
        seen.push(spec);
        return () => {
          disposed += 1;
        };
      },
    });
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const dispose = host.shellMenu.register({
      appId: 'demo',
      groups: [{ label: 'File', items: [{ id: 'new', label: 'New' }] }],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].groups[0].label).toBe('File');
    dispose();
    expect(disposed).toBe(1);
  });

  it('returns a no-op disposer when no shell actions are wired', () => {
    setShellMenuActions(null);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const dispose = host.shellMenu.register({
      appId: 'demo',
      groups: [],
    });
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });
});

// ─── W2 — media.requestMicrophone ─────────────────────────────────────

describe('media.requestMicrophone', () => {
  let originalNavigator: Navigator | undefined;
  let originalMediaRecorder: unknown;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
    originalMediaRecorder = (globalThis as unknown as { MediaRecorder?: unknown })
      .MediaRecorder;
  });

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
    (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder =
      originalMediaRecorder as never;
  });

  it('returns the live stream and the first supported mime type from the probe ladder', async () => {
    const fakeStream = { id: 'fake-stream' } as unknown as MediaStream;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: { getUserMedia: vi.fn(async () => fakeStream) },
      },
    });
    (globalThis as unknown as { MediaRecorder: { isTypeSupported(t: string): boolean } }).MediaRecorder = {
      isTypeSupported: (t: string) => t === 'audio/mp4',
    };
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    const r = await host.media.requestMicrophone();
    expect(r.stream).toBe(fakeStream);
    expect(r.mimeType).toBe('audio/mp4');
  });

  it('throws when navigator.mediaDevices.getUserMedia is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    await expect(host.media.requestMicrophone()).rejects.toThrow(
      /getUserMedia is unavailable/,
    );
  });
});

// ─── W2 — storage.forSharedKey ────────────────────────────────────────

class MemoryDb implements Db {
  rows: Array<Record<string, SqlValue>> = [];
  async exec(sql?: string): Promise<void> {
    void sql;
  }
  async query<T>(sql: string, bindings: SqlValue[] = []): Promise<T[]> {
    if (/sqlite_master/i.test(sql)) return [] as unknown as T[];
    // Only the installed_apps repo's SELECTs return rows; every other
    // SELECT (e.g. against an app's physical table) yields [] so the
    // SharedDb path through the prefix guard is the only thing the
    // test exercises here.
    if (!/installed_apps/i.test(sql)) return [] as unknown as T[];
    if (/WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const id = String(bindings[0]);
      return this.rows.filter((r) => r.id === id) as unknown as T[];
    }
    return this.rows as unknown as T[];
  }
  async run(sql: string, bindings: SqlValue[] = []): Promise<void> {
    if (/INSERT\s+INTO\s+installed_apps/i.test(sql)) {
      const [
        id,
        kind,
        manifest_json,
        entry_url,
        assets_url,
        installed_at,
        enabled,
        builtin_protected,
      ] = bindings;
      const idx = this.rows.findIndex((r) => r.id === id);
      const row: Record<string, SqlValue> = {
        id,
        kind,
        manifest_json,
        entry_url,
        assets_url,
        installed_at,
        enabled,
        builtin_protected,
      };
      if (idx >= 0) {
        this.rows[idx].manifest_json = manifest_json;
      } else {
        this.rows.push(row);
      }
    }
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

const sharedReaderManifest: Manifest = {
  ...fakeManifest,
  id: 'music-creator',
  permissions: ['storage.shared.voice_recordings'],
};

const sharedOwnerManifest: Manifest = {
  ...fakeManifest,
  id: 'voice-recorder',
  permissions: [],
  storage: {
    shares: { voice_recordings: 'app_voice_recorder_recordings' },
  },
};


class RecordingMigrationDb extends MemoryDb {
  execSql: string[] = [];
  async exec(sql: string): Promise<void> {
    this.execSql.push(sql);
  }
}

describe('storage.current migrations', () => {
  it('passes manifest-declared SQL migrations into the app DB', async () => {
    const db = new RecordingMigrationDb();
    setDbForTesting(db);
    const host = makeHostForApp('sheet', sheetManifest as Manifest, fakeEntryUrls);

    await host.storage.current().migrate('migrations/');

    expect(db.execSql.join('\n')).toContain(
      'CREATE TABLE IF NOT EXISTS app_sheet_sheets',
    );
  });
});

describe('storage.forSharedKey', () => {
  it('returns a SharedDb whose query() resolves through the owner\'s physical table', async () => {
    const db = new MemoryDb();
    setDbForTesting(db);
    await seedInstalledApps(db, [
      { manifest: sharedOwnerManifest, entryUrl: '', assetsUrl: '' },
      { manifest: sharedReaderManifest, entryUrl: '', assetsUrl: '' },
    ]);
    const host = makeHostForApp(
      'music-creator',
      sharedReaderManifest,
      fakeEntryUrls,
    );
    const sharedDb = host.storage.forSharedKey('voice_recordings');
    expect(sharedDb).not.toBeNull();
    // Querying the owner's physical table is allowed by the prefix guard.
    await expect(
      sharedDb!.query('SELECT * FROM app_voice_recorder_recordings'),
    ).resolves.toEqual([]);
  });

  it('throws PermissionDeniedError when the bound app has no storage.shared.<key> permission', () => {
    const db = new MemoryDb();
    setDbForTesting(db);
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(() => host.storage.forSharedKey('voice_recordings')).toThrow(
      PermissionDeniedError,
    );
  });

  it('throws when no installed app declares the shared key (granted but not satisfied)', async () => {
    const db = new MemoryDb();
    setDbForTesting(db);
    await seedInstalledApps(db, [
      { manifest: sharedReaderManifest, entryUrl: '', assetsUrl: '' },
    ]);
    const host = makeHostForApp(
      'music-creator',
      sharedReaderManifest,
      fakeEntryUrls,
    );
    const sharedDb = host.storage.forSharedKey('voice_recordings');
    await expect(
      sharedDb!.query('SELECT * FROM app_voice_recorder_recordings'),
    ).rejects.toThrow(/no installed app declares storage\.shares\.voice_recordings/);
  });

  it('rejects writes to the shared table — SharedDb has no run()', async () => {
    const db = new MemoryDb();
    setDbForTesting(db);
    await seedInstalledApps(db, [
      { manifest: sharedOwnerManifest, entryUrl: '', assetsUrl: '' },
      { manifest: sharedReaderManifest, entryUrl: '', assetsUrl: '' },
    ]);
    const host = makeHostForApp(
      'music-creator',
      sharedReaderManifest,
      fakeEntryUrls,
    );
    const sharedDb = host.storage.forSharedKey('voice_recordings')!;
    // The SharedDb interface only exposes query — there is no run/migrate
    // surface, so write attempts can't even be expressed at the type
    // level. Confirm at runtime that the returned shape lacks `run`.
    expect((sharedDb as unknown as { run?: unknown }).run).toBeUndefined();
  });
});

// ─── W2 — notifications appId override + unread default ───────────────

describe('notifications.notify — appId / unread', () => {
  it('defaults to the bound app and unread=true', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    host.notifications.notify({ title: 'Hi' });
    const queue = getNotificationQueue();
    expect(queue[0].appId).toBe('demo');
    expect(queue[0].unread).toBe(true);
  });

  it('honours opts.appId override and opts.unread=false', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    host.notifications.notify({
      title: 'Quiet',
      appId: 'memo',
      unread: false,
    });
    const queue = getNotificationQueue();
    expect(queue[0].appId).toBe('memo');
    expect(queue[0].unread).toBe(false);
  });
});
