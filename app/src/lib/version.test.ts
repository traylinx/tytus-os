import { describe, expect, it } from "vitest";
import {
  compareSemver,
  isDaemonVersionSupported,
  MIN_DAEMON_VERSION,
  parseSemver,
} from "@/lib/version";

describe("parseSemver", () => {
  it("parses major.minor.patch", () => {
    expect(parseSemver("0.6.0")).toEqual({
      major: 0,
      minor: 6,
      patch: 0,
      prerelease: null,
    });
    expect(parseSemver("12.34.567")).toEqual({
      major: 12,
      minor: 34,
      patch: 567,
      prerelease: null,
    });
  });

  it("parses pre-release suffix", () => {
    expect(parseSemver("0.6.0-beta")).toMatchObject({
      prerelease: "beta",
    });
    expect(parseSemver("1.0.0-rc.2")).toMatchObject({
      prerelease: "rc.2",
    });
  });

  it("ignores build metadata", () => {
    expect(parseSemver("0.6.0+build123")).toMatchObject({
      major: 0,
      minor: 6,
      patch: 0,
      prerelease: null,
    });
    expect(parseSemver("0.6.0-beta+build")).toMatchObject({
      prerelease: "beta",
    });
  });

  it("rejects malformed input", () => {
    expect(() => parseSemver("0.6")).toThrow();
    expect(() => parseSemver("0.6.0.0")).toThrow();
    expect(() => parseSemver("v0.6.0")).toThrow();
    expect(() => parseSemver("")).toThrow();
    expect(() => parseSemver("not-a-version")).toThrow();
  });
});

describe("compareSemver", () => {
  it("orders by major, minor, patch", () => {
    expect(compareSemver("0.6.0", "0.5.9")).toBe(1);
    expect(compareSemver("0.5.9", "0.6.0")).toBe(-1);
    expect(compareSemver("0.6.1", "0.6.0")).toBe(1);
    expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
    expect(compareSemver("0.6.0", "0.6.0")).toBe(0);
  });

  it("ranks pre-release lower than release (semver §11)", () => {
    expect(compareSemver("0.6.0-beta", "0.6.0")).toBe(-1);
    expect(compareSemver("0.6.0", "0.6.0-beta")).toBe(1);
    expect(compareSemver("0.6.0-rc.1", "0.6.0-rc.1")).toBe(0);
  });

  it("ignores build metadata for ordering", () => {
    expect(compareSemver("0.6.0+build1", "0.6.0+build2")).toBe(0);
    expect(compareSemver("0.6.0+build", "0.6.0")).toBe(0);
  });

  it("compares pre-release identifiers (numeric < non-numeric, lex)", () => {
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha")).toBe(1);
    expect(compareSemver("1.0.0-alpha.beta", "1.0.0-alpha.1")).toBe(1);
  });
});

describe("isDaemonVersionSupported", () => {
  it("blocks pre-piggyback daemons (null / undefined)", () => {
    expect(isDaemonVersionSupported(null, "0.6.0")).toBe(false);
    expect(isDaemonVersionSupported(undefined, "0.6.0")).toBe(false);
  });

  it("blocks below floor", () => {
    expect(isDaemonVersionSupported("0.5.9", "0.6.0")).toBe(false);
    expect(isDaemonVersionSupported("0.6.0-beta", "0.6.0")).toBe(false);
    expect(isDaemonVersionSupported("", "0.6.0")).toBe(false);
  });

  it("allows at-or-above floor", () => {
    expect(isDaemonVersionSupported("0.6.0", "0.6.0")).toBe(true);
    expect(isDaemonVersionSupported("0.6.1", "0.6.0")).toBe(true);
    expect(isDaemonVersionSupported("1.0.0", "0.6.0")).toBe(true);
    expect(isDaemonVersionSupported("0.6.0+build123", "0.6.0")).toBe(true);
  });

  it("blocks malformed versions (fail-closed)", () => {
    expect(isDaemonVersionSupported("v0.6.0", "0.6.0")).toBe(false);
    expect(isDaemonVersionSupported("0.6", "0.6.0")).toBe(false);
    expect(isDaemonVersionSupported("garbage", "0.6.0")).toBe(false);
  });

  it("MIN_DAEMON_VERSION is itself parseable + supported against itself", () => {
    expect(isDaemonVersionSupported(MIN_DAEMON_VERSION, MIN_DAEMON_VERSION))
      .toBe(true);
  });
});
