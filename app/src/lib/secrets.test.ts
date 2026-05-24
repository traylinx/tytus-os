import { describe, expect, it } from "vitest";
import type { Secret } from "@/types/daemon";
import {
  asSecret,
  maskSecret,
  maskTokenUrl,
  revealSecret,
  revealTokenUrl,
} from "./secrets";

// The daemon emits `null` for optional URL fields (e.g. an agent's
// `ui_url` when there is no UI route). Settings → Pods crashed on
// 2026-05-24 because `maskTokenUrl(null)` called `.replace` on
// `null._value`, blanking the whole panel. These tests pin the
// null-safe contract so that regression cannot return.

describe("secrets helpers — null/undefined safety", () => {
  it("maskSecret returns a dash placeholder for null", () => {
    expect(maskSecret(null)).toBe("—");
    expect(maskSecret(undefined)).toBe("—");
  });

  it("revealSecret returns empty string for null", () => {
    expect(revealSecret(null, "user_gesture")).toBe("");
    expect(revealSecret(undefined, "user_gesture")).toBe("");
  });

  it("maskTokenUrl returns a dash placeholder for null", () => {
    expect(maskTokenUrl(null)).toBe("—");
    expect(maskTokenUrl(undefined)).toBe("—");
  });

  it("revealTokenUrl returns empty string for null", () => {
    expect(revealTokenUrl(null, "user_gesture")).toBe("");
    expect(revealTokenUrl(undefined, "user_gesture")).toBe("");
  });
});

describe("secrets helpers — happy path", () => {
  it("maskSecret masks long values keeping last 4", () => {
    const s = asSecret("sk-tytus-user-0123456789abcdef");
    expect(maskSecret(s)).toBe("●●●●…cdef");
  });

  it("maskSecret fully masks short values", () => {
    const s = asSecret("ab");
    expect(maskSecret(s)).toBe("●●●●");
  });

  it("revealSecret returns the raw value with user_gesture token", () => {
    const s = asSecret("plain-text");
    expect(revealSecret(s, "user_gesture")).toBe("plain-text");
  });

  it("maskTokenUrl replaces ?token= and &token= segments", () => {
    const u = asSecret("https://x.example/ui?token=abcd1234&foo=1") as Secret;
    expect(maskTokenUrl(u)).toBe(
      "https://x.example/ui?token=●●●●&foo=1",
    );
    const u2 = asSecret("https://x.example/ui?a=1&token=zzz");
    expect(maskTokenUrl(u2)).toBe("https://x.example/ui?a=1&token=●●●●");
  });

  it("maskTokenUrl is idempotent for non-token URLs", () => {
    const u = asSecret("https://x.example/health");
    expect(maskTokenUrl(u)).toBe("https://x.example/health");
  });

  it("revealTokenUrl returns the URL unchanged", () => {
    const u = asSecret("https://x.example/ui?token=abc");
    expect(revealTokenUrl(u, "user_gesture")).toBe(
      "https://x.example/ui?token=abc",
    );
  });
});
