import type { Secret } from "@/types/daemon";

// Mark a raw daemon string as Secret. ONLY call inside the daemon client
// when materialising the wire payload — never inside components.
export const asSecret = (raw: string): Secret =>
  ({ _value: raw } as unknown as Secret);

// Default UI render: "●●●●…<last 4 chars>". If the secret is too short to
// mask meaningfully, the whole thing is masked.
export const maskSecret = (s: Secret): string => {
  const raw = (s as unknown as { _value: string })._value;
  if (raw.length <= 4) return "●●●●";
  return `●●●●…${raw.slice(-4)}`;
};

// Reveal the raw value. Caller MUST pass the literal "user_gesture" — any
// other call site is a TypeScript error. Callers should also log a
// security event to NotificationCenter (Phase 3b).
export const revealSecret = (
  s: Secret,
  source: "user_gesture",
): string => {
  void source;
  return (s as unknown as { _value: string })._value;
};

// Mask a `?token=<hex>` URL. Idempotent for non-token URLs.
export const maskTokenUrl = (rawUrl: Secret): string => {
  const url = (rawUrl as unknown as { _value: string })._value;
  return url.replace(/(\?|&)token=[^&]+/i, "$1token=●●●●");
};

// Reveal a token URL fully. Same gesture rule as `revealSecret`.
export const revealTokenUrl = (
  rawUrl: Secret,
  source: "user_gesture",
): string => revealSecret(rawUrl, source);
