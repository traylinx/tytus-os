// ============================================================
// API Tester — HTTP request builder similar to Postman
// ============================================================

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Send, Plus, Trash2, Save, Star, Clock,
  Copy, Globe, Sparkles, Terminal, Folder, FolderPlus,
  ChevronRight, ChevronDown, Pencil, Check, X,
  PanelRight, PanelBottom, AlertTriangle,
} from 'lucide-react';
import { useCurrentWindowArgs } from '@/hooks/useCurrentWindow';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { revealSecret } from '@/lib/secrets';
import {
  listHistory,
  addHistory,
  clearHistory as clearHistoryRepo,
} from '@/lib/repo/apiHistory';
import {
  listCollections,
  upsertCollection,
  deleteCollection as deleteCollectionRepo,
  upsertItem,
  deleteItem as deleteItemRepo,
  renameCollection as renameCollectionRepo,
  renameItem as renameItemRepo,
} from '@/lib/repo/apiCollections';
import { importLegacyApiTesterIfNeeded } from '@/lib/repo/apiTesterMigration';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'var(--accent-success)',
  POST: 'var(--accent-primary)',
  PUT: 'var(--accent-warning)',
  PATCH: 'var(--accent-warning)',
  DELETE: 'var(--accent-error)',
  HEAD: 'var(--accent-info)',
  OPTIONS: 'var(--text-secondary)',
};

// Common HTTP status phrases — Bruno port (trimmed to the codes you'll
// actually hit; falls back to '' for the long tail). Keeps the response
// status readout self-explanatory ("404 Not Found" vs bare "404").
const STATUS_PHRASE: Record<number, string> = {
  100: 'Continue', 101: 'Switching Protocols',
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other',
  304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required',
  403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  408: 'Request Timeout', 409: 'Conflict', 410: 'Gone',
  413: 'Payload Too Large', 415: 'Unsupported Media Type',
  418: "I'm a teapot", 422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented',
  502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

// Bruno's formatters. Bytes → "850B" / "1.4KB" / "2.3MB"; ms → "742ms" / "1.5s".
const formatBytes = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
};
const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

// Derive the Authorization header from the auth tab state. Returns
// null when type is 'none' or the inputs are empty so we don't send
// a bogus blank header.
type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';
interface AuthState {
  type: AuthType;
  bearer: string;
  basicUser: string;
  basicPass: string;
  apiKeyName: string;
  apiKeyValue: string;
}
const buildAuthHeader = (a: AuthState): { key: string; value: string } | null => {
  if (a.type === 'bearer' && a.bearer) {
    return { key: 'Authorization', value: `Bearer ${a.bearer}` };
  }
  if (a.type === 'basic' && (a.basicUser || a.basicPass)) {
    const b64 = btoa(`${a.basicUser}:${a.basicPass}`);
    return { key: 'Authorization', value: `Basic ${b64}` };
  }
  if (a.type === 'apikey' && a.apiKeyName && a.apiKeyValue) {
    return { key: a.apiKeyName, value: a.apiKeyValue };
  }
  return null;
};

