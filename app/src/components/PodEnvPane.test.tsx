import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PodEnvPane from "@/components/PodEnvPane";
import { createDaemonClient } from "@/lib/daemon";
import { makeFakeFetch } from "@/test/fakeFetch";

// Phase 1 cont — Pod Inspector Env pane.
//
// Two invariants:
//  1. Default fetch must NOT include reveal=secrets (any tier can see the
//     redacted view; only secrets are gated).
//  2. The "Reveal secrets" button is disabled for non-Operator tiers, so
//     a Creator user can't even attempt the call.

const redactedBody = {
  pod_num: 2,
  agent_type: "nemoclaw",
  reveal_secrets: false,
  vars: [
    { key: "TYTUS_POD_ID", value: "02", source: "runtime" },
    { key: "OPENAI_API_KEY", value: "<redacted>", source: "channels" },
  ],
};

const revealedBody = {
  pod_num: 2,
  agent_type: "nemoclaw",
  reveal_secrets: true,
  vars: [
    { key: "TYTUS_POD_ID", value: "02", source: "runtime" },
    { key: "OPENAI_API_KEY", value: "sk-real", source: "channels" },
  ],
};

describe("PodEnvPane", () => {
  it("loads the redacted env on mount and renders [source] badges", async () => {
    const { fetch, calls } = makeFakeFetch([
      { method: "GET", path: "/api/pod/env?pod=02", body: redactedBody },
    ]);
    const client = createDaemonClient({ fetch });
    render(
      <PodEnvPane
        client={client}
        podId="02"
        tier="creator"
        onClose={() => {}}
        onError={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText("TYTUS_POD_ID")).not.toBeNull();
    });
    expect(screen.queryByText("OPENAI_API_KEY")).not.toBeNull();
    expect(screen.queryByText("<redacted>")).not.toBeNull();
    // [runtime] + [channels] badges (CSS uppercases visually; text is
    // the wire enum value).
    expect(screen.queryByText("runtime")).not.toBeNull();
    expect(screen.queryByText("channels")).not.toBeNull();
    // No reveal=secrets in the redacted call.
    expect(calls[0].url).not.toContain("reveal=secrets");
  });

  it("disables Reveal secrets button for non-Operator tiers", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/pod/env?pod=02", body: redactedBody },
    ]);
    const client = createDaemonClient({ fetch });
    render(
      <PodEnvPane
        client={client}
        podId="02"
        tier="creator"
        onClose={() => {}}
        onError={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText("TYTUS_POD_ID")).not.toBeNull();
    });
    const reveal = screen.getByRole("button", {
      name: /reveal secrets/i,
    }) as HTMLButtonElement;
    expect(reveal.disabled).toBe(true);
  });

  it("flips to revealed values when Operator clicks Reveal secrets", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/pod/env?pod=02", body: redactedBody },
      {
        method: "GET",
        path: "/api/pod/env?pod=02&reveal=secrets",
        body: revealedBody,
      },
    ]);
    const client = createDaemonClient({ fetch });
    render(
      <PodEnvPane
        client={client}
        podId="02"
        tier="operator"
        onClose={() => {}}
        onError={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText("<redacted>")).not.toBeNull();
    });
    const reveal = screen.getByRole("button", {
      name: /reveal secrets/i,
    }) as HTMLButtonElement;
    expect(reveal.disabled).toBe(false);
    fireEvent.click(reveal);
    await waitFor(() => {
      expect(screen.queryByText("sk-real")).not.toBeNull();
    });
    // After flipping, the toggle now reads "Hide secrets".
    expect(
      screen.queryByRole("button", { name: /hide secrets/i }),
    ).not.toBeNull();
  });

  it("filters env vars by key substring (case-insensitive)", async () => {
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/pod/env?pod=02", body: redactedBody },
    ]);
    const client = createDaemonClient({ fetch });
    render(
      <PodEnvPane
        client={client}
        podId="02"
        tier="creator"
        onClose={() => {}}
        onError={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText("TYTUS_POD_ID")).not.toBeNull();
    });
    const filter = screen.getByLabelText(/filter env keys/i);
    fireEvent.change(filter, { target: { value: "openai" } });
    expect(screen.queryByText("TYTUS_POD_ID")).toBeNull();
    expect(screen.queryByText("OPENAI_API_KEY")).not.toBeNull();
  });

  it("calls onError + falls back to redacted when daemon returns 403", async () => {
    const onError = vi.fn();
    const { fetch } = makeFakeFetch([
      { method: "GET", path: "/api/pod/env?pod=02", body: redactedBody },
      {
        method: "GET",
        path: "/api/pod/env?pod=02&reveal=secrets",
        status: 403,
        body: { error: "plan_required", code: "auth_required" },
      },
      // After 403, the pane refetches the redacted view (so the table
      // doesn't go blank).
      { method: "GET", path: "/api/pod/env?pod=02", body: redactedBody },
    ]);
    const client = createDaemonClient({ fetch });
    render(
      <PodEnvPane
        client={client}
        podId="02"
        tier="operator"
        onClose={() => {}}
        onError={onError}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText("TYTUS_POD_ID")).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /reveal secrets/i }));
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("Operator"),
      );
    });
    // Toggle is back to "Reveal secrets" — we rolled it back on 403.
    expect(
      screen.queryByRole("button", { name: /reveal secrets/i }),
    ).not.toBeNull();
  });
});
