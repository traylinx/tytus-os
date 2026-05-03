/**
 * Dynamic ESM loader for workspace-package apps.
 *
 * The loader takes a manifest, fetches the app's CSS, runs it through the
 * style-isolator, injects it as inline `<style>`, dynamically imports the
 * app's entry module, builds an AppBootEnv (HostClient + createSession),
 * and hands the React component back to the shell to mount.
 *
 * In M1 the HostClient and createSession come from STUB factories — the
 * full implementations land in PR4 (registry + useHost + makeHostForApp)
 * and M2 (ai-engine package). The loader's shape is locked here so the
 * stubs can swap out without breaking app-side contracts.
 *
 * Per spec §"Loader topology" / §"CSS injection on mount".
 */

import type {
  AppBootEnv,
  AppCreateSession,
  HostClient,
  Manifest,
} from '@tytus/host-api';

import { transformCss, type StyleIsolationOptions } from './style-isolator';

/** Resolved URLs for an app's bundle. The shell's registry computes these
 *  when the app is registered; the loader reads them out of the resolved
 *  manifest at mount time. */
export interface EntryUrls {
  module: string;
  /** Bundle root for `host.assets.*` resolution. */
  assets: string;
  /** Optional CSS file URL. Null when the app ships no CSS. */
  css: string | null;
}

export interface LoadAppOptions {
  appId: string;
  manifest: Manifest;
  entryUrls: EntryUrls;
  /** DOM element with class `.tytus-app-<appId>` already present (the shell
   *  creates it before calling). */
  container: HTMLElement;
  /** Injected for testability. Production code uses the global `fetch`. */
  fetchText?: (url: string) => Promise<string>;
  /** Injected for testability. Production code uses native dynamic import. */
  importModule?: (url: string) => Promise<{ default: AppEntry }>;
  /** Injected for testability. Production code uses `document`. */
  doc?: Document;
  /** Optional warning sink (defaults to console.warn). */
  onWarning?: (warning: string) => void;
}

/** Every workspace package's default export has this shape. */
export type AppEntry = (env: AppBootEnv) => unknown;

export interface LoadedApp {
  appId: string;
  /** The component returned from `mod.default(env)` — the shell renders it. */
  component: unknown;
  /** Disposer that removes the inline <style> tag. The shell calls this on
   *  unmount so old app CSS doesn't accumulate after window close. */
  dispose: () => void;
  /** Diagnostics from the style-isolator (rejections, warnings). */
  styleWarnings: string[];
}

/** Stub: PR4 replaces this with a real implementation in
 *  `apps/host/src/runtime/legacy-shim.ts`. The stub returns enough of the
 *  HostClient surface for the loader to compile + early-tests to mock-call. */
function makeHostForAppStub(
  appId: string,
  _manifest: Manifest,
  _entryUrls: EntryUrls,
): HostClient {
  const notImpl = (name: string) => {
    return () => {
      throw new Error(
        `host.${name} is not implemented in M1 PR3 stub — fills in PR4.`,
      );
    };
  };
  return {
    appId,
    fs: {
      ensureUserFolder: notImpl('fs.ensureUserFolder'),
      read: notImpl('fs.read'),
      write: notImpl('fs.write'),
      createFile: notImpl('fs.createFile'),
      createFolder: notImpl('fs.createFolder'),
      rename: notImpl('fs.rename'),
      list: notImpl('fs.list'),
      findChildByName: notImpl('fs.findChildByName'),
      getNodeById: notImpl('fs.getNodeById'),
      getIconForFileName: () => 'File',
      watch: () => () => {},
    },
    daemon: {
      state: { agents: [], included: [] },
      onStateChange: () => () => {},
      callPodEndpoint: notImpl('daemon.callPodEndpoint'),
    },
    windows: {
      current: { id: 'stub', appId },
      open: notImpl('windows.open'),
      openOrFocus: notImpl('windows.openOrFocus'),
      close: notImpl('windows.close'),
      addDesktopIcon: notImpl('windows.addDesktopIcon'),
    },
    notifications: { notify: () => {} },
    shellMenu: { register: () => () => {} },
    i18n: {
      locale: 'en',
      t: (key) => key,
      onLocaleChange: () => () => {},
    },
    storage: {
      current: notImpl('storage.current'),
      forApp: notImpl('storage.forApp'),
      forSharedKey: () => null,
    },
    events: {
      on: () => () => {},
      emit: () => {},
    },
    media: {
      requestMicrophone: notImpl('media.requestMicrophone'),
      requestDisplay: notImpl('media.requestDisplay'),
    },
    assets: {
      text: notImpl('assets.text'),
      bytes: notImpl('assets.bytes'),
      url: () => '',
    },
  };
}

/** Stub: M2 replaces this with the real engine `createSession` factory. The
 *  stub throws if any AI app actually tries to send — fine for M1 because
 *  PR5's Notes proof doesn't use AI. */
function createSessionStub(): AppCreateSession {
  return () => {
    throw new Error(
      'createSession is not available in M1 PR3 stub — fills in M2 (ai-engine package).',
    );
  };
}

/**
 * Inject the app's CSS into the document. The transformed stylesheet is
 * inline (not a `<link>`) so global rules can never apply pre-scoping.
 * Returns a disposer that removes the injected `<style>` tag.
 */
async function mountAppStyles(opts: {
  appId: string;
  cssUrl: string;
  fetchText: (url: string) => Promise<string>;
  doc: Document;
  warnings: string[];
  isolationOptions?: Pick<StyleIsolationOptions, 'allowGlobalEscape'>;
}): Promise<() => void> {
  const cssText = await opts.fetchText(opts.cssUrl);
  const result = transformCss(cssText, {
    appId: opts.appId,
    allowGlobalEscape: opts.isolationOptions?.allowGlobalEscape,
  });
  opts.warnings.push(...result.warnings);

  const style = opts.doc.createElement('style');
  style.dataset.tytusApp = opts.appId;
  style.textContent = result.css;
  opts.doc.head.appendChild(style);

  return () => {
    style.parentNode?.removeChild(style);
  };
}

/**
 * Mount an app: fetch+transform+inject CSS → dynamic-import entry →
 * build AppBootEnv → call default export. Returns the React component
 * the shell will render plus a disposer for the injected style tag.
 */
export async function loadApp(opts: LoadAppOptions): Promise<LoadedApp> {
  const {
    appId,
    manifest,
    entryUrls,
    fetchText = (url) => fetch(url).then((r) => r.text()),
    importModule = (url) => import(/* @vite-ignore */ url),
    doc = document,
    onWarning = (w) => console.warn('[tytus-loader]', w),
  } = opts;

  const styleWarnings: string[] = [];
  let disposeStyles: () => void = () => {};

  if (entryUrls.css) {
    disposeStyles = await mountAppStyles({
      appId,
      cssUrl: entryUrls.css,
      fetchText,
      doc,
      warnings: styleWarnings,
    });
  }

  for (const w of styleWarnings) {
    onWarning(w);
  }

  const mod = await importModule(entryUrls.module);
  if (typeof mod.default !== 'function') {
    disposeStyles();
    throw new Error(
      `App "${appId}" entry "${entryUrls.module}" did not export a default function.`,
    );
  }

  const host = makeHostForAppStub(appId, manifest, entryUrls);
  const env: AppBootEnv = {
    host,
    createSession: createSessionStub(),
  };
  const component = mod.default(env);

  return {
    appId,
    component,
    dispose: () => {
      disposeStyles();
    },
    styleWarnings,
  };
}
