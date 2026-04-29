// Negative-compile fixture for the Secret brand. Compiled by
// `tsconfig.guard.json` separately from the app build. Each
// `@ts-expect-error` MUST stay valid — if any becomes "unused", tsc fails
// and CI catches the brand decay.
//
// If this file ever stops failing the right errors, the Secret brand has
// decayed and secrets can leak into JSX. Treat that as a P0 regression.

import type { Secret } from "@/types/daemon";

declare const aSecret: Secret;
declare const aPlainString: string;

// 1. Direct JSX render of Secret must fail (Secret is an opaque object,
//    not assignable to React.ReactNode).
export function GuardJsxRender() {
  // @ts-expect-error: rendering a Secret directly into JSX is forbidden.
  return <div>{aSecret}</div>;
}

// 2. Plain strings cannot impersonate Secret without going through asSecret.
export function GuardStringToSecret(): Secret {
  // @ts-expect-error: only `asSecret(...)` may produce a Secret.
  return aPlainString;
}

// 3. Template literals interpolating a Secret should not produce a Secret.
export function GuardTemplate(): Secret {
  // @ts-expect-error: template strings are plain strings, not Secret.
  return `${aSecret}` as string;
}

// 4. Spreading a Secret into a string position must fail.
export function GuardConcatBack(): Secret {
  // @ts-expect-error: + with a string yields a string, not a Secret.
  return ("prefix" + aSecret) as string;
}
