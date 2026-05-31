import { describe, expect, it } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import ZeroPodsOverlay from "@/components/ZeroPodsOverlay";
import { OSProvider, useOS } from "@/hooks/useOSStore";
import { DaemonClientProvider } from "@/hooks/useDaemonClient";
import { DaemonStateProvider } from "@/hooks/useDaemonStateContext";
import { createDaemonClient } from "@/lib/daemon";
import { makeFakeFetch } from "@/test/fakeFetch";
import { stateFixture } from "@/test/fixtures";
import type { FC, ReactNode } from "react";
import { useEffect } from "react";
import { I18nProvider } from "@/i18n";

// Manifest §2.4 — the desktop overlay is the entry point for users
// who land in Tytus OS without any allocated pods. Gating logic is
// safety-critical: if we render it when shouldn't, we block working
// users; if we don't render it when we should, the new-user flow has
// no obvious next step.

const stateWithZeroAgents = {
  ...stateFixture,
  agents: [],
};

const stateWithZeroAgentsNoGateway = {
  ...stateWithZeroAgents,
  included: [],
  units_used: 0,
};

const stateWithZeroAgentsNeedsTunnel = {
  ...stateWithZeroAgents,
  connected: true,
  tunnel_active: false,
};

interface HarnessProps {
  children: ReactNode;
  state?: typeof stateFixture;
  authenticated?: boolean;
}

const Authenticate: FC<{ authenticated: boolean; children: ReactNode }> = ({
  authenticated,
  children,
}) => {
  const { state, dispatch } = useOS();
  useEffect(() => {
    if (authenticated && !state.auth.isAuthenticated) {
      dispatch({ type: "LOGIN", isGuest: false });
    }
  }, [authenticated, state.auth.isAuthenticated, dispatch]);
  return <>{children}</>;
};

const Harness: FC<HarnessProps> = ({
  children,
  state = stateFixture,
  authenticated = true,
}) => {
  const { fetch } = makeFakeFetch([
    { method: "GET", path: "/api/state", body: state },
  ]);
  const client = createDaemonClient({ fetch });
  return (
    <I18nProvider>
      <DaemonClientProvider client={client}>
        <DaemonStateProvider intervalMs={60_000}>
          <OSProvider>
            <Authenticate authenticated={authenticated}>{children}</Authenticate>
          </OSProvider>
        </DaemonStateProvider>
      </DaemonClientProvider>
    </I18nProvider>
  );
};

describe("ZeroPodsOverlay", () => {
  it("renders when logged in and state.agents is empty", async () => {
    render(
      <Harness state={stateWithZeroAgentsNoGateway}>
        <ZeroPodsOverlay />
      </Harness>,
    );
    expect(
      await screen.findByText(/Welcome to Tytus/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Allocate your first pod/i }),
    ).toBeTruthy();
  });

  it("does NOT render when state.agents is non-empty", async () => {
    render(
      <Harness state={stateFixture}>
        <ZeroPodsOverlay />
      </Harness>,
    );
    // Wait a tick for the daemon-state poll to land, then assert
    // overlay still hidden.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByText(/Welcome to Tytus/)).toBeNull();
  });

  it("does NOT render when not authenticated", async () => {
    render(
      <Harness state={stateWithZeroAgentsNoGateway} authenticated={false}>
        <ZeroPodsOverlay />
      </Harness>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByText(/Welcome to Tytus/)).toBeNull();
  });

  it("Allocate CTA navigates to #/settings/agents?install=auto", async () => {
    render(
      <Harness state={stateWithZeroAgentsNoGateway}>
        <ZeroPodsOverlay />
      </Harness>,
    );
    await screen.findByText(/Welcome to Tytus/);

    const cta = screen.getByRole("button", {
      name: /Allocate your first pod/i,
    });
    act(() => fireEvent.click(cta));

    // navigate() writes to location.hash; happy-dom honors it.
    await waitFor(() => {
      expect(location.hash).toMatch(/^#\/settings\/agents/);
      expect(location.hash).toContain("install=auto");
    });
  });

  it("renders tier + units pill when daemon state has plan info", async () => {
    render(
      <Harness state={stateWithZeroAgentsNoGateway}>
        <ZeroPodsOverlay />
      </Harness>,
    );
    await screen.findByText(/Welcome to Tytus/);
    // stateFixture has tier='operator', units_limit=4
    expect(screen.getByText(/Operator tier/)).toBeTruthy();
    expect(screen.getByText(/4 units available/)).toBeTruthy();
  });

  it("renders connected gateway copy when only the included AIL gateway exists", async () => {
    render(
      <Harness state={stateWithZeroAgents}>
        <ZeroPodsOverlay />
      </Harness>,
    );
    expect(await screen.findByText(/Tytus is connected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open Pods/i })).toBeTruthy();
  });

  it("renders connect CTA when included gateway exists but tunnel is down", async () => {
    render(
      <Harness state={stateWithZeroAgentsNeedsTunnel}>
        <ZeroPodsOverlay />
      </Harness>,
    );
    expect(await screen.findByText(/Connect Tytus to your pod/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connect Tytus/i })).toBeTruthy();
  });
});
