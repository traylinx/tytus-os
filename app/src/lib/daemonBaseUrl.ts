// Discover the daemon HTTP base URL.
//
// - Production (Tytus OS served by the daemon): empty string => same-origin
//   relative URLs (`/api/...`). The daemon is the SPA's host, so cookies
//   and the same-origin guard align naturally.
//
// - Vite dev server: also empty string. The dev proxy in vite.config.ts
//   forwards `/api` to the daemon and injects `Sec-Fetch-Site: same-origin`
//   on POSTs (Phase 2 step 9).
//
// - Tests / Storybook: pass an explicit baseUrl to createDaemonClient.
//
// The function exists so future deployments (Tytus OS hosted off-host) can
// swap discovery without touching the client.

export const getDaemonBaseUrl = (): string => {
  // Reserved hook for future overrides via a meta tag or env stub.
  return "";
};
