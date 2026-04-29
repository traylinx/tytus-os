// Opaque wrapper for any string the daemon returns that must NEVER render
// directly into JSX (user_key, ?token=<hex> URLs, any bearer material).
//
// The wrapper is an object — NOT a string subtype — so TypeScript will
// reject `<div>{secret}</div>` because Secret is not assignable to
// React.ReactNode. Callers must go through maskSecret / revealSecret /
// maskTokenUrl in `lib/secrets.ts`.
//
// `_value` is intentionally NOT public; the brand symbol prevents any
// non-helper code from reaching the underlying string.

declare const __secretBrand: unique symbol;

export interface Secret {
  readonly [__secretBrand]: "Secret";
  readonly _value: string;
}
