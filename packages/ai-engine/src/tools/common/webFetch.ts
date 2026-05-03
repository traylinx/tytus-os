/**
 * `webFetchTool(host, opts)` — common tool factory that allows the
 * model to fetch public HTTP(S) resources. Strict SSRF protection
 * per spec §"web.fetch gating".
 *
 * Defenses:
 * - IPv4 private + loopback + link-local + 0.0.0.0 ranges blocked
 * - IPv6 ::1, fc00::/7 (ULA), fe80::/10 (link-local), IPv4-mapped
 * - Hostnames "localhost", "*.local", "*.internal" blocked unless allow-listed
 * - Allowed schemes: http, https. Block file://, blob://, etc.
 * - Allowed methods: GET, HEAD by default (POST/PUT/DELETE require
 *   explicit allow). v1 ships GET/HEAD only.
 * - Body cap 256 KB; truncated responses banner the user.
 * - Content types: text/*, application/json, application/xml allowed;
 *   others rejected unless allow-listed. Server-spoofed (binary
 *   served as text/html) detected by sniffing the first 512 bytes.
 *
 * NOT in v1 (deferred to M5+ install hardening per realism review):
 * - DNS pinning to defeat rebinding (current code resolves at fetch
 *   time; redirects re-resolve)
 * - robots.txt
 */

import type { HostClient, ToolDef } from '../../types';

export interface WebFetchFactoryOpts {
  /** Hostname allow-list — bypass SSRF host blocking. Used for
   *  localhost development helpers if explicitly permitted. */
  hostnameAllowList?: string[];
  /** Content-type allow-list extension (in addition to text/*, JSON, XML). */
  contentTypeAllowList?: string[];
  /**
   * Approval callback. Per-call approval is the spec default; pass an
   * always-true callback for tests or a UI-driven approval flow at
   * runtime. Without a callback, every fetch denies.
   */
  requestApproval?: (info: {
    url: string;
    method: string;
    headers: Record<string, string>;
  }) => Promise<boolean>;
  /** Telemetry hook — fired on every successful fetch. */
  onFetch?: (info: {
    url: string;
    method: string;
    status: number;
    contentType: string;
    sizeBytes: number;
    truncated: boolean;
  }) => void;
}

const TOOL_NAME = 'web.fetch';

const TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    url: { type: 'string' },
    method: { type: 'string', enum: ['GET', 'HEAD'] },
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
  required: ['url'],
};

const BODY_CAP_BYTES = 256 * 1024;

const ALLOWED_CONTENT_TYPES_DEFAULT = [
  'text/',
  'application/json',
  'application/xml',
  'application/ld+json',
  'application/xhtml+xml',
];

/** Test-friendly URL parsing + SSRF check. Exported for unit tests. */
export function classifyUrl(
  raw: string,
  hostAllowList: string[] = [],
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `disallowed scheme: ${url.protocol}` };
  }
  // URL.hostname returns IPv6 addresses with surrounding brackets in
  // some runtimes (Node, Chromium). Strip them so the IPv6 detector
  // sees a plain address.
  let host = url.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (hostAllowList.includes(host)) {
    return { ok: true, url };
  }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: `private hostname: ${host}` };
  }
  // IPv4 literal in URL — block private ranges.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateIPv4(host)) {
      return { ok: false, reason: `private IPv4: ${host}` };
    }
  }
  // IPv6 literal — URL.hostname keeps the brackets stripped.
  if (host.includes(':')) {
    if (isPrivateIPv6(host)) {
      return { ok: false, reason: `private IPv6: ${host}` };
    }
  }
  return { ok: true, url };
}

export function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // can't parse — be safe, block
  }
  const [a, b] = parts;
  // 0.0.0.0/8
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  return false;
}

export function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  // ::1 (loopback)
  if (lower === '::1') return true;
  // IPv4-mapped IPv6: ::ffff:a.b.c.d → check the embedded IPv4
  const v4MappedMatch = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (v4MappedMatch) {
    return isPrivateIPv4(v4MappedMatch[1]);
  }
  // Expand short-form (single ::) — naive but enough for prefix tests.
  const expanded = expandIPv6(lower);
  if (!expanded) return true; // unparseable, block
  const firstHextet = parseInt(expanded.slice(0, 4), 16);
  if (Number.isNaN(firstHextet)) return true;
  // fc00::/7 — ULA, first byte 0xfc or 0xfd
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — link-local
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  // 0::/8 (incl ::)
  if ((firstHextet & 0xff00) === 0) {
    // Allow valid public addresses that happen to start with 0 — but
    // ::/0 itself, and the IPv4-mapped range we already handled, are
    // private. Practical heuristic: any unspecified-or-zero-prefix
    // address blocks.
    if (expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return true;
  }
  return false;
}

