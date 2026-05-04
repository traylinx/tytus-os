/**
 * Tytus externals shim — `react/jsx-runtime`.
 *
 * The automatic JSX runtime (`jsx-runtime`) is required when external
 * apps build with `jsx: 'react-jsx'` (TS) or `automatic` (Babel). It
 * lives at the `react/jsx-runtime` import specifier inside React's
 * package.exports. We re-export the host's loaded copy from
 * window.__TYTUS_EXTERNALS__.reactJsxRuntime.
 */
const rt =
  globalThis.__TYTUS_EXTERNALS__ && globalThis.__TYTUS_EXTERNALS__.reactJsxRuntime;
if (!rt) {
  throw new Error(
    '[tytus-externals] react/jsx-runtime not on window.__TYTUS_EXTERNALS__.',
  );
}

export const { jsx, jsxs, jsxDEV, Fragment } = rt;
