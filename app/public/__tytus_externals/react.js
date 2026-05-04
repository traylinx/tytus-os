/**
 * Tytus externals shim — `react`.
 *
 * Installed apps loaded via `import('https://cdn.../app.js')` mark
 * `react` as an external in their bundler config. The importmap in
 * `app/index.html` rewrites the resulting bare `react` specifier to
 * this URL. This file re-exports the host's already-loaded React
 * singleton stashed on `window.__TYTUS_EXTERNALS__.react` by the host
 * bootstrap (`app/src/runtime/externals/install-host-externals.ts`).
 *
 * Single React instance across host + every installed app — required
 * for hooks / context / suspense to work.
 *
 * Do NOT add bundler-specific syntax here. Native ESM only.
 */
const React = globalThis.__TYTUS_EXTERNALS__ && globalThis.__TYTUS_EXTERNALS__.react;
if (!React) {
  throw new Error(
    '[tytus-externals] react not on window.__TYTUS_EXTERNALS__. The host bootstrap must run installHostExternals() before any installed app loads.',
  );
}

export default React;
export const {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React;
