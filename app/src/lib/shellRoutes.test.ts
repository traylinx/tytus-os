import { describe, expect, it } from "vitest";
import { shellTargetForHash } from "@/lib/shellRoutes";

describe("shellTargetForHash", () => {
  it("maps bare legacy tray routes to apps", () => {
    expect(shellTargetForHash("#chat")).toMatchObject({ appId: "chat" });
    expect(shellTargetForHash("#files")).toMatchObject({ appId: "filemanager" });
    expect(shellTargetForHash("#channels")).toMatchObject({ appId: "channels" });
    // Plain `#help` opens the Help app on its default doc — the app
    // resolves the first user-manual entry from the registry, no
    // explicit tab forced from the router.
    expect(shellTargetForHash("#help")).toMatchObject({ appId: "help" });
  });

  it("maps /help/<tab> to a Help-app deep link", () => {
    // Diagnostic ids stay literal.
    expect(shellTargetForHash("#/help/doctor?n=1")).toEqual({
      appId: "help",
      args: {
        routeNonce: "1",
        help: { tab: "doctor" },
      },
    });
    expect(shellTargetForHash("#/help/logs")).toEqual({
      appId: "help",
      args: {
        routeNonce: undefined,
        help: { tab: "logs" },
      },
    });
    // Anything else is treated as a user-manual slug, surfaced as
    // `docs:<slug>` so the Help app resolves it in the registry.
    expect(shellTargetForHash("#/help/keyboard-shortcuts")).toEqual({
      appId: "help",
      args: {
        routeNonce: undefined,
        help: { tab: "docs:keyboard-shortcuts" },
      },
    });
    expect(shellTargetForHash("#/help/getting-started?n=42")).toEqual({
      appId: "help",
      args: {
        routeNonce: "42",
        help: { tab: "docs:getting-started" },
      },
    });
    // Bare `/help` (no tab) → Help app, registry default doc.
    expect(shellTargetForHash("#/help")).toEqual({
      appId: "help",
      args: {
        routeNonce: undefined,
        help: undefined,
      },
    });
  });

  it("maps settings routes to Settings", () => {
    expect(shellTargetForHash("#/settings/agents?install=auto")).toMatchObject({
      appId: "settings",
    });
  });

  it("maps run doctor/test/catalog routes to Help autorun args", () => {
    expect(shellTargetForHash("#/run/doctor?n=1")).toEqual({
      appId: "help",
      args: {
        routeNonce: "1",
        help: { tab: "doctor", autoRun: true },
      },
    });
    expect(shellTargetForHash("#/run/test?n=2")).toEqual({
      appId: "help",
      args: {
        routeNonce: "2",
        help: { tab: "test", autoRun: true },
      },
    });
    expect(shellTargetForHash("#/run/channels-catalog?n=3")).toEqual({
      appId: "help",
      args: {
        routeNonce: "3",
        help: { tab: "channels-catalog", autoRun: true },
      },
    });
  });

  it("maps pod inspector action routes", () => {
    expect(shellTargetForHash("#/pod/02/restart?n=1")).toEqual({
      appId: "pod-inspector",
      args: {
        routeNonce: "1",
        podId: "02",
        podAction: {
          podId: "02",
          action: "restart",
          params: { n: "1" },
        },
      },
    });
  });

  it("maps pod channels and files routes", () => {
    expect(
      shellTargetForHash("#/pod/02/channels?action=add&type=telegram&n=1"),
    ).toEqual({
      appId: "channels",
      args: {
        routeNonce: "1",
        podId: "02",
        channels: {
          podId: "02",
          action: "add",
          type: "telegram",
        },
      },
    });

    expect(shellTargetForHash("#/pod/02/files?n=1")).toEqual({
      appId: "filemanager",
      args: {
        routeNonce: "1",
        podId: "02",
        files: {
          podId: "02",
        },
      },
    });
  });

  it("ignores unsupported routes", () => {
    expect(shellTargetForHash("#/run/unknown?n=1")).toBeNull();
    expect(shellTargetForHash("#/pod/02/teleport?n=1")).toBeNull();
    expect(shellTargetForHash("#/martian/walk")).toBeNull();
  });
});
