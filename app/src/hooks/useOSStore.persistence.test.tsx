import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const persistedJuli3taWindow = {
  id: "win-juli3ta",
  appId: "juli3ta",
  title: "JULI3TA",
  position: { x: 120, y: 80 },
  size: { width: 900, height: 700 },
  state: "normal",
  icon: "Juli3taIcon",
};

const persistedLegacyWorkspaceWindow = {
  id: "win-forge",
  appId: "forge",
  title: "Tytus Forge",
  position: { x: 80, y: 60 },
  size: { width: 1000, height: 700 },
  state: "normal",
  icon: "Sparkles",
};

describe("useOSStore window persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("restores installed-app windows before the async registry cache hydrates", async () => {
    localStorage.setItem("tytus_windows", JSON.stringify([persistedJuli3taWindow]));

    const { OSProvider, useOS } = await import("./useOSStore");
    let latest: unknown = null;

    const Probe = () => {
      latest = useOS().state;
      return <div>probe</div>;
    };

    render(
      <OSProvider>
        <Probe />
      </OSProvider>,
    );

    await waitFor(() => {
      const state = latest as { windows: Array<{ appId: string }> } | null;
      expect(state?.windows.map((w) => w.appId)).toContain("juli3ta");
    });
    const state = latest as { dockItems: Array<{ appId: string; isOpen: boolean }> } | null;
    expect(state?.dockItems.find((d) => d.appId === "juli3ta")?.isOpen).toBe(true);
  });

  it("keeps installed-app windows in localStorage on the initial persistence pass", async () => {
    localStorage.setItem("tytus_windows", JSON.stringify([persistedJuli3taWindow]));

    const { OSProvider, useOS } = await import("./useOSStore");

    const Probe = () => {
      useOS();
      return <div>probe</div>;
    };

    render(
      <OSProvider>
        <Probe />
      </OSProvider>,
    );

    await waitFor(
      () => {
        const stored = JSON.parse(localStorage.getItem("tytus_windows") ?? "[]") as Array<{ appId: string }>;
        expect(stored.map((w) => w.appId)).toContain("juli3ta");
      },
      { timeout: 1_000 },
    );
  });

  it("loads default Dock pins in product order", async () => {
    const { OSProvider, useOS } = await import("./useOSStore");
    let latest: unknown = null;

    const Probe = () => {
      latest = useOS().state;
      return <div>probe</div>;
    };

    render(
      <OSProvider>
        <Probe />
      </OSProvider>,
    );

    await waitFor(() => {
      const state = latest as { dockItems: Array<{ appId: string; isPinned: boolean }> } | null;
      expect(state?.dockItems.filter((d) => d.isPinned).map((d) => d.appId)).toEqual([
        "atomek",
        "juli3ta",
        "pod-inspector",
        "settings",
        "chat",
        "filemanager",
        "channels",
        "terminal",
      ]);
    });
  });

  it("migrates existing Dock pins to include JULI3TA once", async () => {
    localStorage.setItem(
      "tytus_dock_pins",
      JSON.stringify(["atomek", "pod-inspector", "settings", "chat", "filemanager", "channels", "terminal"]),
    );

    const { OSProvider, useOS } = await import("./useOSStore");
    let latest: unknown = null;

    const Probe = () => {
      latest = useOS().state;
      return <div>probe</div>;
    };

    render(
      <OSProvider>
        <Probe />
      </OSProvider>,
    );

    await waitFor(() => {
      const state = latest as { dockItems: Array<{ appId: string; isPinned: boolean }> } | null;
      expect(state?.dockItems.filter((d) => d.isPinned).map((d) => d.appId)).toEqual([
        "atomek",
        "juli3ta",
        "pod-inspector",
        "settings",
        "chat",
        "filemanager",
        "channels",
        "terminal",
      ]);
    });

    expect(JSON.parse(localStorage.getItem("tytus_dock_pins") ?? "[]")).toEqual([
      "atomek",
      "juli3ta",
      "pod-inspector",
      "settings",
      "chat",
      "filemanager",
      "channels",
      "terminal",
    ]);
    expect(localStorage.getItem("tytus_dock_defaults_migrated_v2026_05_juli3ta")).toBe("1");
  });

  it("rewrites legacy workspace windows to the canonical app id on restore", async () => {
    localStorage.setItem("tytus_windows", JSON.stringify([persistedLegacyWorkspaceWindow]));

    const { OSProvider, useOS } = await import("./useOSStore");
    let latest: unknown = null;

    const Probe = () => {
      latest = useOS().state;
      return <div>probe</div>;
    };

    render(
      <OSProvider>
        <Probe />
      </OSProvider>,
    );

    await waitFor(() => {
      const state = latest as { windows: Array<{ appId: string; title: string }> } | null;
      expect(state?.windows).toEqual([
        expect.objectContaining({ appId: "atomek", title: "Atomek" }),
      ]);
    });

    const state = latest as { dockItems: Array<{ appId: string; isOpen: boolean }> } | null;
    expect(state?.dockItems.find((d) => d.appId === "atomek")?.isOpen).toBe(true);
  });

  it("restores and persists Dock position, size, auto-hide, and order", async () => {
    localStorage.setItem(
      "tytus_theme",
      JSON.stringify({
        mode: "light",
        accent: "#ff00aa",
        wallpaper: "tytus-default",
        dock: {
          position: "left",
          size: "large",
          autoHide: true,
          order: ["terminal", "chat"],
        },
      }),
    );

    const { OSProvider, useOS } = await import("./useOSStore");
    let latest: unknown = null;

    const Probe = () => {
      const { state, dispatch } = useOS();
      latest = state;
      return (
        <button
          onClick={() =>
            dispatch({
              type: "SET_THEME",
              theme: {
                dock: {
                  ...state.theme.dock,
                  position: "right",
                  order: ["chat", "terminal"],
                },
              },
            })
          }
        >
          change dock
        </button>
      );
    };

    const { getByText } = render(
      <OSProvider>
        <Probe />
      </OSProvider>,
    );

    await waitFor(() => {
      const state = latest as { theme: { dock: { position: string; size: string; autoHide: boolean; order: string[] } } } | null;
      expect(state?.theme.dock).toEqual({
        position: "left",
        size: "large",
        autoHide: true,
        order: ["terminal", "chat"],
      });
    });

    getByText("change dock").click();

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("tytus_theme") ?? "{}") as {
        dock?: { position?: string; order?: string[] };
      };
      expect(stored.dock?.position).toBe("right");
      expect(stored.dock?.order).toEqual(["chat", "terminal"]);
    });
  });

  it("restores and persists user Dock pins", async () => {
    localStorage.setItem("tytus_dock_pins", JSON.stringify(["browser"]));

    const { OSProvider, useOS } = await import("./useOSStore");
    let latest: unknown = null;

    const Probe = () => {
      const { state, dispatch } = useOS();
      latest = state;
      return (
        <button onClick={() => dispatch({ type: "PIN_DOCK_ITEM", appId: "terminal" })}>
          pin terminal
        </button>
      );
    };

    const { getByText } = render(
      <OSProvider>
        <Probe />
      </OSProvider>,
    );

    await waitFor(() => {
      const state = latest as { dockItems: Array<{ appId: string; isPinned: boolean }> } | null;
      expect(state?.dockItems.find((d) => d.appId === "browser")?.isPinned).toBe(true);
      expect(state?.dockItems.find((d) => d.appId === "juli3ta")?.isPinned).toBe(true);
      expect(state?.dockItems.find((d) => d.appId === "terminal")?.isPinned).toBe(false);
    });

    getByText("pin terminal").click();

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("tytus_dock_pins") ?? "[]") as string[];
      expect(stored).toContain("browser");
      expect(stored).toContain("juli3ta");
      expect(stored).toContain("terminal");
    });
  });
});
