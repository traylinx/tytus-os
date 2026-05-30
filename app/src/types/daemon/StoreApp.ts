/** Per-platform launch spec for an installed desktop app. */
export interface StoreAppLaunchSpec {
  /** "app" → GUI app launched by name; "terminal" → CLI opened in a terminal. */
  kind: string;
  /** App bundle name (kind=app) or binary/command (kind=terminal). */
  target: string;
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
  /** Per-platform launch spec, keyed by "macos" | "linux". Optional. */
  launch?: Record<string, StoreAppLaunchSpec>;
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
  error?: string;
}

/** Full response from POST /api/apps/check. */
export interface StoreAppCheckResponse {
  results: StoreAppCheckResult[];
}
