import { parseHash, type Route } from "@/lib/router";
import type { WindowArgs } from "@/types";

export interface ShellWindowTarget {
  appId: string;
  args?: WindowArgs;
}

const paramsToRecord = (params: URLSearchParams): Record<string, string> => {
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
};

const routeNonce = (route: Extract<Route, { params: URLSearchParams }>) =>
  route.params.get("n") ?? undefined;

const channelAction = (value: string | null): "add" | "remove" | undefined => {
  if (value === "add" || value === "remove") return value;
  return undefined;
};

export const shellTargetForRoute = (route: Route): ShellWindowTarget | null => {
  switch (route.kind) {
    case "home":
      return null;

    case "run": {
      if (
        route.action !== "doctor" &&
        route.action !== "test" &&
        route.action !== "channels-catalog"
      ) {
        return null;
      }
      return {
        appId: "help",
        args: {
          routeNonce: routeNonce(route),
          help: {
            tab: route.action,
            autoRun: true,
          },
        },
      };
    }

    case "pod": {
      if (route.action === "channels") {
        return {
          appId: "channels",
          args: {
            routeNonce: routeNonce(route),
            podId: route.podId,
            channels: {
              podId: route.podId,
              action: channelAction(route.params.get("action")),
              type: route.params.get("type") ?? undefined,
            },
          },
        };
      }

      if (route.action === "files") {
        return {
          appId: "filemanager",
          args: {
            routeNonce: routeNonce(route),
            podId: route.podId,
            files: {
              podId: route.podId,
            },
          },
        };
      }

      if (
        route.action !== "overview" &&
        route.action !== "output" &&
        route.action !== "restart" &&
        route.action !== "revoke" &&
        route.action !== "uninstall" &&
        route.action !== "stop-forwarder"
      ) {
        return null;
      }

      return {
        appId: "pod-inspector",
        args: {
          routeNonce: routeNonce(route),
          podId: route.podId,
          podAction: {
            podId: route.podId,
            action: route.action,
            params: paramsToRecord(route.params),
          },
        },
      };
    }

    case "settings":
      return {
        appId: "settings",
        args: {
          routeNonce: routeNonce(route),
        },
      };

    case "unknown": {
      const legacy: Record<string, ShellWindowTarget> = {
        chat: { appId: "chat" },
        files: { appId: "filemanager" },
        channels: { appId: "channels" },
        help: { appId: "help", args: { help: { tab: "doctor" } } },
      };
      return legacy[route.raw] ?? null;
    }
  }
};

export const shellTargetForHash = (hash: string): ShellWindowTarget | null =>
  shellTargetForRoute(parseHash(hash));
