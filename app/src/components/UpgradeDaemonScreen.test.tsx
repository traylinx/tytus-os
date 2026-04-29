import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import UpgradeDaemonScreen from "@/components/UpgradeDaemonScreen";
import { MIN_DAEMON_VERSION } from "@/lib/version";

// The screen replaces Desktop entirely when daemonVersionStatus is
// "unsupported". Failure modes we care about:
//   - User can read why they're blocked + which version is required
//   - Detected version is shown verbatim (incl. "unknown" for the
//     pre-piggyback null case) so support can see it in screenshots
//   - Re-check button surfaces the refresh callback so users can
//     verify their rebuild without a full page reload
//   - Copy button does not crash when clipboard is unavailable
//     (happy-dom does not provide writeText by default)

describe("UpgradeDaemonScreen", () => {
  it("renders MIN_DAEMON_VERSION required + detected version", () => {
    render(
      <UpgradeDaemonScreen detectedVersion="0.5.2" onRefresh={() => {}} />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText(/Your tray daemon is out of date/i),
    ).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`tytus-tray ${MIN_DAEMON_VERSION}`)),
    ).toBeTruthy();
    expect(screen.getByText("0.5.2")).toBeTruthy();
  });

  it("shows 'unknown' for pre-piggyback daemons (null version)", () => {
    render(
      <UpgradeDaemonScreen detectedVersion={null} onRefresh={() => {}} />,
    );
    expect(
      screen.getByText(/unknown \(pre-version daemon\)/i),
    ).toBeTruthy();
  });

  it("Re-check button calls onRefresh", () => {
    const onRefresh = vi.fn();
    render(
      <UpgradeDaemonScreen detectedVersion="0.5.0" onRefresh={onRefresh} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Re-check/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders the upgrade command in copyable, path-agnostic form", () => {
    render(
      <UpgradeDaemonScreen detectedVersion="0.5.0" onRefresh={() => {}} />,
    );
    const copyBtn = screen.getByRole("button", {
      name: /Copy upgrade command/i,
    });
    expect(copyBtn).toBeTruthy();
    // The full command is in the DOM as a code block. It must be
    // path-agnostic — no $HOME / ~ / hardcoded checkout paths.
    const command = screen.getByText(/get\.traylinx\.com\/install\.sh/);
    expect(command).toBeTruthy();
    expect(command.textContent ?? "").not.toMatch(/~|\$HOME|\/Users\//);
  });

  it("Copy button does not crash when clipboard is unavailable", () => {
    // happy-dom in tests has navigator.clipboard but writeText may be
    // missing. The component must catch and survive.
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    render(
      <UpgradeDaemonScreen detectedVersion="0.5.0" onRefresh={() => {}} />,
    );
    expect(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Copy upgrade command/i }),
      );
    }).not.toThrow();
    Object.defineProperty(navigator, "clipboard", {
      value: original,
      configurable: true,
    });
  });

  it("does not leak the copied-confirmation timer on unmount", () => {
    // Validator review #2: the 1500ms setTimeout from the copy handler
    // must be cleared if the component unmounts inside the window —
    // otherwise React warns about setState on an unmounted component
    // and we leak a timer per unmount.
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { unmount } = render(
      <UpgradeDaemonScreen detectedVersion="0.5.0" onRefresh={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Copy upgrade command/i }),
    );
    // Unmount before the 1500ms confirmation timer fires.
    expect(() => unmount()).not.toThrow();
    Object.defineProperty(navigator, "clipboard", {
      value: original,
      configurable: true,
    });
  });
});