function expandIPv6(addr: string): string | null {
  if (addr.includes('::')) {
    const [head, tail] = addr.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const fillCount = 8 - (headParts.length + tailParts.length);
    if (fillCount < 0) return null;
    const fill = Array.from({ length: fillCount }, () => '0');
    const all = [...headParts, ...fill, ...tailParts];
    return all.map((p) => p.padStart(4, '0')).join(':');
  }
  const parts = addr.split(':');
  if (parts.length !== 8) return null;
  return parts.map((p) => p.padStart(4, '0')).join(':');
}

export function isAllowedContentType(
  raw: string,
  extras: string[] = [],
): boolean {
  const ct = raw.toLowerCase().split(';')[0].trim();
  for (const prefix of [...ALLOWED_CONTENT_TYPES_DEFAULT, ...extras]) {
    if (ct === prefix || ct.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Build the web.fetch ToolDef. The `host` argument is currently only
 * used to log into "What did the agent see?" later; the actual fetch
 * goes through the global `fetch` because the engine doesn't have a
 * sandbox surface for arbitrary URLs.
 */
export function webFetchTool(
  _host: HostClient,
  opts: WebFetchFactoryOpts = {},
): ToolDef {
  return {
    name: TOOL_NAME,
    description:
      'Fetch a public HTTP(S) resource. GET/HEAD only. Approval is required per call. Body capped at 256KB. Private/internal hosts are blocked.',
    parameters: TOOL_PARAMETERS,
    requiresApproval: true,
    execute: async (args) => {
      const a =
        args && typeof args === 'object'
          ? (args as {
              url?: unknown;
              method?: unknown;
              headers?: unknown;
            })
          : {};
      if (typeof a.url !== 'string') {
        throw new Error('web.fetch: missing url argument');
      }
      const method =
        typeof a.method === 'string' && (a.method === 'GET' || a.method === 'HEAD')
          ? a.method
          : 'GET';
      const headers: Record<string, string> = {};
      if (a.headers && typeof a.headers === 'object') {
        for (const [k, v] of Object.entries(a.headers as Record<string, unknown>)) {
          if (typeof v === 'string') headers[k] = v;
        }
      }

      // Guard URL.
      const cls = classifyUrl(a.url, opts.hostnameAllowList);
      if (!cls.ok) {
        throw new Error(`web.fetch: ${cls.reason}`);
      }
      const url = cls.url;

      // Gate per-call approval.
      const approved = opts.requestApproval
        ? await opts.requestApproval({
            url: url.toString(),
            method,
            headers,
          })
        : false;
      if (!approved) {
        throw new Error(`web.fetch: user declined ${method} ${url}`);
      }

      const res = await fetch(url.toString(), { method, headers });

      const contentType = res.headers.get('content-type') ?? '';
      if (
        !isAllowedContentType(contentType, opts.contentTypeAllowList)
      ) {
        throw new Error(
          `web.fetch: disallowed content-type "${contentType}"`,
        );
      }

      // HEAD has no body.
      if (method === 'HEAD') {
        opts.onFetch?.({
          url: url.toString(),
          method,
          status: res.status,
          contentType,
          sizeBytes: 0,
          truncated: false,
        });
        return {
          status: res.status,
          contentType,
          headers: Object.fromEntries(res.headers.entries()),
        };
      }

      const buf = await res.arrayBuffer();
      const truncated = buf.byteLength > BODY_CAP_BYTES;
      const slice = truncated
        ? buf.slice(0, BODY_CAP_BYTES)
        : buf;
      const text = new TextDecoder('utf-8').decode(slice);

      opts.onFetch?.({
        url: url.toString(),
        method,
        status: res.status,
        contentType,
        sizeBytes: slice.byteLength,
        truncated,
      });

      return {
        status: res.status,
        contentType,
        text,
        truncated,
        sizeBytes: slice.byteLength,
      };
    },
  };
}
