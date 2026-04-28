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
  ErrorEnvelope,
  IncludedPod,
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

// ---- request runner -----------------------------------------------------

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
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

const isSettings = (v: unknown): v is DaemonSettings =>
  isObject(v) &&
  typeof v.autostart_tray === "boolean" &&
  typeof v.autostart_tunnel === "boolean";

const isJobResponse = (v: unknown): v is JobResponse =>
  isObject(v) && typeof v.job_id === "string";

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

// ---- client -------------------------------------------------------------

export interface DaemonClient {
  // GET
  getState(signal?: AbortSignal): Promise<DaemonResult<StateSnapshot>>;
  getDaemonStatus(signal?: AbortSignal): Promise<DaemonResult<DaemonStatus>>;
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
  postLogout(signal?: AbortSignal): Promise<DaemonResult<null>>;
  postDaemonStart(signal?: AbortSignal): Promise<DaemonResult<null>>;
  postDaemonStop(signal?: AbortSignal): Promise<DaemonResult<null>>;
  postDaemonRestart(signal?: AbortSignal): Promise<DaemonResult<null>>;
  postConnect(signal?: AbortSignal): Promise<DaemonResult<null>>;
  postDisconnect(signal?: AbortSignal): Promise<DaemonResult<null>>;
  postTest(signal?: AbortSignal): Promise<DaemonResult<JobResponse>>;
  postDoctor(signal?: AbortSignal): Promise<DaemonResult<JobResponse>>;
  postLaunch(
    name: string,
    signal?: AbortSignal,
  ): Promise<DaemonResult<null>>;
  postInstall(
    agent_type: string,
    pod_id?: string,
    signal?: AbortSignal,
  ): Promise<DaemonResult<JobResponse>>;
  postOpenExternal(
    url: string,
    signal?: AbortSignal,
  ): Promise<DaemonResult<null>>;
  postSettingsAutostartTray(
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<DaemonResult<null>>;
  postSettingsAutostartTunnel(
    enabled: boolean,
    signal?: AbortSignal,
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

    postLogout: (signal) =>
      runRequest(deps, "/api/logout", { method: "POST", signal }, noBody),

    postDaemonStart: (signal) =>
      runRequest(
        deps,
        "/api/daemon/start",
        { method: "POST", signal },
        noBody,
      ),

    postDaemonStop: (signal) =>
      runRequest(
        deps,
        "/api/daemon/stop",
        { method: "POST", signal },
        noBody,
      ),

    postDaemonRestart: (signal) =>
      runRequest(
        deps,
        "/api/daemon/restart",
        { method: "POST", signal },
        noBody,
      ),

    postConnect: (signal) =>
      runRequest(deps, "/api/connect", { method: "POST", signal }, noBody),

    postDisconnect: (signal) =>
      runRequest(deps, "/api/disconnect", { method: "POST", signal }, noBody),

    postTest: (signal) =>
      runRequest(deps, "/api/test", { method: "POST", signal }, (b) =>
        expectShape(b, isJobResponse, "malformed /api/test"),
      ),

    postDoctor: (signal) =>
      runRequest(deps, "/api/doctor", { method: "POST", signal }, (b) =>
        expectShape(b, isJobResponse, "malformed /api/doctor"),
      ),

    postLaunch: (name, signal) =>
      runRequest(
        deps,
        "/api/launch",
        { method: "POST", body: { name }, signal },
        noBody,
      ),

    postInstall: (agent_type, pod_id, signal) => {
      const body: { agent_type: string; pod_id?: string } = { agent_type };
      if (pod_id !== undefined) body.pod_id = pod_id;
      return runRequest(
        deps,
        "/api/install",
        { method: "POST", body, signal },
        (b) => expectShape(b, isJobResponse, "malformed /api/install"),
      );
    },

    postOpenExternal: (url, signal) =>
      runRequest(
        deps,
        "/api/open-external",
        { method: "POST", body: { url }, signal },
        noBody,
      ),

    postSettingsAutostartTray: (enabled, signal) =>
      runRequest(
        deps,
        "/api/settings/autostart-tray",
        { method: "POST", body: { enabled }, signal },
        noBody,
      ),

    postSettingsAutostartTunnel: (enabled, signal) =>
      runRequest(
        deps,
        "/api/settings/autostart-tunnel",
        { method: "POST", body: { enabled }, signal },
        noBody,
      ),

    jobStreamUrl: (jobId) =>
      `${baseUrl}/api/jobs/${encodeURIComponent(jobId)}/stream`,
  };
};
