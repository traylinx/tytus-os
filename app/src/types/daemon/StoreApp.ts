/** Per-platform launch spec for an installed desktop app. */
export interface StoreAppLaunchSpec {
  /** "app" → GUI app launched by name; "terminal" → CLI opened in a terminal. */
  kind: string;
  /** App bundle name (kind=app) or binary/command (kind=terminal). */
  target: string;
}

/** Optional one-click LLM provider setup metadata for desktop AI apps. */
export interface StoreAppLlmSetup {
  adapter: string;
  provider: string;
  default_model: string;
  supports_default?: boolean;
}

/** Architecture-aware installer option for desktop apps. New catalog entries
 *  should prefer this over the legacy install[platform] string. */
export interface StoreAppInstaller {
  os: string;
  arch?: string;
  package_manager?: string;
  kind: string;
  label?: string;
  command?: string;
  url?: string;
}

/** Single entry in the static App Store catalog (served by GET /api/apps). */
export interface StoreApp {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  url: string;
  /** Documentation / help URL for the "Docs" button. Optional for back-compat. */
  docs?: string;
  platforms: string[];
  detect: Record<string, string[]>;
  install: Record<string, string>;
  installers?: StoreAppInstaller[];
  /** Per-platform launch spec, keyed by "macos" | "linux". Optional. */
  launch?: Record<string, StoreAppLaunchSpec>;
  /** Optional provider setup capability for OpenAI-compatible desktop apps. */
  llm_setup?: StoreAppLlmSetup;
}

/** Response from POST /api/apps/open for a single app. */
export interface StoreAppOpenResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Response from POST /api/apps/open with { all: true }. */
export interface StoreAppOpenAllResult {
  ok: boolean;
  opened: string[];
  skipped: { id: string; reason: string }[];
}

/** Response from POST /api/apps/install. `action` is "terminal" (install
 *  command launched in a Terminal window) or "opened_url" (instruction-only
 *  install — the app's website was opened). */
export interface StoreAppInstallResult {
  ok: boolean;
  action?: string;
  url?: string;
  id?: string;
  error?: string;
}

/** One result from POST /api/apps/check. */
export interface StoreAppCheckResult {
  id: string;
  installed: boolean;
  status?: "not_installed" | "installed_ok" | "installed_broken" | "unsupported" | "unknown";
  health?: "ok" | "broken" | "unsupported" | "unknown";
  problems?: string[];
  install_label?: string | null;
  install_command?: string | null;
  install_url?: string | null;
  install_kind?: string | null;
  target_label?: string | null;
  error?: string;
}

/** Full response from POST /api/apps/check. */
export interface StoreAppCheckResponse {
  results: StoreAppCheckResult[];
}

export interface StoreAppLlmStatus {
  app_id: string;
  supported: boolean;
  configured: boolean;
  provider: string;
  model: string;
  base_url?: string | null;
  key_hint?: string | null;
  restart_required: boolean;
  message: string;
}

export interface StoreAppConfigureLlmResult {
  ok: boolean;
  app_id: string;
  configured: boolean;
  provider: string;
  model: string;
  backup_path?: string | null;
  restart_required: boolean;
  message: string;
}
