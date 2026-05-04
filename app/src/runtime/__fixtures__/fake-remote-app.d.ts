/**
 * Type declaration for the JS fixture next to this file. The fixture
 * stays as `.js` because it doubles as a "served by a CDN" stand-in for
 * the dynamic-import in remote-loader.test.ts — the test exercises the
 * same code path the prod loader does (dynamic import → default export
 * is a function). This .d.ts only quiets TS for the test's import.
 */
declare const bootApp: (env?: unknown) => () => null;
export default bootApp;
