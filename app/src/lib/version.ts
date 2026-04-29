/**
 * Minimum tray-daemon version this OS bundle is compatible with.
 *
 * 0.6.0 is the version that landed `state-includes-version` +
 * `If-None-Match` ETag conditional GET + SSE `Last-Event-ID` together.
 * Earlier daemons miss at least one of those, and fail in subtle ways
 * the OS can't paper over (404 spam, full state replay every poll,
 * full event replay on SSE reconnect).
 *
 * Bumping this constant strands old-daemon users on the
 * UpgradeDaemonScreen until they rebuild — that's intentional. Bump
 * deliberately and only when the new floor is genuinely required.
 */
export const MIN_DAEMON_VERSION = "0.6.0";

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated identifiers; null when no `-pre` suffix present. */
  prerelease: string | null;
}

// SemVer 2.0 grammar, modulo: we ignore build metadata (per spec, it
// MUST be ignored when determining version precedence).
const SEMVER_RE =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export const parseSemver = (v: string): ParsedSemver => {
  const m = SEMVER_RE.exec(v);
  if (!m) throw new Error(`Invalid semver: ${v}`);
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ?? null,
  };
};

const comparePrereleaseIdent = (a: string, b: string): -1 | 0 | 1 => {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const an = parseInt(a, 10);
    const bn = parseInt(b, 10);
    if (an === bn) return 0;
    return an < bn ? -1 : 1;
  }
  // Numeric identifiers always have lower precedence than non-numeric.
  if (aNum) return -1;
  if (bNum) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const comparePrerelease = (a: string, b: string): -1 | 0 | 1 => {
  const aParts = a.split(".");
  const bParts = b.split(".");
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ai = aParts[i];
    const bi = bParts[i];
    if (ai === undefined) return -1; // shorter wins (1.0.0-alpha < 1.0.0-alpha.1)
    if (bi === undefined) return 1;
    const c = comparePrereleaseIdent(ai, bi);
    if (c !== 0) return c;
  }
  return 0;
};

export type SemverOrdering = -1 | 0 | 1;

/**
 * Compare two semver strings. Returns -1 if `a < b`, 0 if equal, 1 if
 * `a > b`. Throws on malformed input — callers that want fail-closed
 * tolerance should use `isDaemonVersionSupported` instead.
 */
export const compareSemver = (a: string, b: string): SemverOrdering => {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (const k of ["major", "minor", "patch"] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  // Per SemVer 2.0 §11: a pre-release version has lower precedence
  // than the associated normal version (1.0.0-beta < 1.0.0).
  if (pa.prerelease === null && pb.prerelease !== null) return 1;
  if (pa.prerelease !== null && pb.prerelease === null) return -1;
  if (pa.prerelease !== null && pb.prerelease !== null) {
    return comparePrerelease(pa.prerelease, pb.prerelease);
  }
  return 0;
};

/**
 * Returns true iff `version` is parseable AND `version >= minVersion`.
 * Fail-closed on every other input (null, undefined, malformed) so an
 * unparseable version surfaces as "unsupported" rather than
 * accidentally allowing a daemon we can't reason about.
 */
export const isDaemonVersionSupported = (
  version: string | null | undefined,
  minVersion: string,
): boolean => {
  if (!version) return false;
  try {
    return compareSemver(version, minVersion) >= 0;
  } catch {
    return false;
  }
};
