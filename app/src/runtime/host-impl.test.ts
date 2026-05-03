import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssetEscapeError,
  AssetTooLargeError,
} from '@tytus/host-api';
import {
  clearNotificationQueue,
  createSessionStub,
  getNotificationQueue,
  getShellEventBus,
  makeAppBootEnv,
  makeHostForApp,
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
});

describe('makeHostForApp — shape', () => {
  it('binds the appId on the returned client', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(host.appId).toBe('demo');
  });

  it('exposes all 10 namespaces', () => {
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
      'media',
      'assets',
    ] as const) {
      expect(host[ns], `host.${ns} should exist`).toBeDefined();
    }
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
    const fetchSpy = vi.fn(async () => new Response(big));
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

  it('storage.forSharedKey returns null when no share is registered', () => {
    const host = makeHostForApp('demo', fakeManifest, fakeEntryUrls);
    expect(host.storage.forSharedKey('voice_recordings')).toBeNull();
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

