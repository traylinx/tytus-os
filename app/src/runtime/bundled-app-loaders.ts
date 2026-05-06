/**
 * Static dispatch table for bundled-app dynamic imports.
 *
 * Why this file exists
 * --------------------
 * The dynamic loader used to forward runtime URLs directly to the browser,
 * which forwards the runtime URL to the browser unchanged. For a fully
 * qualified `https://` URL that's correct (transport B). For a workspace
 * package specifier like `@tytus/app-sheet` (transport A) it's fatal —
 * the browser sees a bare specifier and rejects it with
 * "Failed to resolve module specifier '@tytus/app-sheet'".
 *
 * The fix is to call each bundled app's `import()` from a static
 * position so Vite's analyser can follow it at build time. The map
 * below is that static position. Adding a new bundled app requires two
 * edits — its manifest entry in `seed-bundled-apps.ts` AND its loader
 * line below — and the integration test `seed-loaders-drift.test.ts`
 * pins the two lists in sync.
 *
 * Resolution rules
 * ----------------
 *   - `@tytus/app-<id>` specifiers go through `BUNDLED_APP_LOADERS`.
 *   - Anything else (https URL, absolute / relative path) falls through
 *     to native `native dynamic import(url)` so transport-B installs
 *     keep working.
 */

export const BUNDLED_APP_LOADERS: Record<
  string,
  () => Promise<{ default?: unknown }>
> = {
  forge: () => import('@tytus/app-forge'),
  'music-player': () => import('@tytus/app-music-player'),
  'voice-recorder': () => import('@tytus/app-voice-recorder'),
  sheet: () => import('@tytus/app-sheet'),
  studio: () => import('@tytus/app-studio'),
  memo: () => import('@tytus/app-memo'),
};

const BUNDLED_PREFIX = '@tytus/app-';

export function isBundledSpecifier(url: string): boolean {
  return url.startsWith(BUNDLED_PREFIX);
}

export function bundledIdFromSpecifier(url: string): string {
  return url.slice(BUNDLED_PREFIX.length);
}

/**
 * Default importModule for the loader stack. Dispatches `@tytus/app-<id>`
 * to the static map so Vite resolves the workspace package; everything
 * else flows through native dynamic import.
 */
export async function importBundledOrUrl(
  url: string,
): Promise<{ default?: unknown }> {
  if (isBundledSpecifier(url)) {
    const id = bundledIdFromSpecifier(url);
    const loader = BUNDLED_APP_LOADERS[id];
    if (!loader) {
      throw new Error(
        `[bundled-app-loaders] no loader registered for "${url}". ` +
          `Add it to BUNDLED_APP_LOADERS (in this file) and to ` +
          `BUNDLED_APP_MANIFESTS (in seed-bundled-apps.ts).`,
      );
    }
    return loader();
  }
  // Transport B (installed third-party app) — fully qualified URL. The
  // remote-loader is the actual caller for these in production; the
  // fallback below is for any caller that hands us a non-bundled
  // specifier directly (e.g. tests).
  return import(/* @vite-ignore */ url);
}