// Build a curl one-liner from the current request. Quotes single-quote
// safely by closing/reopening: 'foo'\''bar'. Skips disabled headers.
const escapeShellSingle = (s: string): string => s.replace(/'/g, `'\\''`);
const buildCurl = (
  method: HttpMethod,
  url: string,
  headers: Header[],
  body: string,
  auth: AuthState,
): string => {
  const parts: string[] = [`curl -X ${method} '${escapeShellSingle(url)}'`];
  for (const h of headers) {
    if (!h.enabled || !h.key) continue;
    parts.push(`  -H '${escapeShellSingle(h.key)}: ${escapeShellSingle(h.value)}'`);
  }
  const authHeader = buildAuthHeader(auth);
  if (authHeader && !headers.some((h) => h.enabled && h.key.toLowerCase() === authHeader.key.toLowerCase())) {
    parts.push(`  -H '${escapeShellSingle(authHeader.key)}: ${escapeShellSingle(authHeader.value)}'`);
  }
  if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    parts.push(`  --data '${escapeShellSingle(body)}'`);
  }
  return parts.join(' \\\n');
};

interface Header {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface Param {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface RequestHistory {
  id: string;
  method: HttpMethod;
  url: string;
  status: number;
  time: number;
  timestamp: number;
}

// AIL endpoint collection — built dynamically because the base URL +
// API key come from the included pod (per-user, per-pod). Mirrors the
// alias set we ship on every droplet (see SwitchAILocal config + pinned
// memory `project_ail_kimi_sprint`).
interface AilEndpoint {
  method: HttpMethod;
  path: string;
  desc: string;
  body?: Record<string, unknown>;
}

const AIL_ENDPOINTS: AilEndpoint[] = [
  {
    method: 'GET',
    path: '/models',
    desc: 'List available models',
  },
  {
    method: 'POST',
    path: '/chat/completions',
    desc: 'Chat — ail-compound (default agentic)',
    body: {
      model: 'ail-compound',
      messages: [{ role: 'user', content: 'Hello from API Tester' }],
      stream: false,
    },
  },
  {
    method: 'POST',
    path: '/chat/completions',
    desc: 'Chat — ail-fast (DeepSeek, low-latency)',
    body: {
      model: 'ail-fast',
      messages: [{ role: 'user', content: 'Reply in one word.' }],
      stream: false,
    },
  },
  {
    method: 'POST',
    path: '/chat/completions',
    desc: 'Chat — ail-kimi (Moonshot K2.6, long context)',
    body: {
      model: 'ail-kimi',
      messages: [{ role: 'user', content: 'Summarise: …' }],
      stream: false,
    },
  },
  {
    method: 'POST',
    path: '/chat/completions',
    desc: 'Chat — ail-search (Traylinx agentic web search)',
    body: {
      model: 'ail-search',
      messages: [
        { role: 'user', content: 'Latest Anthropic model release notes?' },
      ],
      stream: false,
    },
  },
  {
    method: 'POST',
    path: '/chat/completions',
    desc: 'Chat — streaming (ail-compound, SSE)',
    body: {
      model: 'ail-compound',
      messages: [{ role: 'user', content: 'Stream me a haiku.' }],
      stream: true,
    },
  },
  {
    method: 'POST',
    path: '/chat/completions',
    desc: 'Chat — provider-pinned (minimax/ail-compound)',
    body: {
      model: 'minimax/ail-compound',
      messages: [{ role: 'user', content: 'Forced upstream pin.' }],
      stream: false,
    },
  },
  {
    method: 'POST',
    path: '/embeddings',
    desc: 'Embeddings — ail-embed',
    body: {
      model: 'ail-embed',
      input: ['hello world'],
    },
  },
  {
    method: 'POST',
    path: '/images/generations',
    desc: 'Image — ail-image (text-to-image)',
    body: {
      model: 'ail-image',
      prompt: 'A serene mountain lake at sunset, photorealistic',
      n: 1,
      size: '1024x1024',
    },
  },
  {
    method: 'POST',
    path: '/audio/transcriptions',
    desc: 'Audio — ail-transcribe (multipart/form-data)',
  },
];

// ============================================================
// User-editable collections
// ============================================================
//
// Backed by SQLite (lib/repo/apiCollections + apiHistory). Layout
// preference still rides localStorage — it's a single boolean, not
// worth a row. The legacy localStorage shapes for collections /
// history are imported once at first mount via
// `importLegacyApiTesterIfNeeded`.

interface CollectionItem {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Header[];
  body: string;
}
interface Collection {
  id: string;
  name: string;
  items: CollectionItem[];
}

const LAYOUT_STORAGE_KEY = 'tytus_api_tester_layout';
const SPLIT_STORAGE_KEY = 'tytus_api_tester_split';
const HISTORY_CAP = 50;

// Body modes — Postman parity. `none` skips the body entirely; `json`
// is the default (most APIs). `form-urlencoded` and `form-data` use
// key/value rows instead of a textarea. `raw` is plain text. `binary`
// and `graphql` are placeholders for now (informative panels).
type BodyMode =
  | 'none'
  | 'json'
  | 'raw'
  | 'form-urlencoded'
  | 'form-data'
  | 'graphql'
  | 'binary';

const BODY_MODES: Array<{ id: BodyMode; label: string }> = [
  { id: 'none', label: 'none' },
  { id: 'form-data', label: 'form-data' },
  { id: 'form-urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'raw', label: 'raw' },
  { id: 'binary', label: 'binary' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'json', label: 'JSON' },
];

// Auto-applied Content-Type when the user picks a body mode. The user
// can still override via the Headers tab (their explicit header wins
// in sendRequest).
const CONTENT_TYPE_FOR: Partial<Record<BodyMode, string>> = {
  json: 'application/json',
  'form-urlencoded': 'application/x-www-form-urlencoded',
  // form-data: browser sets multipart with boundary automatically
  graphql: 'application/json',
  raw: 'text/plain',
};

type Layout = 'right' | 'bottom';
const loadLayout = (): Layout => {
  try {
    const v = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return v === 'bottom' ? 'bottom' : 'right';
  } catch {
    return 'right';
  }
};
const persistLayout = (l: Layout): void => {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, l); } catch { /* noop */ }
};

// Request/response split as a fraction (0..1) of the workspace's main
// axis. Saved per layout because users want different splits in the
// horizontal vs vertical layout (typically more room for body in the
// vertical layout).
const loadSplit = (layout: Layout): number => {
  try {
    const raw = localStorage.getItem(`${SPLIT_STORAGE_KEY}_${layout}`);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0.15 && n <= 0.85) return n;
  } catch { /* noop */ }
  return layout === 'right' ? 0.5 : 0.45;
};
const persistSplit = (layout: Layout, frac: number): void => {
  try { localStorage.setItem(`${SPLIT_STORAGE_KEY}_${layout}`, String(frac)); } catch { /* noop */ }
};

const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export default function ApiTester() {
  const args = useCurrentWindowArgs();
  const daemon = useDaemonStateContext();
  const ail = useMemo(() => {
    const inc = daemon.state?.included[0];
    if (!inc) return null;
    return {
      baseUrl: `${inc.endpoint}/v1`,
      apiKey: revealSecret(inc.user_key, 'user_gesture'),
      podId: inc.pod_id,
    };
  }, [daemon.state]);

  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'auth' | 'body'>('params');
  const [auth, setAuth] = useState<AuthState>({
    type: 'none',
    bearer: '',
    basicUser: '',
    basicPass: '',
    apiKeyName: 'X-API-Key',
    apiKeyValue: '',
  });
  // Pretty/Raw view for the response body. Pretty is default and runs
  // through JSON.parse + stringify when the body is JSON; falls back to
  // the raw text for any other content type.
  const [responseView, setResponseView] = useState<'pretty' | 'raw'>('pretty');
  // Inline flash for the "Copy as cURL" button — short-lived "Copied!"
  // confirmation in the same slot.
  const [curlFlashed, setCurlFlashed] = useState(false);
  const [params, setParams] = useState<Param[]>([{ id: '1', key: '', value: '', enabled: true }]);
  const [headers, setHeaders] = useState<Header[]>([
    { id: '1', key: 'Content-Type', value: 'application/json', enabled: true },
    { id: '2', key: 'Accept', value: 'application/json', enabled: true },
  ]);
  const [body, setBody] = useState('');
  const [bodyMode, setBodyMode] = useState<BodyMode>('json');
  const [formFields, setFormFields] = useState<Param[]>([
    { id: 'f1', key: '', value: '', enabled: true },
  ]);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    time: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<RequestHistory[]>([]);
  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body');
  const [copied, setCopied] = useState(false);

  // Editable user collections + sidebar visibility + layout. Collections
  // and history are SQLite-backed via lib/repo/*. Layout is a single
  // boolean preference and stays on localStorage. Sidebar defaults open
  // when collections exist OR an AIL gateway is available.
  const [collections, setCollections] = useState<Collection[]>([]);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [splitFraction, setSplitFraction] = useState<number>(() => loadLayout() === 'right' ? loadSplit('right') : loadSplit('bottom'));
  // Reload the split when the user toggles layout — they likely have a
  // different preference per layout (e.g. wider request in vertical).
  useEffect(() => { setSplitFraction(loadSplit(layout)); }, [layout]);
  useEffect(() => { persistSplit(layout, splitFraction); }, [layout, splitFraction]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  // Sidebar context — Bruno-style: Collections OR History.
  const [sidebarTab, setSidebarTab] = useState<'collections' | 'history'>('collections');
  // Per-collection expand state in the sidebar tree.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ ail: true });
  // Inline rename state — null means nothing is being renamed.
  const [renaming, setRenaming] = useState<{
    kind: 'collection' | 'item';
    collectionId: string;
    itemId?: string;
    draft: string;
  } | null>(null);
  // Save-to-collection modal state.
  const [savingTo, setSavingTo] = useState<{
    name: string;
    targetCollectionId: string;
  } | null>(null);

  useEffect(() => persistLayout(layout), [layout]);

  // First-mount: import any pre-SQLite localStorage state, then load
  // collections + history from SQLite. Idempotent — the migration
  // marker means the import runs at most once per browser.
  const refreshFromDb = useCallback(async () => {
    try {
      const [rawCols, rawHist] = await Promise.all([listCollections(), listHistory()]);
      setCollections(
        rawCols.map((c) => ({
          id: c.id,
          name: c.name,
          items: c.items.map((i) => ({
            id: i.id,
            name: i.name,
            method: i.method as HttpMethod,
            url: i.url,
            headers: i.headers,
            body: i.body,
          })),
        })),
      );
      setHistory(
        rawHist.map((r) => ({
          id: r.id,
          method: r.method as HttpMethod,
          url: r.url,
          status: r.status,
          time: r.duration_ms,
          timestamp: r.ts,
        })),
      );
    } catch (err) {
      console.warn('[ApiTester] failed to read collections/history from db', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await importLegacyApiTesterIfNeeded();
      if (cancelled) return;
      await refreshFromDb();
    })();
    return () => { cancelled = true; };
  }, [refreshFromDb]);

  const addParam = useCallback(() => {
    setParams((prev) => [...prev, { id: Date.now().toString(), key: '', value: '', enabled: true }]);
  }, []);

  const updateParam = useCallback((id: string, field: 'key' | 'value', value: string) => {
    setParams((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }, []);

  const removeParam = useCallback((id: string) => {
    setParams((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addHeader = useCallback(() => {
    setHeaders((prev) => [...prev, { id: Date.now().toString(), key: '', value: '', enabled: true }]);
  }, []);

  const updateHeader = useCallback((id: string, field: 'key' | 'value', value: string) => {
    setHeaders((prev) => prev.map((h) => h.id === id ? { ...h, [field]: value } : h));
  }, []);

  const removeHeader = useCallback((id: string) => {
    setHeaders((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const addFormField = useCallback(() => {
    setFormFields((prev) => [...prev, { id: Date.now().toString(), key: '', value: '', enabled: true }]);
  }, []);
  const updateFormField = useCallback((id: string, field: 'key' | 'value', value: string) => {
    setFormFields((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }, []);
  const removeFormField = useCallback((id: string) => {
    setFormFields((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // JSON beautify — re-pretty-prints the body. Surfaces parse errors
  // as a small red strip below the editor instead of throwing.
  const beautifyJson = useCallback(() => {
    try {
      const parsed: unknown = JSON.parse(body || 'null');
      setBody(JSON.stringify(parsed, null, 2));
      setBodyError(null);
    } catch (e) {
      setBodyError((e as Error).message);
    }
  }, [body]);

  // Live validity for the JSON editor's validity dot. Empty body is OK.
  const jsonIsValid = useMemo(() => {
    if (bodyMode !== 'json') return true;
    if (!body.trim()) return true;
    try { JSON.parse(body); return true; } catch { return false; }
  }, [body, bodyMode]);

  const buildUrl = useCallback(() => {
    if (!url) return '';
    const enabledParams = params.filter((p) => p.enabled && p.key);
    if (enabledParams.length === 0) return url;
    const qs = enabledParams.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
    return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
  }, [url, params]);

  // Build the actual fetch body + matching Content-Type from the
  // current bodyMode. Returns null when no body should be sent. The
  // caller merges the Content-Type into headerObj (explicit user
  // headers still win, matching Postman's behaviour).
  const buildRequestBody = useCallback((): { body: BodyInit | null; contentType: string | null } => {
    if (bodyMode === 'none' || bodyMode === 'binary') {
      return { body: null, contentType: null };
    }
    if (bodyMode === 'form-urlencoded') {
      const params = new URLSearchParams();
      for (const f of formFields) {
        if (f.enabled && f.key) params.append(f.key, f.value);
      }
      return { body: params.toString(), contentType: CONTENT_TYPE_FOR['form-urlencoded'] ?? null };
    }
    if (bodyMode === 'form-data') {
      const fd = new FormData();
      for (const f of formFields) {
        if (f.enabled && f.key) fd.append(f.key, f.value);
      }
      // Browser sets multipart/form-data + boundary itself.
      return { body: fd, contentType: null };
    }
    // json / raw / graphql — straight string body
    return { body, contentType: CONTENT_TYPE_FOR[bodyMode] ?? null };
  }, [bodyMode, body, formFields]);

  // AbortController for the in-flight request so the user can press
  // "Cancel" (Bruno-style) and bail without waiting for the timeout.
  const abortRef = useRef<AbortController | null>(null);
  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendRequest = useCallback(async () => {
    const finalUrl = buildUrl();
    if (!finalUrl) return;
    setLoading(true);
    setError('');
    setResponse(null);
    const startTime = performance.now();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const enabledHeaders = headers.filter((h) => h.enabled && h.key);
      const headerObj: Record<string, string> = {};
      enabledHeaders.forEach((h) => { headerObj[h.key] = h.value; });

      // Merge the Auth tab's derived header without polluting the
      // headers list. Explicit headers win — letting the user override
      // is a real workflow ("send a stale Authorization to test 401s").
      const authHeader = buildAuthHeader(auth);
      if (authHeader && !Object.keys(headerObj).some((k) => k.toLowerCase() === authHeader.key.toLowerCase())) {
        headerObj[authHeader.key] = authHeader.value;
      }

      // Body + auto Content-Type from the bodyMode pills. Explicit
      // headers still win — see buildAuthHeader's same convention.
      const built = buildRequestBody();
      if (built.contentType && !Object.keys(headerObj).some((k) => k.toLowerCase() === 'content-type')) {
        headerObj['Content-Type'] = built.contentType;
      }

      const opts: RequestInit = {
        method,
        headers: headerObj,
        signal: controller.signal,
      };

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && built.body !== null) {
        opts.body = built.body;
      }

      const res = await fetch(finalUrl, opts);
      const resBody = await res.text();
      const time = Math.round(performance.now() - startTime);

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { responseHeaders[k] = v; });

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: resBody,
        time,
      });

      const newRow: RequestHistory = {
        id: newId(),
        method,
        url: finalUrl,
        status: res.status,
        time,
        timestamp: Date.now(),
      };
      // Optimistic UI + persist to SQLite. The repo trims to HISTORY_CAP
      // server-side, so the in-memory cap is just for the UI.
      setHistory((prev) => [newRow, ...prev].slice(0, HISTORY_CAP));
      void addHistory({
        id: newRow.id,
        method: newRow.method,
        url: newRow.url,
        status: newRow.status,
        duration_ms: newRow.time,
        ts: newRow.timestamp,
      });
    } catch (e) {
      const err = e as Error;
      // Normalise abort vs network errors so the UI can show the
      // right copy ("Cancelled" instead of a cryptic AbortError).
      if (err.name === 'AbortError') {
        setError('Cancelled');
      } else {
        setError(err.message || 'Network error (CORS may be blocking this request)');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [buildUrl, method, headers, body, auth, buildRequestBody]);

  // Cmd/Ctrl+Enter sends the request from anywhere in the app shell
  // (Bruno, Postman, Insomnia all bind this). Shortcuts that depend on
  // current `sendRequest` need a ref so the listener doesn't capture
  // the first render's closure.
  const sendRequestRef = useRef(sendRequest);
  useEffect(() => { sendRequestRef.current = sendRequest; }, [sendRequest]);
  // Same ref pattern for Beautify so the listener doesn't capture
  // stale `body` from the first render's closure.
  const beautifyRef = useRef(beautifyJson);
  useEffect(() => { beautifyRef.current = beautifyJson; }, [beautifyJson]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void sendRequestRef.current();
      }
      // ⌘/Ctrl+B beautifies JSON when the body editor is in focus or
      // the Body tab is active. Cheap to wire globally — only fires
      // when the user explicitly hits the chord.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        beautifyRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const copyAsCurl = useCallback(async () => {
    if (!url) return;
    const finalUrl = buildUrl();
    const curl = buildCurl(method, finalUrl, headers, body, auth);
    try {
      await navigator.clipboard.writeText(curl);
      setCurlFlashed(true);
      window.setTimeout(() => setCurlFlashed(false), 1200);
    } catch {
      setError('Copy failed (clipboard blocked)');
    }
  }, [method, buildUrl, headers, body, auth, url]);

  // Open the "Save to collection" dialog with a sensible default name
  // and the first existing collection pre-selected (or an empty target
  // so the dialog will offer to create a new one).
  const openSaveDialog = useCallback(() => {
    if (!url) return;
    const niceName = (() => {
      try {
        const u = new URL(url);
        return `${method} ${u.pathname || u.host}`;
      } catch {
        return `${method} ${url.slice(0, 40)}`;
      }
    })();
    setSavingTo({
      name: niceName,
      targetCollectionId: collections[0]?.id ?? '',
    });
  }, [method, url, collections]);

  const confirmSave = useCallback(
    async (collectionId: string, name: string, opts?: { newCollectionName?: string }) => {
      if (!url) return;
      const itemId = newId();
      const itemName = name.trim() || `${method} ${url.slice(0, 40)}`;
      let targetId = collectionId;

      if (opts?.newCollectionName) {
        const newColId = newId();
        await upsertCollection({
          id: newColId,
          name: opts.newCollectionName.trim() || 'Untitled',
          pos: collections.length,
        });
        setExpanded((e) => ({ ...e, [newColId]: true }));
        targetId = newColId;
      }

      const target = collections.find((c) => c.id === targetId);
      const pos = target ? target.items.length : 0;

      await upsertItem({
        id: itemId,
        collection_id: targetId,
        name: itemName,
        method,
        url,
        headers: [...headers],
        body,
        pos,
      });
      await refreshFromDb();
      setSavingTo(null);
    },
    [method, url, headers, body, collections, refreshFromDb],
  );

  const loadCollectionItem = useCallback((item: CollectionItem) => {
    setMethod(item.method);
    setUrl(item.url);
    setHeaders(
      item.headers.length > 0
        ? [...item.headers]
        : [{ id: '1', key: '', value: '', enabled: true }],
    );
    setBody(item.body);
  }, []);

  const createCollection = useCallback(async () => {
    const id = newId();
    await upsertCollection({ id, name: 'New Collection', pos: collections.length });
    await refreshFromDb();
    setExpanded((e) => ({ ...e, [id]: true }));
    setRenaming({ kind: 'collection', collectionId: id, draft: 'New Collection' });
  }, [collections.length, refreshFromDb]);

  const deleteCollection = useCallback(async (id: string) => {
    await deleteCollectionRepo(id);
    await refreshFromDb();
  }, [refreshFromDb]);

  const deleteItem = useCallback(async (_collectionId: string, itemId: string) => {
    await deleteItemRepo(itemId);
    await refreshFromDb();
  }, [refreshFromDb]);

  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const trimmed = renaming.draft.trim();
    if (!trimmed) {
      setRenaming(null);
      return;
    }
    if (renaming.kind === 'collection') {
      await renameCollectionRepo(renaming.collectionId, trimmed);
    } else if (renaming.itemId) {
      await renameItemRepo(renaming.itemId, trimmed);
    }
    await refreshFromDb();
    // Also patch local state immediately so the UI doesn't flash.
    setCollections((prev) =>
      prev.map((c) => {
        if (c.id !== renaming.collectionId) return c;
        if (renaming.kind === 'collection') return { ...c, name: trimmed };
        return {
          ...c,
          items: c.items.map((i) =>
            i.id === renaming.itemId ? { ...i, name: trimmed } : i,
          ),
        };
      }),
    );
    setRenaming(null);
  }, [renaming, refreshFromDb]);

  // Load an AIL preset into the form. Wires the bearer token + JSON
  // body + matching content-type so the user can hit Send immediately.
  const loadAilEndpoint = useCallback(
    (ep: AilEndpoint) => {
      if (!ail) return;
      setMethod(ep.method);
      setUrl(`${ail.baseUrl}${ep.path}`);
      const baseHeaders: Header[] = [
        { id: '1', key: 'Content-Type', value: 'application/json', enabled: true },
        { id: '2', key: 'Accept', value: 'application/json', enabled: true },
        { id: '3', key: 'Authorization', value: `Bearer ${ail.apiKey}`, enabled: true },
      ];
      setHeaders(baseHeaders);
      if (ep.body) {
        setBody(JSON.stringify(ep.body, null, 2));
        setActiveTab('body');
      } else {
        setBody('');
        setActiveTab('headers');
      }
    },
    [ail],
  );

  // Auto-load `/models` when launched via Pod Inspector's
  // "Open in → API Tester (preset collection)" deep-link. Fires once
  // per window-open by gating on a ref-style nonce derived from `args`.
  useEffect(() => {
    if (args?.apiTester?.collection !== 'ail') return;
    if (!ail) return;
    if (url) return; // user already started typing — don't clobber
    loadAilEndpoint(AIL_ENDPOINTS[0]);
    setExpanded((e) => ({ ...e, ail: true }));
    setShowSidebar(true);
    // intentionally only on first load: depend on ail readiness so we
    // don't fire before included[0] is populated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ail, args?.apiTester?.collection]);

  const copyResponse = useCallback(async () => {
    if (!response) return;
    await navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [response]);

  const formattedBody = response?.body || '';
  let prettyBody = formattedBody;
  try {
    prettyBody = JSON.stringify(JSON.parse(formattedBody), null, 2);
  } catch { /* not JSON */ }

  const getStatusColor = (s: number) => {
    if (s >= 200 && s < 300) return 'var(--accent-success)';
    if (s >= 300 && s < 400) return 'var(--accent-info)';
    if (s >= 400 && s < 500) return 'var(--accent-warning)';
    return 'var(--accent-error)';
  };

  // URL bar — Postman-style, lives INSIDE the request panel header so
  // the sidebar runs the full app height. method · url · send · cancel ·
  // cURL · save · layout toggle, in that order.
  const urlBar = (
    <div
      className="flex items-center gap-2 px-3 py-2 shrink-0"
      style={{ background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as HttpMethod)}
        className="text-xs font-semibold px-2 py-1.5 rounded-sm outline-none"
        style={{ background: 'var(--bg-input)', color: METHOD_COLORS[method], border: '1px solid var(--border-default)', width: 90 }}
      >
        {Object.keys(METHOD_COLORS).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://api.example.com/users"
        className="flex-1 min-w-0 px-3 py-1.5 rounded-sm text-xs outline-none"
        style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', fontFamily: "'JetBrains Mono', monospace" }}
      />
      {loading ? (
        <button
          onClick={cancelRequest}
          className="flex items-center gap-1 px-4 py-1.5 rounded-sm text-xs font-medium transition-all"
          style={{ background: 'transparent', color: 'var(--accent-error)', border: '1px solid var(--accent-error)' }}
          title="Cancel in-flight request"
        >
          <X size={13} /> Cancel
        </button>
      ) : (
        <button
          onClick={sendRequest}
          disabled={!url}
          className="flex items-center gap-1 px-4 py-1.5 rounded-sm text-xs font-medium disabled:opacity-50 transition-all"
          style={{ background: 'var(--accent-primary)', color: 'white' }}
          title="Send request (⌘/Ctrl+Enter)"
        >
          <Send size={13} /> Send
        </button>
      )}
      <button
        onClick={copyAsCurl}
        disabled={!url}
        className="p-1.5 rounded-sm hover:bg-[var(--bg-hover)] disabled:opacity-40"
        title={curlFlashed ? 'Copied!' : 'Copy as cURL'}
      >
        <Terminal size={14} style={{ color: curlFlashed ? 'var(--accent-success)' : 'var(--text-secondary)' }} />
      </button>
      <button
        onClick={openSaveDialog}
        disabled={!url}
        className="p-1.5 rounded-sm hover:bg-[var(--bg-hover)] disabled:opacity-40"
        title="Save request to a collection"
      >
        <Star size={14} style={{ color: 'var(--text-secondary)' }} />
      </button>
      <button
        onClick={() => setLayout((l) => (l === 'right' ? 'bottom' : 'right'))}
        className="p-1.5 rounded-sm hover:bg-[var(--bg-hover)]"
        title={`Response panel: ${layout === 'right' ? 'right' : 'bottom'} (click to swap)`}
      >
        {layout === 'right' ? (
          <PanelRight size={14} style={{ color: 'var(--text-secondary)' }} />
        ) : (
          <PanelBottom size={14} style={{ color: 'var(--text-secondary)' }} />
        )}
      </button>
    </div>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-window)', color: 'var(--text-primary)' }}>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: Collections (toggleable) */}
        {showSidebar && (
          <div
            className="flex flex-col shrink-0 overflow-hidden"
            style={{
              width: 240,
              background: 'var(--bg-titlebar)',
              borderRight: '1px solid var(--border-subtle)',
            }}
          >
            {/* Tab bar — Bruno-style: Collections / History switch. */}
            <div className="flex items-center shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <SidebarTabBtn
                active={sidebarTab === 'collections'}
                icon={<Folder size={14} />}
                title="Collections"
                onClick={() => setSidebarTab('collections')}
              />
              <SidebarTabBtn
                active={sidebarTab === 'history'}
                icon={<Clock size={14} />}
                title={`History${history.length > 0 ? ` (${history.length})` : ''}`}
                onClick={() => setSidebarTab('history')}
                badge={history.length > 0 ? history.length : undefined}
              />
              <div className="ml-auto pr-2 flex items-center gap-0.5">
                {sidebarTab === 'collections' && (
                  <button
                    onClick={createCollection}
                    className="p-1 rounded-sm hover:bg-[var(--bg-hover)]"
                    title="New collection"
                  >
                    <FolderPlus size={12} style={{ color: 'var(--text-secondary)' }} />
                  </button>
                )}
                {sidebarTab === 'history' && history.length > 0 && (
                  <button
                    onClick={() => {
                      setHistory([]);
                      void clearHistoryRepo();
                    }}
                    className="p-1 rounded-sm hover:bg-[var(--bg-hover)]"
                    title="Clear history"
                  >
                    <Trash2 size={12} style={{ color: 'var(--text-secondary)' }} />
                  </button>
                )}
                <button
                  onClick={() => setShowSidebar(false)}
                  className="p-1 rounded-sm hover:bg-[var(--bg-hover)]"
                  title="Hide sidebar"
                >
                  <X size={12} style={{ color: 'var(--text-secondary)' }} />
                </button>
              </div>
            </div>

            {sidebarTab === 'history' && (
              <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
                {history.length === 0 ? (
                  <div className="px-3 py-4 text-[11px] leading-relaxed" style={{ color: 'var(--text-disabled)' }}>
                    No requests yet. Hit Send and they'll show up here, grouped by day.
                  </div>
                ) : (
                  groupHistoryByDay(history).map(({ label, rows }) => (
                    <div key={label} className="mb-2">
                      <div
                        className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide sticky top-0"
                        style={{ color: 'var(--text-secondary)', background: 'var(--bg-titlebar)' }}
                      >
                        {label}
                      </div>
                      {rows.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => { setMethod(h.method); setUrl(h.url); }}
                          title={`${new Date(h.timestamp).toLocaleString()} · ${h.status} · ${formatDuration(h.time)}`}
                          className="w-full text-left flex items-center gap-1.5 px-3 py-1 hover:bg-[var(--bg-hover)]"
                        >
                          <span className="text-[10px] font-semibold w-10 text-right shrink-0" style={{ color: METHOD_COLORS[h.method] }}>
                            {h.method}
                          </span>
                          <span className="text-[11px] truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                            {urlPathish(h.url)}
                          </span>
                          <span className="text-[10px] tabular-nums shrink-0" style={{ color: getStatusColor(h.status) }}>
                            {h.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}

            {sidebarTab === 'collections' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
              {/* Built-in AIL collection (read-only) — only when an
                  included pod exists. Same tree shape so the user can
                  treat it like any other collection. */}
              {ail && (
                <CollectionRow
                  expanded={!!expanded.ail}
                  onToggle={() => setExpanded((e) => ({ ...e, ail: !e.ail }))}
                  builtin
                  name="AIL Gateway"
                  count={AIL_ENDPOINTS.length}
                >
                  {AIL_ENDPOINTS.map((ep, i) => (
                    <ItemRow
                      key={`ail-${i}`}
                      method={ep.method}
                      label={ep.desc}
                      onClick={() => loadAilEndpoint(ep)}
                    />
                  ))}
                </CollectionRow>
              )}

              {collections.length === 0 && !ail && (
                <div className="px-3 py-4 text-[11px] leading-relaxed" style={{ color: 'var(--text-disabled)' }}>
                  No collections yet. Click <FolderPlus size={11} className="inline" /> to create one,
                  or hit <Save size={11} className="inline" /> on a request to save it here.
                </div>
              )}

              {collections.map((c) => (
                <CollectionRow
                  key={c.id}
                  expanded={!!expanded[c.id]}
                  onToggle={() => setExpanded((e) => ({ ...e, [c.id]: !e[c.id] }))}
                  name={c.name}
                  count={c.items.length}
                  renaming={renaming?.kind === 'collection' && renaming.collectionId === c.id ? renaming.draft : null}
                  onRenameChange={(v) => setRenaming((r) => (r ? { ...r, draft: v } : null))}
                  onRenameCommit={commitRename}
                  onRenameCancel={() => setRenaming(null)}
                  onStartRename={() => setRenaming({ kind: 'collection', collectionId: c.id, draft: c.name })}
                  onDelete={() => {
                    if (window.confirm(`Delete collection "${c.name}" and its ${c.items.length} item${c.items.length === 1 ? '' : 's'}?`)) {
                      deleteCollection(c.id);
                    }
                  }}
                >
                  {c.items.length === 0 && (
                    <div className="pl-7 pr-3 py-1 text-[10px]" style={{ color: 'var(--text-disabled)' }}>
                      Empty — save a request here.
                    </div>
                  )}
                  {c.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      method={item.method}
                      label={item.name}
                      renaming={renaming?.kind === 'item' && renaming.itemId === item.id ? renaming.draft : null}
                      onRenameChange={(v) => setRenaming((r) => (r ? { ...r, draft: v } : null))}
                      onRenameCommit={commitRename}
                      onRenameCancel={() => setRenaming(null)}
                      onStartRename={() => setRenaming({ kind: 'item', collectionId: c.id, itemId: item.id, draft: item.name })}
                      onDelete={() => deleteItem(c.id, item.id)}
                      onClick={() => loadCollectionItem(item)}
                    />
                  ))}
                </CollectionRow>
              ))}
            </div>
            )}
          </div>
        )}

        {!showSidebar && (
          <button
            onClick={() => setShowSidebar(true)}
            className="shrink-0 px-1.5 hover:bg-[var(--bg-hover)] flex items-center"
            style={{ borderRight: '1px solid var(--border-subtle)' }}
            title="Show collections sidebar"
          >
            <Folder size={12} style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}

        {/* Workspace: request + response — flex direction depends on layout.
            Sizes use flex-basis driven by `splitFraction` so the divider can
            slide them in real time. */}
        <div
          ref={workspaceRef}
          className={`flex-1 flex overflow-hidden ${layout === 'right' ? 'flex-row' : 'flex-col'}`}
        >
        {/* Left/top: Request panel — URL bar lives INSIDE the pane (Postman style) */}
        <div
          className="flex flex-col overflow-hidden min-w-0 min-h-0"
          style={{ flex: `${splitFraction} 1 0` }}
        >
          {urlBar}
          {/* Tabs */}
          <div className="flex items-center px-3 shrink-0" style={{ height: 32, background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)' }}>
            {(['params', 'headers', 'auth', 'body'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1 text-xs font-medium capitalize transition-colors flex items-center gap-1"
                style={{
                  color: activeTab === tab ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottom: activeTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent',
                }}
              >
                {tab}
                {tab === 'auth' && auth.type !== 'none' && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: 'var(--accent-primary)' }}
                  />
                )}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={openSaveDialog}
                disabled={!url}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm hover:bg-[var(--bg-hover)] disabled:opacity-40"
                title="Save current request to a collection"
              >
                <Save size={10} /> Save…
              </button>
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto p-3 custom-scrollbar">
            {activeTab === 'params' && (
              <div className="flex flex-col gap-1">
                {params.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={p.enabled} onChange={() => {}} className="accent-purple-500" />
                    <input
                      value={p.key}
                      onChange={(e) => updateParam(p.id, 'key', e.target.value)}
                      placeholder="Key"
                      className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                    <input
                      value={p.value}
                      onChange={(e) => updateParam(p.id, 'value', e.target.value)}
                      placeholder="Value"
                      className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                    <button onClick={() => removeParam(p.id)} className="p-1 rounded-sm hover:bg-[var(--bg-hover)]"><Trash2 size={12} /></button>
                  </div>
                ))}
                <button onClick={addParam} className="flex items-center gap-1 text-xs px-2 py-1 rounded-sm hover:bg-[var(--bg-hover)] mt-1">
                  <Plus size={12} /> Add Parameter
                </button>
              </div>
            )}

            {activeTab === 'headers' && (
              <div className="flex flex-col gap-1">
                {headers.map((h) => (
                  <div key={h.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={h.enabled} onChange={() => {}} className="accent-purple-500" />
                    <input
                      value={h.key}
                      onChange={(e) => updateHeader(h.id, 'key', e.target.value)}
                      placeholder="Header"
                      className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                    <input
                      value={h.value}
                      onChange={(e) => updateHeader(h.id, 'value', e.target.value)}
                      placeholder="Value"
                      className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                    <button onClick={() => removeHeader(h.id)} className="p-1 rounded-sm hover:bg-[var(--bg-hover)]"><Trash2 size={12} /></button>
                  </div>
                ))}
                <button onClick={addHeader} className="flex items-center gap-1 text-xs px-2 py-1 rounded-sm hover:bg-[var(--bg-hover)] mt-1">
                  <Plus size={12} /> Add Header
                </button>
              </div>
            )}

            {activeTab === 'auth' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>Type</span>
                  <select
                    value={auth.type}
                    onChange={(e) => setAuth((a) => ({ ...a, type: e.target.value as AuthType }))}
                    className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic (user / pass)</option>
                    <option value="apikey">API Key (custom header)</option>
                  </select>
                </div>

                {auth.type === 'bearer' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>Token</span>
                    <input
                      type="password"
                      value={auth.bearer}
                      onChange={(e) => setAuth((a) => ({ ...a, bearer: e.target.value }))}
                      placeholder="sk-…"
                      className="flex-1 px-2 py-1 rounded-sm text-xs outline-none font-mono"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                  </div>
                )}

                {auth.type === 'basic' && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>Username</span>
                      <input
                        value={auth.basicUser}
                        onChange={(e) => setAuth((a) => ({ ...a, basicUser: e.target.value }))}
                        className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                        style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>Password</span>
                      <input
                        type="password"
                        value={auth.basicPass}
                        onChange={(e) => setAuth((a) => ({ ...a, basicPass: e.target.value }))}
                        className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                        style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                      />
                    </div>
                  </>
                )}

                {auth.type === 'apikey' && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>Header</span>
                      <input
                        value={auth.apiKeyName}
                        onChange={(e) => setAuth((a) => ({ ...a, apiKeyName: e.target.value }))}
                        placeholder="X-API-Key"
                        className="flex-1 px-2 py-1 rounded-sm text-xs outline-none font-mono"
                        style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>Value</span>
                      <input
                        type="password"
                        value={auth.apiKeyValue}
                        onChange={(e) => setAuth((a) => ({ ...a, apiKeyValue: e.target.value }))}
                        className="flex-1 px-2 py-1 rounded-sm text-xs outline-none font-mono"
                        style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                      />
                    </div>
                  </>
                )}

                {auth.type !== 'none' && (
                  <div className="text-[10px] mt-1" style={{ color: 'var(--text-disabled)' }}>
                    Auth merges into the outgoing request. An explicit
                    Authorization header in the Headers tab still wins.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'body' && (
              <div className="flex flex-col gap-2 h-full">
                {/* Body mode pills — Postman-parity ordering */}
                <div className="flex items-center gap-3 flex-wrap shrink-0">
                  {BODY_MODES.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-1 text-[11px] cursor-pointer select-none"
                      style={{ color: bodyMode === m.id ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                    >
                      <input
                        type="radio"
                        name="body-mode"
                        value={m.id}
                        checked={bodyMode === m.id}
                        onChange={() => setBodyMode(m.id)}
                        className="accent-purple-500"
                      />
                      {m.label}
                    </label>
                  ))}
                  {bodyMode === 'json' && (
                    <div className="ml-auto flex items-center gap-2">
                      <span
                        title={jsonIsValid ? 'Valid JSON' : 'Invalid JSON'}
                        className="w-2 h-2 rounded-full"
                        style={{ background: jsonIsValid ? 'var(--accent-success)' : 'var(--accent-error)' }}
                      />
                      <button
                        onClick={beautifyJson}
                        className="text-[11px] px-2 py-0.5 rounded-sm hover:bg-[var(--bg-hover)]"
                        title="Beautify (⌘/Ctrl+B)"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        Beautify
                      </button>
                    </div>
                  )}
                </div>

                {bodyMode === 'none' && (
                  <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--text-disabled)' }}>
                    This request does not have a body.
                  </div>
                )}

                {bodyMode === 'binary' && (
                  <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--text-disabled)' }}>
                    Binary body picker — coming soon.
                  </div>
                )}

                {bodyMode === 'graphql' && (
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder='{ "query": "{ ... }", "variables": {} }'
                    spellCheck={false}
                    className="w-full flex-1 resize-none outline-none p-3 rounded-sm text-xs custom-scrollbar"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', fontFamily: "'JetBrains Mono', monospace" }}
                  />
                )}

                {bodyMode === 'raw' && (
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Raw text body"
                    spellCheck={false}
                    className="w-full flex-1 resize-none outline-none p-3 rounded-sm text-xs custom-scrollbar"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', fontFamily: "'JetBrains Mono', monospace" }}
                  />
                )}

                {bodyMode === 'json' && (
                  <JsonBodyEditor
                    value={body}
                    onChange={setBody}
                    error={bodyError}
                    onClearError={() => setBodyError(null)}
                  />
                )}

                {(bodyMode === 'form-data' || bodyMode === 'form-urlencoded') && (
                  <div className="flex flex-col gap-1">
                    {formFields.map((f) => (
                      <div key={f.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          onChange={() =>
                            setFormFields((prev) =>
                              prev.map((p) => (p.id === f.id ? { ...p, enabled: !p.enabled } : p)),
                            )
                          }
                          className="accent-purple-500"
                        />
                        <input
                          value={f.key}
                          onChange={(e) => updateFormField(f.id, 'key', e.target.value)}
                          placeholder="Key"
                          className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                        />
                        <input
                          value={f.value}
                          onChange={(e) => updateFormField(f.id, 'value', e.target.value)}
                          placeholder="Value"
                          className="flex-1 px-2 py-1 rounded-sm text-xs outline-none"
                          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                        />
                        <button onClick={() => removeFormField(f.id)} className="p-1 rounded-sm hover:bg-[var(--bg-hover)]">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addFormField}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-sm hover:bg-[var(--bg-hover)] mt-1 self-start"
                    >
                      <Plus size={12} /> Add Field
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>


        </div>

        {/* Drag handle between request and response. 4px hit zone, 1px
            visible line, expands on hover for affordance. */}
        <ResizeHandle
          orientation={layout === 'right' ? 'vertical' : 'horizontal'}
          onDrag={(deltaPx) => {
            const el = workspaceRef.current;
            if (!el) return;
            const total = layout === 'right' ? el.clientWidth : el.clientHeight;
            if (total <= 0) return;
            setSplitFraction((prev) => {
              const next = prev + deltaPx / total;
              return Math.min(0.85, Math.max(0.15, next));
            });
          }}
          onDoubleClick={() => setSplitFraction(layout === 'right' ? 0.5 : 0.45)}
        />

        {/* Right (or bottom): Response panel */}
        <div
          className="flex flex-col overflow-hidden min-w-0 min-h-0"
          style={{ flex: `${1 - splitFraction} 1 0` }}
        >
              {/* Response status bar */}
              {response && (
                <div className="flex items-center gap-3 px-3 py-1.5 shrink-0" style={{ background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: getStatusColor(response.status) }}>
                    {response.status} {response.statusText || STATUS_PHRASE[response.status] || ''}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }} title="Round-trip time">
                    {formatDuration(response.time)}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }} title="Response body size">
                    {formatBytes(response.body.length)}
                  </span>
                  <button onClick={copyResponse} className="ml-auto flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm hover:bg-[var(--bg-hover)]">
                    <Copy size={10} /> {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: 'rgba(244,67,54,0.1)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span className="text-xs text-red-400">{error}</span>
                </div>
              )}

              {/* Response tabs */}
              {response && (
                <div className="flex items-center px-3 shrink-0 gap-2" style={{ height: 28, background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)' }}>
                  {(['body', 'headers'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setResponseTab(tab)}
                      className="px-3 py-0.5 text-xs capitalize transition-colors flex items-center gap-1"
                      style={{
                        color: responseTab === tab ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        borderBottom: responseTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent',
                      }}
                    >
                      {tab}
                      {tab === 'headers' && (
                        <span
                          className="text-[10px] tabular-nums"
                          style={{ color: 'var(--text-disabled)' }}
                        >
                          ({Object.keys(response.headers).length})
                        </span>
                      )}
                    </button>
                  ))}
                  {responseTab === 'body' && (
                    <div className="ml-auto flex items-center gap-0.5 rounded-sm overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
                      {(['pretty', 'raw'] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setResponseView(v)}
                          className="px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors"
                          style={{
                            background: responseView === v ? 'var(--accent-primary)' : 'transparent',
                            color: responseView === v ? 'white' : 'var(--text-secondary)',
                          }}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Response content */}
              <div className="flex-1 overflow-auto custom-scrollbar">
                {response ? (
                  responseTab === 'body' ? (
                    <PrettyJsonView
                      raw={responseView === 'pretty' ? prettyBody : response.body}
                      highlight={responseView === 'pretty'}
                    />
                  ) : (
                    <div className="flex flex-col gap-1">
                      {Object.entries(response.headers).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="font-medium shrink-0" style={{ color: 'var(--accent-primary)' }}>{k}:</span>
                          <span style={{ color: 'var(--text-primary)' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : loading ? (
                  <SendingIndicator />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <Globe size={36} className="text-[var(--text-disabled)]" />
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Send a request to see the response</p>
                  </div>
                )}
              </div>

        </div>
        </div>
      </div>

      {/* Save-to-collection modal */}
      {savingTo && (
        <SaveDialog
          state={savingTo}
          collections={collections}
          onChange={setSavingTo}
          onCancel={() => setSavingTo(null)}
          onConfirm={confirmSave}
        />
      )}
    </div>
  );
}

// ============================================================
// Sidebar pieces (collection row, item row, save dialog) — kept in
// the same file because they're tightly coupled to ApiTester state
// shapes and only used here.
// ============================================================

// JSON body editor — textarea with a synced line-number gutter on the
// left + a small parse-error footer. Line numbers update on every
// keystroke; gutter scroll is bound to the textarea so they stay
// aligned. We don't do live syntax highlighting in the editor itself
// (would require a CodeMirror-class dep) — Beautify + the Pretty
// response renderer cover the "I want to read this" need.
const JsonBodyEditor: React.FC<{
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  onClearError: () => void;
}> = ({ value, onChange, error, onClearError }) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = value.split('\n');
  const gutterWidth = String(Math.max(1, lines.length)).length * 8 + 12;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className="flex flex-1 min-h-[180px] rounded-sm overflow-hidden"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border-default)' }}
      >
        <div
          ref={gutterRef}
          className="select-none text-right py-3 pr-2 pl-2 font-mono text-xs leading-[1.55] tabular-nums overflow-hidden"
          style={{ color: 'var(--text-disabled)', minWidth: gutterWidth, background: 'rgba(0,0,0,0.15)' }}
          aria-hidden
        >
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); if (error) onClearError(); }}
          onScroll={(e) => {
            // Keep the gutter aligned while the user scrolls the editor.
            const g = gutterRef.current;
            if (g) g.scrollTop = (e.currentTarget as HTMLTextAreaElement).scrollTop;
          }}
          placeholder='{ "key": "value" }'
          spellCheck={false}
          className="flex-1 resize-none outline-none p-3 text-xs custom-scrollbar"
          style={{
            background: 'transparent',
            color: 'var(--text-primary)',
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: '1.55',
            whiteSpace: 'pre',
          }}
        />
      </div>
      {error && (
        <div
          className="mt-1 px-2 py-1 text-[11px] rounded-sm flex items-center gap-1.5"
          style={{ background: 'rgba(244,67,54,0.10)', color: 'var(--accent-error)', border: '1px solid rgba(244,67,54,0.30)' }}
        >
          <AlertTriangle size={11} /> {error}
        </div>
      )}
    </div>
  );
};

// Lightweight JSON syntax highlighter — colors strings, keys, numbers,
// booleans, and null. Pure regex over the pretty-printed text; no
// dep, ~30 lines. For non-JSON bodies we just return the raw escaped
// string so the rest of the renderer is uniform.
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const JSON_TOKEN_RE =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;

const highlightJson = (raw: string): string => {
  return escapeHtml(raw).replace(JSON_TOKEN_RE, (m) => {
    let cls = 'jt-num';
    if (m.startsWith('"')) {
      cls = m.endsWith(':') ? 'jt-key' : 'jt-str';
    } else if (m === 'true' || m === 'false') {
      cls = 'jt-bool';
    } else if (m === 'null') {
      cls = 'jt-null';
    }
    return `<span class="${cls}">${m}</span>`;
  });
};

// Pretty JSON renderer — 1-based gutter line numbers + highlighted body.
// `raw` is the already-pretty-printed text (we don't reformat here so
// the user can toggle Pretty/Raw without losing alignment).
const PrettyJsonView: React.FC<{ raw: string; highlight: boolean }> = ({ raw, highlight }) => {
  const lines = raw.split('\n');
  const html = highlight ? highlightJson(raw) : escapeHtml(raw);
  // We render the body as a single <pre> with the highlighted HTML;
  // line numbers are a parallel column built from the same line count.
  const gutterWidth = String(lines.length).length;
  return (
    <div className="flex font-mono text-xs leading-[1.55]">
      <div
        className="select-none text-right pr-3 shrink-0 tabular-nums"
        style={{ color: 'var(--text-disabled)', minWidth: gutterWidth * 8 + 8 }}
        aria-hidden
      >
        {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <pre
        className="flex-1 overflow-x-auto whitespace-pre-wrap break-all m-0"
        style={{ color: 'var(--text-primary)' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style>{`
        .jt-key  { color: #82AAFF; }
        .jt-str  { color: #C3E88D; }
        .jt-num  { color: #F78C6C; }
        .jt-bool { color: #C792EA; }
        .jt-null { color: #FF5370; }
      `}</style>
    </div>
  );
};

// Drag handle between request + response. Vertical for right-layout
// (drag horizontally), horizontal for bottom-layout (drag vertically).
// Visible 1px line + 4px hit zone. Double-click resets to 50/50-ish.
const ResizeHandle: React.FC<{
  orientation: 'vertical' | 'horizontal';
  onDrag: (deltaPx: number) => void;
  onDoubleClick: () => void;
}> = ({ orientation, onDrag, onDoubleClick }) => {
  const lastRef = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      lastRef.current = orientation === 'vertical' ? e.clientX : e.clientY;
      const move = (ev: MouseEvent) => {
        const cur = orientation === 'vertical' ? ev.clientX : ev.clientY;
        const delta = cur - lastRef.current;
        lastRef.current = cur;
        if (delta !== 0) onDrag(delta);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [orientation, onDrag],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation={orientation}
      title="Drag to resize · double-click to reset"
      style={{
        flex: '0 0 auto',
        background: 'var(--border-subtle)',
        cursor: orientation === 'vertical' ? 'col-resize' : 'row-resize',
        ...(orientation === 'vertical'
          ? { width: 4, marginInline: -1.5 }
          : { height: 4, marginBlock: -1.5 }),
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--accent-primary)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--border-subtle)'; }}
    />
  );
};

// Centered "Sending request…" placeholder with a live elapsed-time
// counter so the user has feedback while a slow LLM call is in flight.
const SendingIndicator: React.FC = () => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((e) => e + 100), 100);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div
        className="w-9 h-9 rounded-full"
        style={{
          border: '3px solid var(--bg-hover, rgba(255,255,255,0.08))',
          borderTopColor: 'var(--accent-primary)',
          animation: 'apitester-spin 700ms linear infinite',
        }}
      />
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        Sending request…
      </p>
      <p className="text-[10px] tabular-nums" style={{ color: 'var(--text-disabled)' }}>
        {formatDuration(elapsed)}
      </p>
      <style>{`
        @keyframes apitester-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

// Render a method+URL+status row in the sidebar History tab.
// Strip protocol/host so the path is the focus — full URL still in title.
const urlPathish = (raw: string): string => {
  try {
    const u = new URL(raw);
    return u.pathname + u.search;
  } catch {
    return raw;
  }
};

// Bucket history rows by Today / Yesterday / explicit date. Newest
// rows first in each group; groups in chronological-DESC order.
const groupHistoryByDay = (
  rows: RequestHistory[],
): Array<{ label: string; rows: RequestHistory[] }> => {
  if (rows.length === 0) return [];
  const dayKey = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86_400_000);
  const labelFor = (key: string): string => {
    if (key === today) return 'Today';
    if (key === yesterday) return 'Yesterday';
    const [y, m, d] = key.split('-').map((s) => Number(s));
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    });
  };
  const groups = new Map<string, RequestHistory[]>();
  for (const r of rows) {
    const k = dayKey(r.timestamp);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, rs]) => ({ label: labelFor(key), rows: rs }));
};

// Postman-style: icon-only sidebar tab. Tooltip carries the label so
// nothing is lost. Optional `badge` adds a small count chip for the
// History tab.
const SidebarTabBtn: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  badge?: number;
}> = ({ active, icon, title, onClick, badge }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="relative px-2.5 py-2 transition-colors"
    style={{
      color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
      borderBottom: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
    }}
  >
    {icon}
    {badge !== undefined && (
      <span
        className="absolute top-0.5 right-0 text-[8px] font-semibold tabular-nums px-1 rounded-full"
        style={{ background: 'var(--accent-primary)', color: 'white', minWidth: 14, lineHeight: '14px' }}
      >
        {badge}
      </span>
    )}
  </button>
);

