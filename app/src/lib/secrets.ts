import type { Secret } from "@/types/daemon";

// Mark a raw daemon string as Secret. ONLY call inside the daemon client
// when materialising the wire payload — never inside components.
export const asSecret = (raw: string): Secret =>
  ({ _value: raw } as unknown as Secret);

// Read the raw string off a Secret. Returns "" for null/undefined inputs
// so callers can render an empty placeholder instead of crashing — the
// daemon may emit `null` for optional URL fields (e.g. an agent's ui_url
// when there is no UI route) and components should not have to special-
// case nullability everywhere they render a Secret.
const readRaw = (s: Secret | null | undefined): string => {
  if (s === null || s === undefined) return "";
  const raw = (s as unknown as { _value: string })._value;
  return typeof raw === "string" ? raw : "";
};

// Default UI render: "●●●●…<last 4 chars>". If the secret is too short to
// mask meaningfully, the whole thing is masked. Null-safe.
export const maskSecret = (s: Secret | null | undefined): string => {
  const raw = readRaw(s);
  if (!raw) return "—";
  if (raw.length <= 4) return "●●●●";
  return `●●●●…${raw.slice(-4)}`;
};

// Reveal the raw value. Caller MUST pass the literal "user_gesture" — any
// other call site is a TypeScript error. Callers should also log a
// security event to NotificationCenter (Phase 3b). Null-safe — returns
// "" for absent secrets.
export const revealSecret = (
  s: Secret | null | undefined,
  source: "user_gesture",
): string => {
  void source;
  return readRaw(s);
};

// Mask a `?token=<hex>` URL. Idempotent for non-token URLs. Null-safe.
export const maskTokenUrl = (rawUrl: Secret | null | undefined): string => {
  const url = readRaw(rawUrl);
  if (!url) return "—";
  return url.replace(/(\?|&)token=[^&]+/i, "$1token=●●●●");
};

// Reveal a token URL fully. Same gesture rule as `revealSecret`. Null-safe.
export const revealTokenUrl = (
  rawUrl: Secret | null | undefined,
  source: "user_gesture",
): string => revealSecret(rawUrl, source);
