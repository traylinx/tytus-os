import {
  asSecret,
} from "@/lib/secrets";
import {
  err,
  ok,
} from "@/types/daemon";
import type {
  Agent,
  Catalog,
  ChannelsResponse,
  DaemonError,
  DaemonErrorCode,
  DaemonResult,
  DaemonSettings,
  DaemonStatus,
  DaemonVersion,
  ErrorEnvelope,
  IncludedPod,
  JobCancelResult,
  JobResponse,
  Launchers,
  LogChunk,
  PodReady,
  SharedFoldersList,
  StateSnapshot,
} from "@/types/daemon";

// ---- wire shapes (Secret -> raw string) ---------------------------------

type RawAgent = Omit<Agent, "user_key" | "ui_url"> & {
  user_key: string;
  ui_url: string;
};

type RawIncludedPod = Omit<IncludedPod, "user_key"> & {
  user_key: string;
};

type RawState = Omit<StateSnapshot, "agents" | "included"> & {
  agents: RawAgent[];
  included: RawIncludedPod[];
};

const materializeState = (raw: RawState): StateSnapshot => ({
  ...raw,
  agents: raw.agents.map((a) => ({
    ...a,
    user_key: asSecret(a.user_key),
    ui_url: asSecret(a.ui_url),
  })),
  included: raw.included.map((p) => ({
    ...p,
    user_key: asSecret(p.user_key),
  })),
});

// ---- error classification ----------------------------------------------

const errorOf = (
  code: DaemonErrorCode,
  message: string,
  status?: number,
  cause?: unknown,
): DaemonError => ({ code, message, status, cause });

const classifyNetworkError = (cause: unknown): DaemonError => {
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return errorOf("network_timeout", "request aborted", undefined, cause);
  }
  // Browser fetch surfaces ECONNREFUSED / unknown host as TypeError.
  // We can't distinguish "daemon stopped" from "tunnel down" here, so the
  // safest default is daemon_offline — the banner copy explains the case.
  return errorOf(
    "daemon_offline",
    cause instanceof Error ? cause.message : "network error",
    undefined,
    cause,
  );
};

const tryJson = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const isErrorEnvelope = (body: unknown): body is ErrorEnvelope =>
  typeof body === "object" &&
  body !== null &&
  "error" in body &&
  typeof (body as { error: unknown }).error === "string";

// ---- idempotency keys --------------------------------------------------

/**
 * Mint a fresh `Idempotency-Key`. UUIDv4 from `crypto.randomUUID()`
 * when available (browser, happy-dom test env, Node ≥ 19); fall back
 * to a SipHash-quality random hex string built from `crypto.getRandomValues`
 * — sufficient for keying a same-process daemon cache. Never returns
 * an empty string. The key is opaque to the daemon — it just hashes it.
 *
 * Callers that want retry-safe semantics mint ONE key for a logical
 * action and reuse it on retry. The fresh-key default exists so a
 * single-shot POST still gets dedupe protection against React
 * StrictMode double-effect-fires in dev (and against any double-click
 * the UI doesn't already debounce).
 */
export const newIdempotencyKey = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-ditch: time + math-random. Not unique-enough for crypto, but
  // we only need it to be unique within one daemon TTL window for one
  // user — which Math.random + Date.now() comfortably is.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

// ---- request runner -----------------------------------------------------

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  /**
   * `Idempotency-Key` header value. When set, the daemon caches the
   * response under this key (10 min TTL) and replays the cached body
   * on subsequent requests carrying the same key — so a retry after
   * a network blip can't double-spawn a `tytus restart` subprocess.
   *
   * Only attached on POST. GETs are already retry-safe.
   */
  idempotencyKey?: string;
}

interface RunDeps {
  baseUrl: string;
  fetch: typeof fetch;
}

