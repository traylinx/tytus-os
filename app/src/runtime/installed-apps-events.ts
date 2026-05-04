/**
 * installed-apps-events.ts — tiny module-level event bus for
 * `installed_apps` mutations.
 *
 * The shell side has two concerns that need to react when the table
 * changes (install / uninstall / reinstall):
 *
 *   1. The App Store UI (`TytusAppsTab`) needs to refresh its list so
 *      the freshly-installed row appears (or the uninstalled row
 *      disappears) without a tab re-mount. v1 already had this — it
 *      uses a local `reloadKey` bump because the click handler is in
 *      the same component.
 *
 *   2. `AppRouter` needs to know which ids are loadable via
 *      `WorkspaceAppHost`. Before this module existed, AppRouter only
 *      consulted the static `WORKSPACE_APP_IDS` Set — so a third-party
 *      app installed at runtime fell through to `<AppPlaceholder/>`
 *      ("App Store can't open installed apps" bug). The new
 *      `useInstalledAppIds` hook subscribes here so AppRouter
 *      re-renders when an install happens.
 *
 * Why a tiny event bus and not Redux / Zustand / context: the only
 * cross-component signal needed is "the installed_apps table changed,
 * re-read it". A single `'changed'` event on a global EventTarget is
 * the smallest primitive that solves it. No payloads — every consumer
 * re-reads the table on its own, which keeps the contract trivially
 * correct under concurrent mutations.
 */

const target = new EventTarget();

/** Event name dispatched after every successful install / uninstall /
 *  reinstall. Consumers should re-read `listInstalledApps(db)`. */
export const INSTALLED_APPS_CHANGED = 'changed' as const;

/** Dispatch a 'changed' event. Called by `installer.ts` after each
 *  successful mutation. Safe to call from non-DOM contexts (Node tests)
 *  because `EventTarget` is a built-in. */
export function notifyInstalledAppsChanged(): void {
  target.dispatchEvent(new Event(INSTALLED_APPS_CHANGED));
}

/** Subscribe to install/uninstall/reinstall events. Returns an
 *  unsubscribe function. */
export function subscribeInstalledAppsChanged(
  listener: () => void,
): () => void {
  const handler = () => listener();
  target.addEventListener(INSTALLED_APPS_CHANGED, handler);
  return () => target.removeEventListener(INSTALLED_APPS_CHANGED, handler);
}

// Test-only reset removed: EventTarget exposes no listener enumeration,
// and tests that need a fresh bus already use `vi.resetModules()` (or
// rely on per-test subscribe/unsubscribe pairs). A no-op marker export
// would just mislead future test authors.
