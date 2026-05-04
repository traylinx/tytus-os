/**
 * Tytus externals shim — `react-dom`.
 * See react.js for the contract. This module re-exports the host's
 * react-dom singleton from window.__TYTUS_EXTERNALS__.reactDom.
 */
const ReactDOM = globalThis.__TYTUS_EXTERNALS__ && globalThis.__TYTUS_EXTERNALS__.reactDom;
if (!ReactDOM) {
  throw new Error(
    '[tytus-externals] react-dom not on window.__TYTUS_EXTERNALS__.',
  );
}

export default ReactDOM;
export const {
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preload,
  preloadModule,
  unstable_batchedUpdates,
  version,
} = ReactDOM;
