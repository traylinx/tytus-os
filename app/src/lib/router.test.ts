import { describe, expect, it } from "vitest";
import {
  buildHash,
  navigate,
  parseHash,
  sameRoute,
  type Route,
} from "@/lib/router";

describe("parseHash", () => {
  it("returns home for empty hash", () => {
    expect(parseHash("").kind).toBe("home");
    expect(parseHash("#").kind).toBe("home");
    expect(parseHash("#/").kind).toBe("home");
  });

  it("parses /run/<action>", () => {
    const r = parseHash("#/run/doctor");
    expect(r.kind).toBe("run");
    if (r.kind !== "run") return;
    expect(r.action).toBe("doctor");
  });

  it("parses /pod/<id>/<action> with nonce preserved", () => {
    const r = parseHash("#/pod/02/restart?n=abc123&confirm=1");
    expect(r.kind).toBe("pod");
    if (r.kind !== "pod") return;
    expect(r.podId).toBe("02");
    expect(r.action).toBe("restart");
    expect(r.params.get("n")).toBe("abc123");
    expect(r.params.get("confirm")).toBe("1");
  });

  it("parses /pod/<id> as overview", () => {
    const r = parseHash("#/pod/02");
    expect(r.kind).toBe("pod");
    if (r.kind !== "pod") return;
    expect(r.podId).toBe("02");
    expect(r.action).toBe("overview");
  });

  it("parses /settings root", () => {
    const r = parseHash("#/settings");
    expect(r.kind).toBe("settings");
    if (r.kind !== "settings") return;
    expect(r.section).toBeNull();
  });

  it("parses /settings/<section>", () => {
    const r = parseHash("#/settings/daemon");
    expect(r.kind).toBe("settings");
    if (r.kind !== "settings") return;
    expect(r.section).toBe("daemon");
  });

  it("returns unknown for unrecognised paths", () => {
    const r = parseHash("#/martian/walk");
    expect(r.kind).toBe("unknown");
  });
});

describe("buildHash", () => {
  it("strips inbound nonce by default", () => {
    const r = parseHash("#/run/doctor?n=xxx&extra=1");
    expect(buildHash(r)).toBe("#/run/doctor?extra=1");
  });

  it("re-adds explicit nonce", () => {
    const r: Route = {
      kind: "run",
      action: "doctor",
      params: new URLSearchParams(),
    };
    expect(buildHash(r, { nonce: "abc" })).toBe("#/run/doctor?n=abc");
  });

  it("home route renders as #/", () => {
    expect(buildHash({ kind: "home" })).toBe("#/");
  });
});

describe("sameRoute", () => {
  it("matches same kind + path even with different params", () => {
    const a = parseHash("#/pod/02/restart?n=1");
    const b = parseHash("#/pod/02/restart?n=2");
    expect(sameRoute(a, b)).toBe(true);
  });

  it("rejects different actions", () => {
    const a = parseHash("#/pod/02/restart");
    const b = parseHash("#/pod/02/uninstall");
    expect(sameRoute(a, b)).toBe(false);
  });
});

describe("navigate", () => {
  const fakeLocation = (initial: string) => {
    const loc = { hash: initial } as Location;
    return loc;
  };

  it("strips nonce when route differs from current", () => {
    const loc = fakeLocation("#/run/doctor?n=oldNonce");
    navigate(
      { kind: "run", action: "test", params: new URLSearchParams() },
      { location: loc },
    );
    expect(loc.hash).toBe("#/run/test");
  });

  it("appends fresh nonce when target matches current — A4 nonce preservation", () => {
    const loc = fakeLocation("#/pod/02/restart?n=oldNonce");
    navigate(
      {
        kind: "pod",
        podId: "02",
        action: "restart",
        params: new URLSearchParams(),
      },
      { location: loc },
    );
    expect(loc.hash).toMatch(/^#\/pod\/02\/restart\?n=/);
    expect(loc.hash).not.toBe("#/pod/02/restart?n=oldNonce");
  });

  it("forceFire appends nonce even when route differs", () => {
    const loc = fakeLocation("#/run/doctor");
    navigate(
      { kind: "run", action: "test", params: new URLSearchParams() },
      { location: loc, forceFire: true },
    );
    expect(loc.hash).toMatch(/^#\/run\/test\?n=/);
  });
});
