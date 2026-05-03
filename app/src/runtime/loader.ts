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
  Manifest,
} from '@tytus/host-api';

import { makeAppBootEnv } from './host-impl';
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

  // Wrap import + entry-call in a single try/catch so any failure (network
  // error during import, default-not-a-function, exception inside the
  // app's bootSheet/bootStudio/...) tears down the already-injected
  // <style> tag instead of leaking it. Without this, the next mount
  // attempt for the same app id stacks a second <style> on top.
  let component: unknown;
  try {
    const mod = await importModule(entryUrls.module);
    if (typeof mod.default !== 'function') {
      throw new Error(
        `App "${appId}" entry "${entryUrls.module}" did not export a default function.`,
      );
    }
    const env: AppBootEnv = makeAppBootEnv(appId, manifest, entryUrls);
    component = mod.default(env);
  } catch (err) {
    disposeStyles();
    throw err;
  }

  return {
    appId,
    component,
    dispose: () => {
      disposeStyles();
    },
    styleWarnings,
  };
}
