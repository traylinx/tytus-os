import { describe, expect, it } from "vitest";
import { shellTargetForHash } from "@/lib/shellRoutes";

describe("shellTargetForHash", () => {
  it("maps bare legacy tray routes to apps", () => {
    expect(shellTargetForHash("#chat")).toMatchObject({ appId: "chat" });
    expect(shellTargetForHash("#files")).toMatchObject({ appId: "filemanager" });
    expect(shellTargetForHash("#channels")).toMatchObject({ appId: "channels" });
    expect(shellTargetForHash("#help")).toMatchObject({
      appId: "help",
      args: { help: { tab: "doctor" } },
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
