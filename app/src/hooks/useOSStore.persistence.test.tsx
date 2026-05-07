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
});