const CollectionRow: React.FC<{
  expanded: boolean;
  onToggle: () => void;
  name: string;
  count: number;
  builtin?: boolean;
  renaming?: string | null;
  onRenameChange?: (v: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onStartRename?: () => void;
  onDelete?: () => void;
  children?: React.ReactNode;
}> = ({
  expanded, onToggle, name, count, builtin,
  renaming, onRenameChange, onRenameCommit, onRenameCancel,
  onStartRename, onDelete, children,
}) => (
  <div className="mb-0.5">
    <div
      className="group flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-[var(--bg-hover)]"
      onClick={onToggle}
    >
      {expanded ? (
        <ChevronDown size={11} style={{ color: 'var(--text-secondary)' }} />
      ) : (
        <ChevronRight size={11} style={{ color: 'var(--text-secondary)' }} />
      )}
      <Folder size={11} style={{ color: builtin ? 'var(--accent-primary)' : 'var(--text-secondary)' }} />
      {renaming != null ? (
        <input
          autoFocus
          value={renaming}
          onChange={(e) => onRenameChange?.(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onRenameCommit?.(); }
            if (e.key === 'Escape') { e.preventDefault(); onRenameCancel?.(); }
          }}
          onBlur={onRenameCommit}
          className="flex-1 px-1 py-0 rounded-sm text-[11px] outline-none"
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--accent-primary)' }}
        />
      ) : (
        <>
          <span className="flex-1 text-[11px] truncate" style={{ color: 'var(--text-primary)' }}>{name}</span>
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-disabled)' }}>{count}</span>
          {!builtin && (
            <div className="hidden group-hover:flex items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); onStartRename?.(); }}
                title="Rename"
                className="p-0.5 rounded-sm hover:bg-[var(--bg-elevated)]"
              >
                <Pencil size={10} style={{ color: 'var(--text-secondary)' }} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
                title="Delete collection"
                className="p-0.5 rounded-sm hover:bg-[var(--bg-elevated)]"
              >
                <Trash2 size={10} style={{ color: 'var(--accent-error)' }} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
    {expanded && children}
  </div>
);

const ItemRow: React.FC<{
  method: HttpMethod;
  label: string;
  renaming?: string | null;
  onRenameChange?: (v: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onStartRename?: () => void;
  onDelete?: () => void;
  onClick: () => void;
}> = ({
  method, label, renaming, onRenameChange, onRenameCommit, onRenameCancel,
  onStartRename, onDelete, onClick,
}) => (
  <div
    className="group flex items-center gap-1.5 pl-7 pr-2 py-0.5 cursor-pointer hover:bg-[var(--bg-hover)]"
    onClick={onClick}
  >
    <span className="text-[10px] font-semibold w-12 text-right shrink-0" style={{ color: METHOD_COLORS[method] }}>{method}</span>
    {renaming != null ? (
      <input
        autoFocus
        value={renaming}
        onChange={(e) => onRenameChange?.(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onRenameCommit?.(); }
          if (e.key === 'Escape') { e.preventDefault(); onRenameCancel?.(); }
        }}
        onBlur={onRenameCommit}
        className="flex-1 px-1 py-0 rounded-sm text-[11px] outline-none"
        style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--accent-primary)' }}
      />
    ) : (
      <>
        <span className="flex-1 text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        {(onStartRename || onDelete) && (
          <div className="hidden group-hover:flex items-center gap-0.5">
            {onStartRename && (
              <button
                onClick={(e) => { e.stopPropagation(); onStartRename(); }}
                title="Rename"
                className="p-0.5 rounded-sm hover:bg-[var(--bg-elevated)]"
              >
                <Pencil size={10} style={{ color: 'var(--text-secondary)' }} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="Delete"
                className="p-0.5 rounded-sm hover:bg-[var(--bg-elevated)]"
              >
                <Trash2 size={10} style={{ color: 'var(--accent-error)' }} />
              </button>
            )}
          </div>
        )}
      </>
    )}
  </div>
);