const runRequest = async <T>(
  deps: RunDeps,
  path: string,
  opts: RequestOptions,
  parse: (body: unknown) => DaemonResult<T>,
): Promise<DaemonResult<T>> => {
  const url = `${deps.baseUrl}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.method === "POST" && opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }

  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (cause) {
    return err<T>(classifyNetworkError(cause));
  }

  if (res.status === 404) {
    return err<T>(errorOf("not_found", "not found", 404));
  }
  if (res.status === 401 || res.status === 403) {
    return err<T>(errorOf("auth_required", "auth required", res.status));
  }

  const body2 = await tryJson(res);

  if (res.status >= 500) {
    const message =
      isErrorEnvelope(body2) ? body2.error : `daemon ${res.status}`;
    return err<T>(errorOf("internal_error", message, res.status));
  }

  if (res.status === 400) {
    const message =
      isErrorEnvelope(body2) ? body2.error : "bad request";
    return err<T>(errorOf("validation", message, 400));
  }

  if (!res.ok) {
    return err<T>(
      errorOf("internal_error", `unexpected status ${res.status}`, res.status),
    );
  }

  // 200 + error envelope => logical_error (e.g. /api/pod/ready w/o pod)
  if (isErrorEnvelope(body2)) {
    return err<T>(errorOf("logical_error", body2.error, res.status));
  }

  return parse(body2);
};

// ---- parsers ------------------------------------------------------------

const expectShape = <T>(
  body: unknown,
  guard: (b: unknown) => b is T,
  message: string,
): DaemonResult<T> =>
  guard(body)
    ? ok(body)
    : err<T>(errorOf("daemon_unhealthy", message));

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isStateLike = (v: unknown): v is RawState =>
  isObject(v) &&
  typeof v.logged_in === "boolean" &&
  typeof v.email === "string" &&
  typeof v.tier === "string" &&
  Array.isArray(v.agents) &&
  Array.isArray(v.included);

const isDaemonStatus = (v: unknown): v is DaemonStatus =>
  isObject(v) && typeof v.pid === "number" && typeof v.running === "boolean";

const isDaemonVersion = (v: unknown): v is DaemonVersion =>
  isObject(v) &&
  typeof v.daemon_version === "string" &&
  typeof v.daemon_pid === "number" &&
  typeof v.daemon_started_at === "number";

const isSettings = (v: unknown): v is DaemonSettings =>
  isObject(v) &&
  typeof v.autostart_tray === "boolean" &&
  typeof v.autostart_tunnel === "boolean";

const isJobResponse = (v: unknown): v is JobResponse =>
  isObject(v) && typeof v.job_id === "string";

const isJobCancelResult = (v: unknown): v is JobCancelResult =>
  isObject(v) && typeof v.cancelled === "boolean";

const isCatalog = (v: unknown): v is Catalog =>
  isObject(v) && typeof v.version === "string" && Array.isArray(v.agents);

const isChannels = (v: unknown): v is ChannelsResponse =>
  isObject(v) &&
  typeof v.pod_id === "string" &&
  Array.isArray(v.available) &&
  Array.isArray(v.configured);

const isLaunchers = (v: unknown): v is Launchers =>
  isObject(v) &&
  Array.isArray(v.editors) &&
  v.editors.every(
    (e) =>
      isObject(e) && typeof e.binary === "string" && typeof e.name === "string",
  ) &&
  typeof v.terminal_available === "boolean";

const isLogChunk = (v: unknown): v is LogChunk =>
  isObject(v) &&
  typeof v.name === "string" &&
  typeof v.chunk === "string" &&
  typeof v.offset === "number" &&
  typeof v.size === "number" &&
  typeof v.truncated === "boolean" &&
  typeof v.missing === "boolean";

const isPodReady = (v: unknown): v is PodReady =>
  isObject(v) &&
  typeof v.ready === "boolean" &&
  typeof v.status === "number" &&
  typeof v.reason === "string" &&
  typeof v.probe_url === "string";

const isSharedFolders = (v: unknown): v is SharedFoldersList =>
  isObject(v) && Array.isArray(v.bindings);

// ---- conditional state result -------------------------------------------

/**
 * Returned by `getStateConditional`. Carries either a fresh snapshot +
 * its ETag (200) or a `notModified: true` marker (304). The caller
 * keeps its cached snapshot in the 304 case.
 */
export interface ConditionalStateResult {
  snapshot: StateSnapshot | null;
  etag: string | null;
  notModified: boolean;
}

// ---- client -------------------------------------------------------------

export interface DaemonClient {
  // GET
  getState(signal?: AbortSignal): Promise<DaemonResult<StateSnapshot>>;
  /**
   * Conditional GET on /api/state. Sends `If-None-Match: <ifNoneMatch>`
   * when supplied; daemon responds 304 with no body when the snapshot
   * hash matches, saving the JSON.parse + setState round on every
   * no-change poll tick.
   *
   * Returns `notModified: true` for 304 (caller keeps cached snapshot)
   * or `snapshot + etag` for 200. Errors propagate as DaemonResult.err
   * the same way getState() does.
   */
  getStateConditional(
    ifNoneMatch: string | null,
    signal?: AbortSignal,
  ): Promise<DaemonResult<ConditionalStateResult>>;
  getDaemonStatus(signal?: AbortSignal): Promise<DaemonResult<DaemonStatus>>;
  /**
   * Daemon identity + boot timestamp.
   *
   * Use `daemon_started_at` to detect a daemon restart between polls
   * and drop in-flight `activeJob` state — the registry is in-memory
   * so every job_id is invalid after restart. Use `daemon_version` to
   * gate UI features that require a newer daemon surface.
   */
  getVersion(signal?: AbortSignal): Promise<DaemonResult<DaemonVersion>>;
  getSettings(signal?: AbortSignal): Promise<DaemonResult<DaemonSettings>>;
  getCatalog(signal?: AbortSignal): Promise<DaemonResult<Catalog>>;
  getChannels(
    podId: string,
    signal?: AbortSignal,
  ): Promise<DaemonResult<ChannelsResponse>>;
  getLaunchers(signal?: AbortSignal): Promise<DaemonResult<Launchers>>;
  getLogs(
    name: string,
    offset: number,
    signal?: AbortSignal,
  ): Promise<DaemonResult<LogChunk>>;
  getPodReady(
    podId: string,
    signal?: AbortSignal,
  ): Promise<DaemonResult<PodReady>>;
  getSharedFolders(
    signal?: AbortSignal,
  ): Promise<DaemonResult<SharedFoldersList>>;

  // POST
  //
  // Every destructive POST below accepts an optional `idempotencyKey`.
  // Pass the same key on retry to dedupe against the daemon's request
  // cache (10 min TTL, see web_server.rs `IDEM_TTL_SECS`). Omitting
  // the key is fine for one-shot calls — the daemon just executes
  // unconditionally.
  postLogout(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postDaemonStart(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postDaemonStop(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postDaemonRestart(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postConnect(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postDisconnect(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postTest(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobResponse>>;
  postDoctor(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobResponse>>;
  postLaunch(
    name: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postInstall(
    agent_type: string,
    pod_id?: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobResponse>>;
  postOpenExternal(
    url: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postPodOpen(
    podId: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postPodRestart(
    podId: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postPodRefreshCreds(
    podId: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobResponse>>;
  /**
   * Add a messenger channel binding to a pod. Token is sent in the
   * body — never the URL. Daemon takes ~10–15s to redeploy the agent.
   */
  postChannelsAdd(
    podId: string,
    channel: string,
    token: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postChannelsRemove(
    podId: string,
    channel: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postFilesOpenDownloads(
    podId: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  /**
   * Open the macOS native folder picker. Returns the chosen POSIX
   * path, or marks the call cancelled if the user dismissed the
   * dialog. Non-macOS daemons return 501 (auth_required would be
   * misleading; we surface as logical_error in that case).
   */
  postSharedFoldersPickFolder(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<{ path: string } | { cancelled: true }>>;
  /**
   * Bind a Mac folder to one or more pods via a Garage bucket. The
   * call is fire-and-stream: returns {job_id} on accept, daemon
   * runs garagetytus-folder-bind in the background and streams
   * progress over SSE.
   */
  postSharedFoldersBind(
    payload: {
      local_path: string;
      bucket: string;
      pods?: string[];
      auto_sync?: boolean;
    },
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobResponse>>;
  postSharedFoldersOpen(
    localPath: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postSharedFoldersOpenCache(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postSharedFoldersRunStreamed(
    action: "list" | "status" | "conflicts" | "refresh-all",
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobResponse>>;
  /**
   * Per-pod streamed action. The daemon's allowlist (Phase 2 spike,
   * web_server.rs::pod_action_argv) currently accepts: restart, revoke,
   * uninstall, stop-forwarder, channels-list, ls-inbox. Returns a
   * job_id; consumer attaches via jobStreamUrl.
   */
  postPodRunStreamed(
    podId: string,
    action: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobResponse>>;
  /**
   * SIGTERM the child process behind a running job.
   *
   * The body distinguishes three outcomes — the consumer typically
   * doesn't have to act on `reason`, but it's useful for toast
   * wording: "Cancelled" vs "Already finished" vs "Couldn't cancel
   * (no process yet)".
   *
   * The SSE stream closes naturally when the SIGTERM'd child dies —
   * caller doesn't need to tear down its EventSource manually.
   */
  postJobCancel(
    jobId: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobCancelResult>>;
  postSettingsAutostartTray(
    enabled: boolean,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postSettingsAutostartTunnel(
    enabled: boolean,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;

  // SSE — returned as URL; consumer attaches EventSource (used by useJobStream)
  jobStreamUrl(jobId: string): string;

  readonly baseUrl: string;
}

export interface DaemonClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export const createDaemonClient = (
  options: DaemonClientOptions = {},
): DaemonClient => {
  const baseUrl = options.baseUrl ?? "";
  const f = options.fetch ?? globalThis.fetch.bind(globalThis);
  const deps: RunDeps = { baseUrl, fetch: f };

  const noBody = (body: unknown): DaemonResult<null> => {
    void body;
    return ok(null);
  };

  return {
    baseUrl,

    getState: (signal) =>
      runRequest(deps, "/api/state", { signal }, (b) => {
        const r = expectShape(b, isStateLike, "malformed /api/state");
        return r.ok ? ok(materializeState(r.value)) : r;
      }),

    getStateConditional: async (ifNoneMatch, signal) => {
      // Inline fetch path because runRequest doesn't expose response
      // headers and 304 has no body to parse — we need both. Behavior
      // otherwise mirrors runRequest (same error envelope, same
      // classifyNetworkError, same auth_required handling).
      const url = `${baseUrl}/api/state`;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
      let res: Response;
      try {
        res = await f(url, {
          method: "GET",
          headers,
          signal,
          credentials: "same-origin",
        });
      } catch (cause) {
        return err<ConditionalStateResult>(classifyNetworkError(cause));
      }
      if (res.status === 304) {
        // Cached body still valid — caller keeps its last snapshot.
        // Echo the etag if the daemon sent one back so a future
        // refactor that wants to verify can still see it.
        return ok({
          snapshot: null,
          etag: res.headers.get("ETag"),
          notModified: true,
        });
      }
      if (res.status === 404) {
        return err<ConditionalStateResult>(errorOf("not_found", "not found", 404));
      }
      if (res.status === 401 || res.status === 403) {
        return err<ConditionalStateResult>(
          errorOf("auth_required", "auth required", res.status),
        );
      }
      const body = await tryJson(res);
      if (res.status >= 500) {
        const message = isErrorEnvelope(body) ? body.error : `daemon ${res.status}`;
        return err<ConditionalStateResult>(
          errorOf("internal_error", message, res.status),
        );
      }
      if (res.status === 400) {
        const message = isErrorEnvelope(body) ? body.error : "bad request";
        return err<ConditionalStateResult>(errorOf("validation", message, 400));
      }
      if (!res.ok) {
        return err<ConditionalStateResult>(
          errorOf(
            "internal_error",
            `unexpected status ${res.status}`,
            res.status,
          ),
        );
      }
      if (isErrorEnvelope(body)) {
        return err<ConditionalStateResult>(
          errorOf("logical_error", body.error, res.status),
        );
      }
      const parsed = expectShape(body, isStateLike, "malformed /api/state");
      if (!parsed.ok) {
        return err<ConditionalStateResult>(parsed.error);
      }
      return ok({
        snapshot: materializeState(parsed.value),
        etag: res.headers.get("ETag"),
        notModified: false,
      });
    },

    getVersion: (signal) =>
      runRequest(deps, "/api/version", { signal }, (b) =>
        expectShape(b, isDaemonVersion, "malformed /api/version"),
      ),

    getDaemonStatus: (signal) =>
      runRequest(deps, "/api/daemon/status", { signal }, (b) =>
        expectShape(b, isDaemonStatus, "malformed /api/daemon/status"),
      ),

    getSettings: (signal) =>
      runRequest(deps, "/api/settings", { signal }, (b) =>
        expectShape(b, isSettings, "malformed /api/settings"),
      ),

    getCatalog: (signal) =>
      runRequest(deps, "/api/catalog", { signal }, (b) =>
        expectShape(b, isCatalog, "malformed /api/catalog"),
      ),

    getChannels: (podId, signal) =>
      runRequest(
        deps,
        `/api/channels?pod=${encodeURIComponent(podId)}`,
        { signal },
        (b) => expectShape(b, isChannels, "malformed /api/channels"),
      ),

    getLaunchers: (signal) =>
      runRequest(deps, "/api/launchers", { signal }, (b) =>
        expectShape(b, isLaunchers, "malformed /api/launchers"),
      ),

    getLogs: (name, offset, signal) =>
      runRequest(
        deps,
        `/api/logs?name=${encodeURIComponent(name)}&offset=${offset}`,
        { signal },
        (b) => expectShape(b, isLogChunk, "malformed /api/logs"),
      ),

    getPodReady: (podId, signal) =>
      runRequest(
        deps,
        `/api/pod/ready?pod=${encodeURIComponent(podId)}`,
        { signal },
        (b) => expectShape(b, isPodReady, "malformed /api/pod/ready"),
      ),

    getSharedFolders: (signal) =>
      runRequest(deps, "/api/shared-folders/list", { signal }, (b) =>
        expectShape(b, isSharedFolders, "malformed /api/shared-folders/list"),
      ),

    postLogout: (signal, idempotencyKey) =>
      runRequest(deps, "/api/logout", { method: "POST", signal, idempotencyKey }, noBody),

    postDaemonStart: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/daemon/start",
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postDaemonStop: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/daemon/stop",
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postDaemonRestart: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/daemon/restart",
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postConnect: (signal, idempotencyKey) =>
      runRequest(deps, "/api/connect", { method: "POST", signal, idempotencyKey }, noBody),

    postDisconnect: (signal, idempotencyKey) =>
      runRequest(deps, "/api/disconnect", { method: "POST", signal, idempotencyKey }, noBody),

    postTest: (signal, idempotencyKey) =>
      runRequest(deps, "/api/test", { method: "POST", signal, idempotencyKey }, (b) =>
        expectShape(b, isJobResponse, "malformed /api/test"),
      ),

    postDoctor: (signal, idempotencyKey) =>
      runRequest(deps, "/api/doctor", { method: "POST", signal, idempotencyKey }, (b) =>
        expectShape(b, isJobResponse, "malformed /api/doctor"),
      ),

    postLaunch: (name, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/launch",
        { method: "POST", body: { name }, signal, idempotencyKey },
        noBody,
      ),

    postInstall: (agent_type, pod_id, signal, idempotencyKey) => {
      const body: { agent_type: string; pod_id?: string } = { agent_type };
      if (pod_id !== undefined) body.pod_id = pod_id;
      return runRequest(
        deps,
        "/api/install",
        { method: "POST", body, signal, idempotencyKey },
        (b) => expectShape(b, isJobResponse, "malformed /api/install"),
      );
    },

    postOpenExternal: (url, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/open-external",
        { method: "POST", body: { url }, signal, idempotencyKey },
        noBody,
      ),

    postPodOpen: (podId, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/pod/open?pod=${encodeURIComponent(podId)}`,
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postPodRestart: (podId, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/pod/restart?pod=${encodeURIComponent(podId)}`,
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postPodRefreshCreds: (podId, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/pod/refresh-creds?pod=${encodeURIComponent(podId)}`,
        { method: "POST", signal, idempotencyKey },
        (b) => expectShape(b, isJobResponse, "malformed /api/pod/refresh-creds"),
      ),

    postChannelsAdd: (podId, channel, token, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/channels/add",
        {
          method: "POST",
          // Token MUST live in the body, never the query string.
          // Daemon source enforces same invariant (web_server.rs Body
          // shape; bad-json error path explicitly does not echo the
          // raw payload).
          body: { pod: podId, channel, token },
          signal,
          idempotencyKey,
        },
        noBody,
      ),

    postChannelsRemove: (podId, channel, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/channels/remove?pod=${encodeURIComponent(podId)}&name=${encodeURIComponent(channel)}`,
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postFilesOpenDownloads: (podId, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/files/open-downloads?pod=${encodeURIComponent(podId)}`,
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postSharedFoldersPickFolder: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/shared-folders/pick-folder",
        { method: "POST", signal, idempotencyKey },
        (b) => {
          if (
            isObject(b) &&
            (("path" in b && typeof b.path === "string") ||
              ("cancelled" in b && b.cancelled === true))
          ) {
            return ok(b as { path: string } | { cancelled: true });
          }
          return err(
            errorOf("daemon_unhealthy", "malformed pick-folder response"),
          );
        },
      ),

    postSharedFoldersBind: (payload, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/shared-folders/bind",
        { method: "POST", body: payload, signal, idempotencyKey },
        (b) =>
          expectShape(
            b,
            isJobResponse,
            "malformed /api/shared-folders/bind",
          ),
      ),

    postSharedFoldersOpen: (localPath, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/shared-folders/open",
        { method: "POST", body: { local_path: localPath }, signal, idempotencyKey },
        noBody,
      ),

    postSharedFoldersOpenCache: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/shared-folders/open-cache",
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postSharedFoldersRunStreamed: (action, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/shared-folders/run-streamed?action=${encodeURIComponent(action)}`,
        { method: "POST", signal, idempotencyKey },
        (b) =>
          expectShape(
            b,
            isJobResponse,
            "malformed /api/shared-folders/run-streamed",
          ),
      ),

    postPodRunStreamed: (podId, action, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/pod/${encodeURIComponent(podId)}/run-streamed`,
        { method: "POST", body: { action }, signal, idempotencyKey },
        (b) => expectShape(b, isJobResponse, "malformed /api/pod/run-streamed"),
      ),

    postJobCancel: (jobId, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
        { method: "POST", signal, idempotencyKey },
        (b) => expectShape(b, isJobCancelResult, "malformed /api/jobs/.../cancel"),
      ),

    postSettingsAutostartTray: (enabled, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/settings/autostart-tray",
        { method: "POST", body: { enabled }, signal, idempotencyKey },
        noBody,
      ),

    postSettingsAutostartTunnel: (enabled, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/settings/autostart-tunnel",
        { method: "POST", body: { enabled }, signal, idempotencyKey },
        noBody,
      ),

    jobStreamUrl: (jobId) =>
      `${baseUrl}/api/jobs/${encodeURIComponent(jobId)}/stream`,
  };
};
