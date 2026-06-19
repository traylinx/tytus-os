import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import TytusChatHub from "@/apps/TytusChatHub";
import { OSProvider, useOS } from "@/hooks/useOSStore";
import { DaemonClientProvider } from "@/hooks/useDaemonClient";
import { DaemonStateProvider } from "@/hooks/useDaemonStateContext";
import { createDaemonClient } from "@/lib/daemon";
import { makeFakeFetch, type RouteSpec } from "@/test/fakeFetch";
import { stateFixture } from "@/test/fixtures";
import { TYTUS_CHAT_URL } from "@/lib/tytusChat";
import type { FC, ReactNode } from "react";
import { useEffect } from "react";
import { I18nProvider } from "@/i18n";

// TytusChatHub replaces the old pod-chat surface: an info board that
// points at Tytus Chat (web), lists pods as teammates, and surfaces
// configured channels. It must NOT send messages — only inform + link.

const stateZeroAgents = { ...stateFixture, agents: [] };

const channelRoute = (pod: string, configured: unknown[]): RouteSpec => ({
  method: "GET",
  path: `/api/channels?pod=${pod}`,
  body: { pod_id: pod, available: [], configured },
});

const Authenticate: FC<{ children: ReactNode }> = ({ children }) => {
  const { state, dispatch } = useOS();
  useEffect(() => {
    if (!state.auth.isAuthenticated) dispatch({ type: "LOGIN", isGuest: false });
  }, [state.auth.isAuthenticated, dispatch]);
  return <>{children}</>;
};

const Harness: FC<{
  children: ReactNode;
  state?: typeof stateFixture;
  extraRoutes?: RouteSpec[];
}> = ({ children, state = stateFixture, extraRoutes = [] }) => {
  const { fetch } = makeFakeFetch(
    [{ method: "GET", path: "/api/state", body: state }, ...extraRoutes],
    // Any un-mocked channel fetch falls back to "no channels".
    { status: 200, body: { pod_id: "x", available: [], configured: [] } },
  );
  const client = createDaemonClient({ fetch });
  return (
    <I18nProvider>
      <DaemonClientProvider client={client}>
        <DaemonStateProvider intervalMs={60_000}>
          <OSProvider>
            <Authenticate>{children}</Authenticate>
          </OSProvider>
        </DaemonStateProvider>
      </DaemonClientProvider>
    </I18nProvider>
  );
};

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
};

afterEach(() => vi.restoreAllMocks());

describe("TytusChatHub", () => {
  it("renders the hero, pods, and configured channels", async () => {
    render(
      <Harness
        extraRoutes={[
          channelRoute("02", [{ name: "telegram", label: "Telegram", secret_count: 1 }]),
          channelRoute("04", []),
        ]}
      >
        <TytusChatHub />
      </Harness>,
    );
    // Hero + CTA
    expect(await screen.findByTestId("tytus-chat-hub-open")).toBeTruthy();
    // Pods listed as teammates (fixture has pods 02 + 04, no display names)
    expect(await screen.findByText("Pod 02")).toBeTruthy();
    expect(screen.getByText("Pod 04")).toBeTruthy();
    // Configured channel surfaced (union across pods)
    expect(await screen.findByText("Telegram")).toBeTruthy();
    expect(screen.getByTestId("tytus-chat-hub-manage-channels")).toBeTruthy();
  });

  it("Open Tytus Chat opens the chat URL in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <Harness>
        <TytusChatHub />
      </Harness>,
    );
    const cta = await screen.findByTestId("tytus-chat-hub-open");
    act(() => fireEvent.click(cta));
    expect(open).toHaveBeenCalledWith(TYTUS_CHAT_URL, "_blank", "noopener,noreferrer");
  });

  it("shows empty states (allocate a pod / connect a channel) with zero pods", async () => {
    render(
      <Harness state={stateZeroAgents}>
        <TytusChatHub />
      </Harness>,
    );
    await settle();
    expect(screen.getByTestId("tytus-chat-hub-pods-empty")).toBeTruthy();
    expect(screen.getByTestId("tytus-chat-hub-channels-empty")).toBeTruthy();
    // No teammate rows when there are no pods.
    expect(screen.queryByTestId("tytus-chat-hub-pod")).toBeNull();
  });
});
