import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadApp, type EntryUrls } from './loader';
import type { Manifest } from '@tytus/host-api';

beforeEach(() => {
  // Clear any style tags injected by earlier tests in this DOM.
  document.head
    .querySelectorAll('style[data-tytus-app]')
    .forEach((s) => s.remove());
});

const fakeManifest: Manifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  icon: 'Box',
  category: 'Utilities',
  description: 'Test fixture for the loader.',
  window: {
    defaultSize: { width: 400, height: 300 },
    minSize: { width: 200, height: 150 },
  },
  permissions: [],
  entry: { module: 'fake://demo/index.js' },
};

const baseEntryUrls: EntryUrls = {
  module: 'fake://demo/index.js',
  assets: 'fake://demo/assets/',
  css: null,
};

function makeContainer(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.classList.add('tytus-app-demo');
  return el;
}

describe('loader.loadApp', () => {
  it('imports the entry module and calls default(env) with a HostClient', async () => {
    const captured: { env?: unknown } = {};
    const result = await loadApp({
      appId: 'demo',
      manifest: fakeManifest,
      entryUrls: baseEntryUrls,
      container: makeContainer(document),
      fetchText: async () => '',
      importModule: async () => ({
        default: (env) => {
          captured.env = env;
          return 'app-component';
        },
      }),
    });
    expect(result.component).toBe('app-component');
    expect(captured.env).toBeDefined();
    const env = captured.env as { host: { appId: string } };
    expect(env.host.appId).toBe('demo');
  });

  it('fetches and injects transformed CSS as inline <style data-tytus-app>', async () => {
    const fetchText = vi.fn(async () => `body { background: red }`);
    const result = await loadApp({
      appId: 'demo',
      manifest: fakeManifest,
      entryUrls: { ...baseEntryUrls, css: 'fake://demo/index.css' },
      container: makeContainer(document),
      fetchText,
      importModule: async () => ({ default: () => 'app' }),
    });
    expect(fetchText).toHaveBeenCalledWith('fake://demo/index.css');
    const style = document.head.querySelector(
      'style[data-tytus-app="demo"]',
    );
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('.tytus-app-demo { background: red }');
    // Disposer removes it.
    result.dispose();
    expect(
      document.head.querySelector('style[data-tytus-app="demo"]'),
    ).toBeNull();
  });

  it('skips style mounting when manifest.entry.css is null', async () => {
    const fetchText = vi.fn();
    await loadApp({
      appId: 'demo',
      manifest: fakeManifest,
      entryUrls: { ...baseEntryUrls, css: null },
      container: makeContainer(document),
      fetchText,
      importModule: async () => ({ default: () => 'app' }),
    });
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('forwards style-isolator warnings to onWarning', async () => {
    const warnings: string[] = [];
    await loadApp({
      appId: 'demo',
      manifest: fakeManifest,
      entryUrls: { ...baseEntryUrls, css: 'fake://demo/index.css' },
      container: makeContainer(document),
      fetchText: async () =>
        `@font-face { font-family: 'X'; src: url('x.woff') } .x { color: red }`,
      importModule: async () => ({ default: () => 'app' }),
      onWarning: (w) => warnings.push(w),
    });
    expect(warnings.some((w) => w.includes('@font-face rejected'))).toBe(true);
  });

  it('throws (and tears down styles) when entry has no default export', async () => {
    await expect(
      loadApp({
        appId: 'demo',
        manifest: fakeManifest,
        entryUrls: { ...baseEntryUrls, css: 'fake://demo/index.css' },
        container: makeContainer(document),
        fetchText: async () => `.x { color: red }`,
        importModule: async () =>
          ({ default: undefined } as unknown as { default: () => unknown }),
      }),
    ).rejects.toThrow(/did not export a default function/);
    // Style was injected then torn down on failure.
    expect(
      document.head.querySelector('style[data-tytus-app="demo"]'),
    ).toBeNull();
  });

  it('tears down styles when importModule itself rejects (regression)', async () => {
    // Codex review M1, HIGH — without the try/catch, the injected <style>
    // leaked when import() rejected.
    await expect(
      loadApp({
        appId: 'demo',
        manifest: fakeManifest,
        entryUrls: { ...baseEntryUrls, css: 'fake://demo/index.css' },
        container: makeContainer(document),
        fetchText: async () => `.x { color: red }`,
        importModule: async () => {
          throw new Error('network failed');
        },
      }),
    ).rejects.toThrow(/network failed/);
    expect(
      document.head.querySelector('style[data-tytus-app="demo"]'),
    ).toBeNull();
  });

  it('tears down styles when the entry default throws (regression)', async () => {
    await expect(
      loadApp({
        appId: 'demo',
        manifest: fakeManifest,
        entryUrls: { ...baseEntryUrls, css: 'fake://demo/index.css' },
        container: makeContainer(document),
        fetchText: async () => `.x { color: red }`,
        importModule: async () => ({
          default: () => {
            throw new Error('boom in bootSheet');
          },
        }),
      }),
    ).rejects.toThrow(/boom in bootSheet/);
    expect(
      document.head.querySelector('style[data-tytus-app="demo"]'),
    ).toBeNull();
  });

  it('exposes the stub HostClient namespaces (M1 surface)', async () => {
    const captured: { env?: unknown } = {};
    await loadApp({
      appId: 'demo',
      manifest: fakeManifest,
      entryUrls: baseEntryUrls,
      container: makeContainer(document),
      importModule: async () => ({
        default: (env) => {
          captured.env = env;
          return 'app';
        },
      }),
    });
    const env = captured.env as {
      host: Record<string, unknown>;
      createSession: unknown;
    };
    // All 10 namespaces present.
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
    ]) {
      expect(env.host[ns], `host.${ns} should exist`).toBeDefined();
    }
    expect(typeof env.createSession).toBe('function');
  });

  it('stub createSession throws (M2 wires the real engine)', async () => {
    let envOut: { createSession: () => unknown } | undefined;
    await loadApp({
      appId: 'demo',
      manifest: fakeManifest,
      entryUrls: baseEntryUrls,
      container: makeContainer(document),
      importModule: async () => ({
        default: (env) => {
          envOut = env as never;
          return 'app';
        },
      }),
    });
    expect(() => envOut!.createSession()).toThrow(
      /createSession is not available.*wired in M2/,
    );
  });
});
