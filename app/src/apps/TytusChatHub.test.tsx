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

// Named agents are DM-able chat personas; an agent with no display_name is
// the pod's base/proxy entry (routes to the raw SwitchAILocal gateway) and
// must NOT appear in the teammate roster.
const agent = (over: Record<string, unknown>) => ({
  agent_type: "nemoclaw",
  api_url: "https://x/v1",
  public_url: "https://x",
  ui_url: "https://x/?token=REDACTED",
  units: 1,
  user_key: "sk-tytus-user-REDACTED",
  ...over,
});
const stateNamedAgents = {
  ...stateFixture,
  agents: [
    agent({ pod_id: "02", display_name: "Lisa", display_label: "Lisa", route_id: "r-lisa" }),
    agent({ pod_id: "04", agent_type: "hermes", display_name: "Hermie", display_label: "Hermie", route_id: "r-hermie" }),
    // Unnamed base/proxy entry — must be filtered out of the roster.
    agent({ pod_id: "04", display_name: null, display_label: "Pod 04", route_id: "r-base" }),
  ],
} as unknown as typeof stateFixture;

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
  it("renders the hero, named teammates, and configured channels (excludes the unnamed proxy pod)", async () => {
    render(
      <Harness
        state={stateNamedAgents}
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
    // Named teammates appear…
    expect(await screen.findByText("Lisa")).toBeTruthy();
    expect(screen.getByText("Hermie")).toBeTruthy();
    // …but the unnamed base/proxy entry ("Pod 04") is filtered out.
    expect(screen.queryByText("Pod 04")).toBeNull();
    // Configured channel surfaced (union across pods)
    expect(await screen.findByText("Telegram")).toBeTruthy();
    expect(screen.getByTestId("tytus-chat-hub-manage-channels")).toBeTruthy();
  });

  it("keeps a lone unnamed pod visible (real agent, not a proxy) and surfaces its channels", async () => {
    // An unnamed agent is only the redundant base/proxy when a named sibling
    // shares its pod. A pod whose ONLY agent is unnamed is a real allocated
    // agent ("Pod NN") — default daemon states omit display_name — so it must
    // stay in the roster, and its per-pod channels must surface.
    const stateLoneUnnamed = {
      ...stateFixture,
      agents: [agent({ pod_id: "02", display_name: null, display_label: "Pod 02", route_id: "r-base" })],
    } as unknown as typeof stateFixture;
    render(
      <Harness
        state={stateLoneUnnamed}
        extraRoutes={[channelRoute("02", [{ name: "telegram", label: "Telegram", secret_count: 1 }])]}
      >
        <TytusChatHub />
      </Harness>,
    );
    // The lone unnamed pod stays visible as "Pod 02"…
    expect(await screen.findByText("Pod 02")).toBeTruthy();
    expect(screen.getByTestId("tytus-chat-hub-pod")).toBeTruthy();
    // …and its configured channel surfaces.
    expect(await screen.findByText("Telegram")).toBeTruthy();
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
