// Tiny route-based fetch fake for unit tests. No MSW dependency — keeps the
// test surface deterministic and the dependency tree small.

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface RouteSpec {
  method: Method;
  path: string;
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
  // Per-call assertion hook; receives the parsed init.
  expect?: (init: RequestInit | undefined) => void;
}

export interface FakeFetchHandle {
  fetch: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
}

const matchRoute = (
  routes: RouteSpec[],
  method: string,
  path: string,
): RouteSpec | undefined =>
  routes.find((r) => r.method === method && r.path === path);

export const makeFakeFetch = (
  routes: RouteSpec[],
  fallback?: { status: number; body?: unknown; text?: string },
): FakeFetchHandle => {
  const calls: FakeFetchHandle["calls"] = [];

  const f: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    calls.push({ url, init });
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname + (parsed.search ?? "");
    const method = (init?.method ?? "GET").toUpperCase();
    const route = matchRoute(routes, method, path);
    if (!route) {
      if (fallback) {
        const text = fallback.text ?? JSON.stringify(fallback.body ?? null);
        return new Response(text, {
          status: fallback.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`fakeFetch: no route for ${method} ${path}`);
    }
    if (route.expect) route.expect(init);

    const status = route.status ?? 200;
    let body: string;
    if (route.text !== undefined) body = route.text;
    else body = JSON.stringify(route.body ?? null);

    return new Response(body, {
      status,
      headers: {
        "Content-Type": "application/json",
        ...(route.headers ?? {}),
      },
    });
  };

  return { fetch: f, calls };
};

export const networkErrorFetch = (cause: Error): typeof fetch => {
  return async () => {
    throw cause;
  };
};
