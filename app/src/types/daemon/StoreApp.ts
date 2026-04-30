/** Single entry in the static App Store catalog (served by GET /api/apps). */
export interface StoreApp {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  url: string;
  platforms: string[];
  detect: Record<string, string[]>;
  install: Record<string, string>;
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
