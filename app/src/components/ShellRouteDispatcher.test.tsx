import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import ShellRouteDispatcher from "./ShellRouteDispatcher";

// Minimal useOSStore mock — we only care that dispatch is called.
const dispatchMock = vi.fn();
vi.mock("@/hooks/useOSStore", () => ({
  useOS: () => ({ dispatch: dispatchMock }),
}));

const setHash = (hash: string) => {
  // Direct assignment to keep jsdom + history.replaceState in sync.
  window.location.hash = hash;
};

const fireHashChange = () => {
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

describe("ShellRouteDispatcher hash cleanup", () => {
  beforeEach(() => {
    cleanup();
    dispatchMock.mockClear();
    // Reset hash via replaceState so we don't fire stray hashchange events
    // before the test even mounts.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  });

  it("dispatches a deep-linked route then clears the hash from the URL bar", () => {
    setHash("#/settings/agents");
    render(<ShellRouteDispatcher />);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OPEN_OR_FOCUS_WINDOW",
        appId: "settings",
      }),
    );
    expect(window.location.hash).toBe("");
  });

  it("does not dispatch (and does not clear) for the home route", () => {
    // Make sure the hash is empty going in.
    expect(window.location.hash).toBe("");
    render(<ShellRouteDispatcher />);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("re-dispatches on a subsequent hashchange", () => {
    render(<ShellRouteDispatcher />);
    expect(dispatchMock).not.toHaveBeenCalled();

    act(() => {
      setHash("#/pod/02/restart");
      fireHashChange();
    });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("");

    // A new deep-link should still dispatch — the cleared hash from the
    // previous round must not block the next one.
    act(() => {
      setHash("#/settings/agents");
      fireHashChange();
    });
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe("");
  });

  it("ignores routes that resolve to no shell target (e.g. unknown)", () => {
    setHash("#/this-is-not-a-known-route");
    render(<ShellRouteDispatcher />);
    expect(dispatchMock).not.toHaveBeenCalled();
    // Unknown route — leave the hash as-is for forensic visibility.
    expect(window.location.hash).toBe("#/this-is-not-a-known-route");
  });
});
