import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import TytusChatCard, { TYTUS_CHAT_URL } from "@/components/TytusChatCard";
import { OSProvider, useOS } from "@/hooks/useOSStore";
import { DaemonClientProvider } from "@/hooks/useDaemonClient";
import { DaemonStateProvider } from "@/hooks/useDaemonStateContext";
import { createDaemonClient } from "@/lib/daemon";
import { makeFakeFetch } from "@/test/fakeFetch";
import { stateFixture } from "@/test/fixtures";
import type { FC, ReactNode } from "react";
import { useEffect } from "react";
import { I18nProvider } from "@/i18n";

// Open Doors P5 — the inverse gate of ZeroPodsOverlay: users WITH pods
// get pointed at Tytus Chat (their pods as DM-able teammates) exactly
// once. Gating matters both ways: zero-pod users must never see it
// (ZeroPodsOverlay owns them), and dismissal must stick.

const stateWithZeroAgents = {
  ...stateFixture,
  agents: [],
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

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

describe("TytusChatCard", () => {
  beforeEach(() => {
    window.localStorage.removeItem("tytus.chat-card.dismissed");
  });
  afterEach(() => {
    window.localStorage.removeItem("tytus.chat-card.dismissed");
    vi.restoreAllMocks();
  });

  it("renders for an authenticated user with ≥1 pod", async () => {
    render(
      <Harness>
        <TytusChatCard />
      </Harness>,
    );
    expect(await screen.findByText(/Meet your agents in Tytus Chat/)).toBeTruthy();
  });

  it("does NOT render with zero pods (ZeroPodsOverlay owns that user)", async () => {
    render(
      <Harness state={stateWithZeroAgents}>
        <TytusChatCard />
      </Harness>,
    );
    await settle();
    expect(screen.queryByTestId("tytus-chat-card")).toBeNull();
  });

  it("does NOT render when unauthenticated", async () => {
    render(
      <Harness authenticated={false}>
        <TytusChatCard />
      </Harness>,
    );
    await settle();
    expect(screen.queryByTestId("tytus-chat-card")).toBeNull();
  });

  it("Open Tytus Chat opens the chat URL in a new tab and dismisses the card", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <Harness>
        <TytusChatCard />
      </Harness>,
    );
    const cta = await screen.findByRole("button", { name: /Open Tytus Chat/i });
    act(() => {
      fireEvent.click(cta);
    });
    expect(open).toHaveBeenCalledWith(TYTUS_CHAT_URL, "_blank", "noopener,noreferrer");
    expect(window.localStorage.getItem("tytus.chat-card.dismissed")).toBe("1");
    expect(screen.queryByTestId("tytus-chat-card")).toBeNull();
  });

  it("dismissal persists — the card never comes back", async () => {
    const first = render(
      <Harness>
        <TytusChatCard />
      </Harness>,
    );
    const later = await screen.findByRole("button", { name: /Maybe later/i });
    act(() => {
      fireEvent.click(later);
    });
    expect(screen.queryByTestId("tytus-chat-card")).toBeNull();
    first.unmount();

    render(
      <Harness>
        <TytusChatCard />
      </Harness>,
    );
    await settle();
    expect(screen.queryByTestId("tytus-chat-card")).toBeNull();
  });
});