const SaveDialog: React.FC<{
  state: { name: string; targetCollectionId: string };
  collections: Collection[];
  onChange: React.Dispatch<React.SetStateAction<{ name: string; targetCollectionId: string } | null>>;
  onCancel: () => void;
  onConfirm: (collectionId: string, name: string, opts?: { newCollectionName?: string }) => void;
}> = ({ state, collections, onChange, onCancel, onConfirm }) => {
  const [creatingNew, setCreatingNew] = useState(collections.length === 0);
  const [newName, setNewName] = useState('');

  return (
    <div
      className="fixed inset-0 z-[5000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] rounded-xl p-5"
        style={{
          background: 'var(--bg-elevated, #1f1f23)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="text-sm font-semibold mb-4">Save request</div>

        <label className="block text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>Name</label>
        <input
          autoFocus
          value={state.name}
          onChange={(e) => onChange((s) => (s ? { ...s, name: e.target.value } : s))}
          className="w-full px-2.5 py-1.5 rounded-md text-xs outline-none mb-4"
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
        />

        {!creatingNew && collections.length > 0 && (
          <>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>Collection</label>
            <select
              value={state.targetCollectionId}
              onChange={(e) => onChange((s) => (s ? { ...s, targetCollectionId: e.target.value } : s))}
              className="w-full px-2.5 py-1.5 rounded-md text-xs outline-none mb-2"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => setCreatingNew(true)}
              className="text-[11px] hover:underline"
              style={{ color: 'var(--accent-primary)' }}
            >
              + New collection
            </button>
          </>
        )}

        {creatingNew && (
          <>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>New collection name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Untitled"
              className="w-full px-2.5 py-1.5 rounded-md text-xs outline-none mb-2"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            />
            {collections.length > 0 && (
              <button
                onClick={() => setCreatingNew(false)}
                className="text-[11px] hover:underline"
                style={{ color: 'var(--accent-primary)' }}
              >
                ← Use an existing collection
              </button>
            )}
          </>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (creatingNew) {
                onConfirm('', state.name, { newCollectionName: newName || 'Untitled' });
              } else {
                onConfirm(state.targetCollectionId, state.name);
              }
            }}
            disabled={!state.name.trim() || (!creatingNew && !state.targetCollectionId)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent-primary)' }}
          >
            <Check size={11} className="inline mr-1" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
