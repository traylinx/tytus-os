import { describe, expect, it } from "vitest";
import { computePill, isRefreshTokenExpired } from "@/lib/statusPill";
import { stateFixture } from "@/test/fixtures";
import { asSecret } from "@/lib/secrets";
import type { StateSnapshot } from "@/types/daemon";

const wrapState = (
  raw: Omit<typeof stateFixture, "last_refresh_error"> & {
    last_refresh_error: string | null;
  },
): StateSnapshot =>
  ({
    ...raw,
    agents: raw.agents.map((a) => ({
      ...a,
      user_key: asSecret(a.user_key),
      ui_url: asSecret(a.ui_url),
    })),
    included: raw.included.map((p) => ({
      ...p,
      user_key: asSecret(p.user_key),
    })),
  }) as unknown as StateSnapshot;

describe("computePill", () => {
  it("gray while loading", () => {
    expect(computePill("loading", null, null).color).toBe("gray");
  });

  it("red when offline", () => {
    const r = computePill("offline", null, {
      code: "daemon_offline",
      message: "ECONNREFUSED",
    });
    expect(r.color).toBe("red");
    expect(r.label).toBe("Offline");
  });

  it("red when daemon_running is false", () => {
    const s = wrapState({ ...stateFixture, daemon_running: false });
    expect(computePill("online", s, null).color).toBe("red");
  });

  it("green when all healthy", () => {
    const s = wrapState(stateFixture);
    expect(computePill("online", s, null).color).toBe("green");
  });

  it("yellow when tunnel inactive", () => {
    const s = wrapState({ ...stateFixture, tunnel_active: false });
    const r = computePill("online", s, null);
    expect(r.color).toBe("yellow");
    expect(r.detail).toContain("tunnel down");
  });

  it("yellow when keychain unhealthy", () => {
    const s = wrapState({ ...stateFixture, keychain_healthy: false });
    expect(computePill("online", s, null).color).toBe("yellow");
  });

  it("yellow when last_refresh_error is set", () => {
    const s = wrapState({
      ...stateFixture,
      last_refresh_error: "401 from sentinel",
    });
    const r = computePill("online", s, null);
    expect(r.color).toBe("yellow");
    expect(r.detail).toContain("refresh error");
  });

  it("uses explicit session-expired copy for expired refresh tokens when logged out", () => {
    const s = wrapState({
      ...stateFixture,
      logged_in: false,
      last_refresh_error: "refresh token expired — run `tytus login`",
    });
    const r = computePill("auth_required", s, null);
    expect(r.color).toBe("yellow");
    expect(r.label).toBe("Session expired");
    expect(r.kind).toBe("session-expired");
    expect(r.detail).toContain("Sign in again");
  });

  it("ignores stale login-required refresh errors after successful login", () => {
    const s = wrapState({
      ...stateFixture,
      logged_in: true,
      last_refresh_error: "refresh token expired — run `tytus login`",
    });
    const r = computePill("online", s, null);
    expect(r.color).toBe("green");
    expect(r.label).toBe("Connected");
    expect(r.kind).toBeUndefined();
  });

  it("classifies refresh-token login hints", () => {
    expect(isRefreshTokenExpired("refresh token expired — run `tytus login`")).toBe(
      true,
    );
    expect(isRefreshTokenExpired("No refresh token available — run 'tytus login'")).toBe(
      true,
    );
    expect(isRefreshTokenExpired("transient refresh error: 502")).toBe(false);
  });
});
