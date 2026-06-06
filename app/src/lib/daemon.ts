import { asSecret } from "@/lib/secrets";
import { err, ok } from "@/types/daemon";
import type {
  Agent,
  Catalog,
  ChannelsResponse,
  ChannelsCatalogResult,
  DaemonError,
  DaemonErrorCode,
  DaemonResult,
  DaemonSettings,
  DaemonStatus,
  DaemonVersion,
  ErrorEnvelope,
  CortexProfileSetResponse,
  CortexStatus,
  FileCopyMoveBody,
  FileList,
  FileListEntry,
  FileMutationSource,
  FileUploadBody,
  GaragetytusStatus,
  IncludedPod,
  JobCancelResult,
  JobResponse,
  Launchers,
  LogChunk,
  PodEnv,
  PodEnvVar,
  PodReady,
  PodReadiness,
  PodReadinessStage,
  SharingDefaults,
  SharedFolderProvisionPodRequest,
  SharedFolderUpdateTargetsRequest,
  SharedFoldersList,
  StateSnapshot,
  StoreApp,
  StoreAppCheckResponse,
  StoreAppOpenResult,
  StoreAppOpenAllResult,
  StoreAppInstallResult,
  UpdateInstallResult,
  UpdateStatus,
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
    id: a.id || a.route_id || a.pod_id,
    display_label: a.display_label || a.display_name || `Pod ${a.pod_id}`,
    user_key: asSecret(a.user_key),
    ui_url: asSecret(a.ui_url),
  })),
  included: raw.included.map((p) => ({
    ...p,
    id: p.id || p.route_id || p.pod_id,
    display_label: p.display_label || `Pod ${p.pod_id}`,
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
    const message = isErrorEnvelope(body2)
      ? body2.error
      : `daemon ${res.status}`;
    return err<T>(errorOf("internal_error", message, res.status));
  }

  if (res.status === 400) {
    const message = isErrorEnvelope(body2) ? body2.error : "bad request";
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
  guard(body) ? ok(body) : err<T>(errorOf("daemon_unhealthy", message));

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

const isUpdateStatus = (v: unknown): v is UpdateStatus =>
  isObject(v) &&
  typeof v.current_version === "string" &&
  typeof v.installed_version === "string" &&
  (v.latest_version === null || typeof v.latest_version === "string") &&
  (v.release_tag === null || typeof v.release_tag === "string") &&
  (v.release_url === null || typeof v.release_url === "string") &&
  (v.install_url === null || typeof v.install_url === "string") &&
  typeof v.install_command === "string" &&
  typeof v.can_install === "boolean" &&
  typeof v.channel === "string" &&
  (v.status === "up_to_date" ||
    v.status === "update_available" ||
    v.status === "unknown") &&
  typeof v.automatic_checks === "boolean" &&
  (v.last_checked_at === null || typeof v.last_checked_at === "number") &&
  (v.checked_at === null || typeof v.checked_at === "number") &&
  typeof v.detail === "string";

const isUpdateInstallResult = (v: unknown): v is UpdateInstallResult =>
  isObject(v) &&
  typeof v.ok === "boolean" &&
  typeof v.command === "string" &&
  typeof v.message === "string";

const isJobResponse = (v: unknown): v is JobResponse =>
  isObject(v) && typeof v.job_id === "string";

const isJobCancelResult = (v: unknown): v is JobCancelResult =>
  isObject(v) && typeof v.cancelled === "boolean";

const isCatalog = (v: unknown): v is Catalog =>
  isObject(v) && typeof v.version === "string" && Array.isArray(v.agents);

const isStoreApps = (v: unknown): v is StoreApp[] =>
  Array.isArray(v) &&
  v.every(
    (a) =>
      isObject(a) &&
      typeof a.id === "string" &&
      typeof a.name === "string" &&
      typeof a.url === "string",
  );

const isStoreAppCheckResponse = (v: unknown): v is StoreAppCheckResponse =>
  isObject(v) &&
  Array.isArray(v.results) &&
  v.results.every(
    (r: unknown) =>
      isObject(r) &&
      typeof r.id === "string" &&
      typeof r.installed === "boolean",
  );

const isStoreAppOpenResult = (v: unknown): v is StoreAppOpenResult =>
  isObject(v) && typeof v.ok === "boolean";

const isStoreAppInstallResult = (v: unknown): v is StoreAppInstallResult =>
  isObject(v) && typeof v.ok === "boolean";

const isStoreAppOpenAllResult = (v: unknown): v is StoreAppOpenAllResult =>
  isObject(v) &&
  typeof v.ok === "boolean" &&
  Array.isArray(v.opened) &&
  Array.isArray(v.skipped);

const isChannels = (v: unknown): v is ChannelsResponse =>
  isObject(v) &&
  typeof v.pod_id === "string" &&
  Array.isArray(v.available) &&
  Array.isArray(v.configured);

const isChannelsCatalogResult = (v: unknown): v is ChannelsCatalogResult =>
  isObject(v) &&
  typeof v.ok === "boolean" &&
  typeof v.exit_code === "number" &&
  typeof v.stdout === "string" &&
  typeof v.stderr === "string";

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

const canonicalPodId = (podId: string): string => {
  const trimmed = podId.trim();
  return /^\d$/.test(trimmed) ? `0${trimmed}` : trimmed;
};

const isPodReady = (v: unknown): v is PodReady =>
  isObject(v) &&
  typeof v.ready === "boolean" &&
  (typeof v.status === "number" || typeof v.status === "string") &&
  typeof v.reason === "string" &&
  (v.probe_url === undefined || typeof v.probe_url === "string");

const isPodReadinessStage = (v: unknown): v is PodReadinessStage =>
  isObject(v) &&
  typeof v.id === "string" &&
  typeof v.label === "string" &&
  typeof v.status === "string" &&
  (v.detail === null || typeof v.detail === "string");

const isPodReadiness = (v: unknown): v is PodReadiness =>
  isObject(v) &&
  typeof v.pod_id === "string" &&
  (v.agent === null || typeof v.agent === "string") &&
  typeof v.overall === "string" &&
  typeof v.open_enabled === "boolean" &&
  typeof v.strict === "boolean" &&
  Array.isArray(v.stages) &&
  v.stages.every(isPodReadinessStage) &&
  (typeof v.last_checked_at === "number" ||
    typeof v.last_checked_at === "string");

const isFileListEntry = (v: unknown): v is FileListEntry =>
  isObject(v) &&
  typeof v.name === "string" &&
  typeof v.path === "string" &&
  (v.kind === "file" || v.kind === "dir") &&
  typeof v.size === "number" &&
  (v.modified_at === null || typeof v.modified_at === "number") &&
  typeof v.readonly === "boolean";

const isFileList = (v: unknown): v is FileList =>
  isObject(v) &&
  typeof v.source === "string" &&
  typeof v.path === "string" &&
  typeof v.root_label === "string" &&
  typeof v.root_path === "string" &&
  Array.isArray(v.entries) &&
  v.entries.every(isFileListEntry) &&
  typeof v.readonly === "boolean";

const isSharedFolders = (v: unknown): v is SharedFoldersList =>
  isObject(v) && Array.isArray(v.bindings);

const isSharingDefaults = (v: unknown): v is SharingDefaults =>
  isObject(v) &&
  typeof v.schema_version === "number" &&
  typeof v.sharing_globally_enabled === "boolean" &&
  typeof v.default_auto_sync === "boolean" &&
  typeof v.default_bucket === "string" &&
  typeof v.default_local_root === "string";

const isCortexStatus = (v: unknown): v is CortexStatus =>
  isObject(v) &&
  typeof v.profile === "string" &&
  typeof v.local_port === "number" &&
  typeof v.local_token_present === "boolean" &&
  typeof v.local_user_id_present === "boolean" &&
  typeof v.internal_service_token_present === "boolean" &&
  typeof v.api_reachable === "boolean";

const isCortexProfileSetResponse = (
  v: unknown,
): v is CortexProfileSetResponse =>
  isObject(v) &&
  typeof v.ok === "boolean" &&
  typeof v.profile === "string" &&
  (v.profile === "cloud" || v.profile === "local");

const isGaragetytusStatus = (v: unknown): v is GaragetytusStatus =>
  isObject(v) &&
  typeof v.available === "boolean" &&
  (v.running === null || typeof v.running === "boolean") &&
  typeof v.state === "string" &&
  typeof v.status_text === "string" &&
  (v.version === null || typeof v.version === "string") &&
  typeof v.port === "number" &&
  (v.garage_endpoint === undefined || typeof v.garage_endpoint === "string") &&
  (v.garage_endpoint_reachable === undefined ||
    typeof v.garage_endpoint_reachable === "boolean") &&
  (v.binary_path === null || typeof v.binary_path === "string") &&
  (v.cache_path === null || typeof v.cache_path === "string") &&
  typeof v.cache_exists === "boolean" &&
  typeof v.bindings_count === "number" &&
  Array.isArray(v.provisioned_pods) &&
  v.provisioned_pods.every((p) => typeof p === "string") &&
  Array.isArray(v.helpers) &&
  v.helpers.every(
    (h) =>
      isObject(h) &&
      typeof h.name === "string" &&
      typeof h.found === "boolean" &&
      (h.path === null || typeof h.path === "string"),
  ) &&
  Array.isArray(v.missing_helpers) &&
  v.missing_helpers.every((h) => typeof h === "string") &&
  typeof v.lifecycle_control_available === "boolean" &&
  typeof v.lifecycle_control_reason === "string" &&
  Array.isArray(v.warnings) &&
  v.warnings.every((w) => typeof w === "string");

const isPodEnvVar = (v: unknown): v is PodEnvVar =>
  isObject(v) &&
  typeof v.key === "string" &&
  typeof v.value === "string" &&
  (v.source === undefined || typeof v.source === "string");

// Codex review 2026-04-29: validate the optional fields too. Without
// these checks a malformed daemon response (e.g. `agent_type: 42`)
// passed the guard and crashed PodEnvPane when React tried to render
// the badge text.
const isPodEnv = (v: unknown): v is PodEnv =>
  isObject(v) &&
  Array.isArray(v.vars) &&
  v.vars.every(isPodEnvVar) &&
  (v.pod_num === undefined || typeof v.pod_num === "number") &&
  (v.agent_type === undefined || typeof v.agent_type === "string") &&
  (v.reveal_secrets === undefined || typeof v.reveal_secrets === "boolean");

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

export interface AgentChatRequest {
  message: string;
  /** Provider route id. Required to disambiguate duplicate pod_id values. */
  route_id?: string;
  session_id?: string | null;
  chat_target?: "agent";
  agent_mode?: "operator" | "brain";
  model_preference?: "balanced" | "fast" | "deep";
  stream?: boolean;
}

export interface AgentDirectChatResponse {
  message: string;
  source: "agent_direct";
  agent_type?: string;
  session_id?: string | null;
}

export interface LoginStartResult {
  verification_uri: string;
  user_code: string;
  expires_in: number;
  opened_browser: boolean;
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
  getUpdateStatus(signal?: AbortSignal): Promise<DaemonResult<UpdateStatus>>;
  getCatalog(signal?: AbortSignal): Promise<DaemonResult<Catalog>>;
  getStoreApps(signal?: AbortSignal): Promise<DaemonResult<StoreApp[]>>;
  postStoreAppsCheck(
    appIds: string[],
    signal?: AbortSignal,
  ): Promise<DaemonResult<StoreAppCheckResponse>>;
  /** Launch a single installed desktop app by catalog id. */
  postAppOpen(
    appId: string,
    signal?: AbortSignal,
  ): Promise<DaemonResult<StoreAppOpenResult>>;
  /** Launch every installed desktop app; returns opened + skipped lists. */
  postAppsOpenAll(
    signal?: AbortSignal,
  ): Promise<DaemonResult<StoreAppOpenAllResult>>;
  /** Run a desktop app's install command in a Terminal (or open its site). */
  postAppInstall(
    appId: string,
    signal?: AbortSignal,
  ): Promise<DaemonResult<StoreAppInstallResult>>;
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
  getPodReadiness(
    podId: string,
    signal?: AbortSignal,
  ): Promise<DaemonResult<PodReadiness>>;
  /**
   * Per-pod env vars (manifest A.exist A3.5). The daemon proxies through
   * to Provider, which redacts secret-shaped keys unless the caller is
   * Operator-tier and passes `revealSecrets: true`. A 403 result with
   * `code: "auth_required"` means the user's plan tier is below
   * Operator — surface it as an upgrade prompt, not an error toast.
   */
  getPodEnv(
    podId: string,
    revealSecrets?: boolean,
    signal?: AbortSignal,
  ): Promise<DaemonResult<PodEnv>>;
  getFilesList(
    params: { source: string; path?: string; pod?: string; binding?: number },
    signal?: AbortSignal,
  ): Promise<DaemonResult<FileList>>;
  getSharedFolders(
    signal?: AbortSignal,
  ): Promise<DaemonResult<SharedFoldersList>>;
  getSharingDefaults(
    signal?: AbortSignal,
  ): Promise<DaemonResult<SharingDefaults>>;
  getGaragetytusStatus(
    signal?: AbortSignal,
  ): Promise<DaemonResult<GaragetytusStatus>>;
  /**
   * Local Cortex profile + health snapshot. Settings → AI polls every 5s.
   *
   * `profile === "local"` AND `api_reachable === true` means chat will route
   * through the local stack on `127.0.0.1:<local_port>`. Other combinations
   * fall back to cloud (the tray daemon's `resolve_cortex_upstream` enforces
   * this safety net).
   */
  getCortexStatus(signal?: AbortSignal): Promise<DaemonResult<CortexStatus>>;
  /**
   * Flip the active Cortex profile. Idempotent. Does NOT install or
   * uninstall containers — `tytus cortex up` / `tytus cortex down` handle
   * lifecycle, this only flips the routing flag in state.json.
   */
  postCortexProfile(
    profile: "cloud" | "local",
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<CortexProfileSetResponse>>;

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
  postLogin(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<LoginStartResult>>;
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
  postConfigure(
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
  /**
   * Stream Cortex-backed chat for a real OpenClaw/Hermes agent pod.
   * Returns raw Response because the body is text/event-stream.
   */
  postPodCortexChat(
    podId: string,
    body: AgentChatRequest,
    signal?: AbortSignal,
  ): Promise<Response>;
  /** Direct non-streaming agent fallback when Cortex is still warming. */
  postPodAgentChat(
    podId: string,
    body: AgentChatRequest,
    signal?: AbortSignal,
  ): Promise<DaemonResult<AgentDirectChatResponse>>;
  postPodRestart(
    podId: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  /**
   * Set or clear a pod's user-facing display name. Pass `null` or `""`
   * to clear. Server validates 1–48 chars and rejects control chars
   * with HTTP 400 `invalid_display_name`. `routeId` is REQUIRED when
   * multiple pods share the same `podId` (e.g. OpenClaw + Hermes both
   * allocated as pod 01) — without it Provider picks the first match
   * and the rename lands on the wrong pod. Use `agent.route_id` for
   * safety even when there's only one pod.
   */
  postPodRename(
    podId: string,
    routeId: string | null,
    displayName: string | null,
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
  postChannelsCatalog(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<ChannelsCatalogResult>>;
  postFilesOpenDownloads(
    podId: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postFilesMkdir(
    params: FileMutationSource & { name: string },
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postFilesRename(
    params: FileMutationSource & { new_name: string },
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postFilesDelete(
    params: FileMutationSource,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postFilesTrash(
    params: FileMutationSource,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postFilesCopy(
    params: FileCopyMoveBody,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postFilesMove(
    params: FileCopyMoveBody,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postFilesUpload(
    params: FileUploadBody,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  filesDownloadUrl(params: FileMutationSource): string;
  postWorkspaceOpen(
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
  postSharedFoldersProvisionPod(
    payload: SharedFolderProvisionPodRequest,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<JobResponse>>;
  postSharedFoldersUpdateTargets(
    payload: SharedFolderUpdateTargetsRequest,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<null>>;
  postSharingDefaults(
    payload: Partial<
      Pick<
        SharingDefaults,
        | "sharing_globally_enabled"
        | "default_auto_sync"
        | "default_bucket"
        | "default_local_root"
      >
    >,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<SharingDefaults>>;
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
  postUpdateCheck(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<UpdateStatus>>;
  postUpdateInstall(
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<UpdateInstallResult>>;
  postUpdateAutomaticChecks(
    enabled: boolean,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<DaemonResult<UpdateStatus>>;

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
        return err<ConditionalStateResult>(
          errorOf("not_found", "not found", 404),
        );
      }
      if (res.status === 401 || res.status === 403) {
        return err<ConditionalStateResult>(
          errorOf("auth_required", "auth required", res.status),
        );
      }
      const body = await tryJson(res);
      if (res.status >= 500) {
        const message = isErrorEnvelope(body)
          ? body.error
          : `daemon ${res.status}`;
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

    getUpdateStatus: (signal) =>
      runRequest(deps, "/api/update/status", { signal }, (b) =>
        expectShape(b, isUpdateStatus, "malformed /api/update/status"),
      ),

    getCatalog: (signal) =>
      runRequest(deps, "/api/catalog", { signal }, (b) =>
        expectShape(b, isCatalog, "malformed /api/catalog"),
      ),

    getStoreApps: (signal) =>
      runRequest(deps, "/api/apps", { signal }, (b) =>
        expectShape(b, isStoreApps, "malformed /api/apps"),
      ),

    postStoreAppsCheck: (appIds, signal) =>
      runRequest(
        deps,
        "/api/apps/check",
        {
          method: "POST",
          body: { app_ids: appIds },
          signal,
        },
        (b) =>
          expectShape(b, isStoreAppCheckResponse, "malformed /api/apps/check"),
      ),

    postAppOpen: (appId, signal) =>
      runRequest(
        deps,
        "/api/apps/open",
        {
          method: "POST",
          body: { app_id: appId },
          signal,
        },
        (b) => expectShape(b, isStoreAppOpenResult, "malformed /api/apps/open"),
      ),

    postAppsOpenAll: (signal) =>
      runRequest(
        deps,
        "/api/apps/open",
        {
          method: "POST",
          body: { all: true },
          signal,
        },
        (b) =>
          expectShape(b, isStoreAppOpenAllResult, "malformed /api/apps/open (all)"),
      ),

    postAppInstall: (appId, signal) =>
      runRequest(
        deps,
        "/api/apps/install",
        {
          method: "POST",
          body: { app_id: appId },
          signal,
        },
        (b) =>
          expectShape(b, isStoreAppInstallResult, "malformed /api/apps/install"),
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

    getPodReady: (podId, signal) => {
      const pod = canonicalPodId(podId);
      return runRequest(
        deps,
        `/api/pod/ready?pod=${encodeURIComponent(pod)}`,
        { signal },
        (b) => expectShape(b, isPodReady, "malformed /api/pod/ready"),
      );
    },

    getPodReadiness: (podId, signal) => {
      const pod = canonicalPodId(podId);
      return runRequest(
        deps,
        `/api/pods/${encodeURIComponent(pod)}/readiness`,
        { signal },
        (b) =>
          expectShape(b, isPodReadiness, "malformed /api/pods/:pod/readiness"),
      );
    },

    getPodEnv: (podId, revealSecrets, signal) => {
      const reveal = revealSecrets ? "&reveal=secrets" : "";
      return runRequest(
        deps,
        `/api/pod/env?pod=${encodeURIComponent(podId)}${reveal}`,
        { signal },
        (b) => expectShape(b, isPodEnv, "malformed /api/pod/env"),
      );
    },

    getFilesList: (params, signal) => {
      const q = new URLSearchParams();
      q.set("source", params.source);
      if (params.path) q.set("path", params.path);
      if (params.pod) q.set("pod", params.pod);
      if (params.binding !== undefined)
        q.set("binding", String(params.binding));
      return runRequest(
        deps,
        `/api/files/list?${q.toString()}`,
        { signal },
        (b) => expectShape(b, isFileList, "malformed /api/files/list"),
      );
    },

    getSharedFolders: (signal) =>
      runRequest(deps, "/api/shared-folders/list", { signal }, (b) =>
        expectShape(b, isSharedFolders, "malformed /api/shared-folders/list"),
      ),

    getSharingDefaults: (signal) =>
      runRequest(deps, "/api/sharing/defaults", { signal }, (b) =>
        expectShape(b, isSharingDefaults, "malformed /api/sharing/defaults"),
      ),

    getGaragetytusStatus: (signal) =>
      runRequest(deps, "/api/garagetytus/status", { signal }, (b) =>
        expectShape(
          b,
          isGaragetytusStatus,
          "malformed /api/garagetytus/status",
        ),
      ),

    getCortexStatus: (signal) =>
      runRequest(deps, "/api/cortex/status", { signal }, (b) =>
        expectShape(b, isCortexStatus, "malformed /api/cortex/status"),
      ),

    postCortexProfile: (profile, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/cortex/profile",
        {
          method: "POST",
          body: { profile },
          signal,
          idempotencyKey,
        },
        (b) =>
          expectShape(
            b,
            isCortexProfileSetResponse,
            "malformed /api/cortex/profile",
          ),
      ),

    postLogout: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/logout",
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postLogin: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/login",
        { method: "POST", signal, idempotencyKey },
        (b) =>
          expectShape(
            b,
            (v): v is LoginStartResult =>
              isObject(v) &&
              typeof v.verification_uri === "string" &&
              typeof v.user_code === "string" &&
              typeof v.expires_in === "number" &&
              typeof v.opened_browser === "boolean",
            "malformed /api/login",
          ),
      ),

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
      runRequest(
        deps,
        "/api/connect",
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postConfigure: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/configure",
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postDisconnect: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/disconnect",
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postTest: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/test",
        { method: "POST", signal, idempotencyKey },
        (b) => expectShape(b, isJobResponse, "malformed /api/test"),
      ),

    postDoctor: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/doctor",
        { method: "POST", signal, idempotencyKey },
        (b) => expectShape(b, isJobResponse, "malformed /api/doctor"),
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

    postPodCortexChat: (podId, body, signal) =>
      f(`${baseUrl}/api/pods/${encodeURIComponent(podId)}/cortex/chat`, {
        method: "POST",
        headers: {
          Accept: "text/event-stream, application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
        credentials: "same-origin",
      }),

    postPodAgentChat: (podId, body, signal) =>
      runRequest(
        deps,
        `/api/pods/${encodeURIComponent(podId)}/agent/chat`,
        { method: "POST", body, signal },
        (b) =>
          expectShape(
            b,
            (v): v is AgentDirectChatResponse =>
              isObject(v) && typeof v.message === "string",
            "malformed /api/pods/:pod/agent/chat",
          ),
      ),

    postPodRestart: (podId, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/pod/restart?pod=${encodeURIComponent(podId)}`,
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postPodRename: (podId, routeId, displayName, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/pod/rename`,
        {
          method: "POST",
          body: {
            pod_id: podId,
            route_id: routeId || null,
            display_name: displayName,
          },
          signal,
          idempotencyKey,
        },
        noBody,
      ),

    postPodRefreshCreds: (podId, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/pod/refresh-creds?pod=${encodeURIComponent(podId)}`,
        { method: "POST", signal, idempotencyKey },
        (b) =>
          expectShape(b, isJobResponse, "malformed /api/pod/refresh-creds"),
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

    postChannelsCatalog: async (signal, idempotencyKey) => {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      let res: Response;
      try {
        res = await f(`${baseUrl}/api/channels/catalog`, {
          method: "POST",
          headers,
          signal,
          credentials: "same-origin",
        });
      } catch (cause) {
        return err<ChannelsCatalogResult>(classifyNetworkError(cause));
      }
      if (res.status === 404) {
        return err<ChannelsCatalogResult>(
          errorOf("not_found", "not found", 404),
        );
      }
      if (res.status === 401 || res.status === 403) {
        return err<ChannelsCatalogResult>(
          errorOf("auth_required", "auth required", res.status),
        );
      }
      const body = await tryJson(res);
      if (isChannelsCatalogResult(body)) {
        return ok(body);
      }
      if (isErrorEnvelope(body)) {
        return err<ChannelsCatalogResult>(
          errorOf(
            res.status >= 500 ? "internal_error" : "logical_error",
            body.error,
            res.status,
          ),
        );
      }
      return err<ChannelsCatalogResult>(
        errorOf("daemon_unhealthy", "malformed /api/channels/catalog"),
      );
    },

    postFilesOpenDownloads: (podId, signal, idempotencyKey) =>
      runRequest(
        deps,
        `/api/files/open-downloads?pod=${encodeURIComponent(podId)}`,
        { method: "POST", signal, idempotencyKey },
        noBody,
      ),

    postFilesMkdir: (params, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/files/mkdir",
        { method: "POST", body: params, signal, idempotencyKey },
        noBody,
      ),

    postFilesRename: (params, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/files/rename",
        { method: "POST", body: params, signal, idempotencyKey },
        noBody,
      ),

    postFilesDelete: (params, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/files/delete",
        { method: "POST", body: params, signal, idempotencyKey },
        noBody,
      ),

    postFilesTrash: (params, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/files/trash",
        { method: "POST", body: params, signal, idempotencyKey },
        noBody,
      ),

    postFilesCopy: (params, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/files/copy",
        { method: "POST", body: params, signal, idempotencyKey },
        noBody,
      ),

    postFilesMove: (params, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/files/move",
        { method: "POST", body: params, signal, idempotencyKey },
        noBody,
      ),

    postFilesUpload: (params, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/files/upload",
        { method: "POST", body: params, signal, idempotencyKey },
        noBody,
      ),

    filesDownloadUrl: (params) => {
      const q = new URLSearchParams();
      q.set("source", params.source);
      if (params.path) q.set("path", params.path);
      if (params.binding !== undefined)
        q.set("binding", String(params.binding));
      return `${baseUrl}/api/files/download?${q.toString()}`;
    },

    postWorkspaceOpen: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/workspace/open",
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
          expectShape(b, isJobResponse, "malformed /api/shared-folders/bind"),
      ),

    postSharedFoldersProvisionPod: (payload, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/shared-folders/provision-pod",
        { method: "POST", body: payload, signal, idempotencyKey },
        (b) =>
          expectShape(
            b,
            isJobResponse,
            "malformed /api/shared-folders/provision-pod",
          ),
      ),

    postSharedFoldersUpdateTargets: (payload, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/shared-folders/update-targets",
        { method: "POST", body: payload, signal, idempotencyKey },
        noBody,
      ),

    postSharingDefaults: (payload, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/sharing/defaults",
        { method: "POST", body: payload, signal, idempotencyKey },
        (b) =>
          expectShape(b, isSharingDefaults, "malformed /api/sharing/defaults"),
      ),

    postSharedFoldersOpen: (localPath, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/shared-folders/open",
        {
          method: "POST",
          body: { local_path: localPath },
          signal,
          idempotencyKey,
        },
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
        (b) =>
          expectShape(b, isJobCancelResult, "malformed /api/jobs/.../cancel"),
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

    postUpdateCheck: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/update/check",
        { method: "POST", signal, idempotencyKey },
        (b) => expectShape(b, isUpdateStatus, "malformed /api/update/check"),
      ),

    postUpdateInstall: (signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/update/install",
        { method: "POST", signal, idempotencyKey },
        (b) =>
          expectShape(b, isUpdateInstallResult, "malformed /api/update/install"),
      ),

    postUpdateAutomaticChecks: (enabled, signal, idempotencyKey) =>
      runRequest(
        deps,
        "/api/update/automatic",
        { method: "POST", body: { enabled }, signal, idempotencyKey },
        (b) =>
          expectShape(b, isUpdateStatus, "malformed /api/update/automatic"),
      ),

    jobStreamUrl: (jobId) =>
      `${baseUrl}/api/jobs/${encodeURIComponent(jobId)}/stream`,
  };
};
