import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RevokeConfirmModal } from "@/apps/PodInspector";

// Manifest §3.3 destructive-action guard. The 2026-04-28 incident
// (curl POST /api/logout wiped 2 nemoclaw pods) is the reason this
// modal exists; the typed-name confirm must never silently regress.

const renderModal = (overrides: Partial<{
  podId: string;
  agentType: string;
  units: number;
  onCancel: () => void;
  onConfirm: () => void;
}> = {}) => {
  const onCancel = overrides.onCancel ?? vi.fn();
  const onConfirm = overrides.onConfirm ?? vi.fn();
  render(
    <RevokeConfirmModal
      podId={overrides.podId ?? "02"}
      agentType={overrides.agentType ?? "nemoclaw"}
      units={overrides.units ?? 1}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm };
};

const findRevokeButton = () =>
  screen.getByRole("button", { name: /Revoke pod 02 permanently/i });

describe("RevokeConfirmModal", () => {
  it("disables the destructive button when input is empty", () => {
    renderModal();
    expect((findRevokeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables the destructive button when input is wrong", () => {
    renderModal();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "pod 03" } });
    expect((findRevokeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the destructive button on exact match 'pod 02'", () => {
    renderModal();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "pod 02" } });
    expect((findRevokeButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("trims surrounding whitespace before matching", () => {
    renderModal();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  pod 02  " } });
    expect((findRevokeButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("does NOT match similar-but-different inputs (case sensitive, exact)", () => {
    renderModal();
    const input = screen.getByRole("textbox");
    // Different case is rejected — the typed-name pattern is strict
    // because case-fold rules differ between locales (Turkish ı/I etc.)
    // and the cost of accepting a near-match is destroying user data.
    fireEvent.change(input, { target: { value: "POD 02" } });
    expect((findRevokeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("Cancel button fires onCancel", () => {
    const { onCancel, onConfirm } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Revoke fires onConfirm only when input matches", () => {
    const { onConfirm } = renderModal();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "pod 02" } });
    fireEvent.click(findRevokeButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders pod_id, agent_type, and unit count in copy", () => {
    renderModal({ podId: "04", agentType: "hermes", units: 2 });
    expect(screen.getByText(/Revoke pod 04\?/)).toBeTruthy();
    expect(screen.getByText(/hermes pod/)).toBeTruthy();
    // "2 units" with plural — matches the body's units count
    expect(screen.getByText(/2 units/)).toBeTruthy();
  });
});
