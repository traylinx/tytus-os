// Hash-fragment router with nonce preservation. Mirrors the legacy
// Tower convention from `tytus-cli/tray/web/assets/tower.js` so existing
// tray deep-links work unchanged:
//
//   #/run/doctor                 → run a daemon action
//   #/run/test
//   #/run/channels-catalog
//   #/pod/02/restart             → per-pod action
//   #/pod/02/uninstall?confirm=1
//   #/settings                   → settings root
//   #/settings/daemon            → settings sub-section
//   #/                           → home (also empty hash)
//
// `?n=<nanos>` is appended by the tray on every click so the browser
// fires `hashchange` even when the fragment is unchanged. The router
// preserves whatever nonce arrives and adds a fresh one when navigate()
// targets the route that's already current.

export type Route =
  | { kind: "home" }
  | { kind: "run"; action: string; params: URLSearchParams }
  | {
      kind: "pod";
      podId: string;
      action: string;
      params: URLSearchParams;
    }
  | {
      kind: "settings";
      section: string | null;
      params: URLSearchParams;
    }
  | { kind: "unknown"; raw: string; params: URLSearchParams };

const splitHash = (
  hash: string,
): { path: string; query: URLSearchParams } => {
  const stripped = hash.replace(/^#\/?/, "");
  const qix = stripped.indexOf("?");
  const path = qix >= 0 ? stripped.slice(0, qix) : stripped;
  const queryStr = qix >= 0 ? stripped.slice(qix + 1) : "";
  return { path, query: new URLSearchParams(queryStr) };
};

export const parseHash = (hash: string): Route => {
  const { path, query } = splitHash(hash);
  if (!path) return { kind: "home" };
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return { kind: "home" };

  if (parts[0] === "run" && parts[1]) {
    return { kind: "run", action: parts[1], params: query };
  }
  if (parts[0] === "pod" && parts[1] && parts[2]) {
    return {
      kind: "pod",
      podId: parts[1],
      action: parts[2],
      params: query,
    };
  }
  if (parts[0] === "settings") {
    return {
      kind: "settings",
      section: parts[1] ?? null,
      params: query,
    };
  }
  return { kind: "unknown", raw: path, params: query };
};

const routePath = (route: Route): string => {
  switch (route.kind) {
    case "home":
      return "/";
    case "run":
      return `/run/${route.action}`;
    case "pod":
      return `/pod/${route.podId}/${route.action}`;
    case "settings":
      return route.section ? `/settings/${route.section}` : "/settings";
    case "unknown":
      return `/${route.raw.replace(/^\//, "")}`;
  }
};

const routeParams = (route: Route): URLSearchParams => {
  switch (route.kind) {
    case "home":
      return new URLSearchParams();
    case "run":
    case "pod":
    case "settings":
    case "unknown":
      return new URLSearchParams(route.params);
  }
};

export const sameRoute = (a: Route, b: Route): boolean =>
  routePath(a) === routePath(b);

const stripNonce = (params: URLSearchParams): URLSearchParams => {
  const out = new URLSearchParams(params);
  out.delete("n");
  return out;
};

export const buildHash = (
  route: Route,
  options: { nonce?: string } = {},
): string => {
  const path = routePath(route);
  const params = stripNonce(routeParams(route));
  if (options.nonce) params.set("n", options.nonce);
  const q = params.toString();
  return `#${path}${q ? `?${q}` : ""}`;
};

const freshNonce = (): string =>
  // High-resolution stamp so successive clicks generate distinct values.
  // crypto.randomUUID is fine but the legacy tower uses a numeric form
  // ("nanos"); this mirrors that look without needing a tray hook.
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export interface NavigateOptions {
  /** Force `hashchange` to fire by appending a fresh nonce, even when the
   *  route already matches. Default: only when target === current. */
  forceFire?: boolean;
  /** Inject the location for testing. Defaults to globalThis.location. */
  location?: Location;
}

export const navigate = (
  route: Route,
  options: NavigateOptions = {},
): void => {
  const loc = options.location ?? globalThis.location;
  if (!loc) return;
  const current = parseHash(loc.hash);
  const targetSame = sameRoute(current, route);
  const fire = options.forceFire ?? targetSame;
  const nonce = fire ? freshNonce() : undefined;
  const hash = buildHash(route, { nonce });
  loc.hash = hash;
};
