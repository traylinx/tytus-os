import { describe, expect, it } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import CommandPalette from "@/components/CommandPalette";
import { OSProvider } from "@/hooks/useOSStore";
import { DaemonClientProvider } from "@/hooks/useDaemonClient";
import { DaemonStateProvider } from "@/hooks/useDaemonStateContext";
import { I18nProvider } from "@/i18n";
import { createDaemonClient } from "@/lib/daemon";
import { makeFakeFetch } from "@/test/fakeFetch";
import { stateFixture } from "@/test/fixtures";

// Cmd+K dispatcher tests. The CommandPalette is the "spotlight" in
// TytusOS — wrong keyboard handling here means the palette either
// silently breaks (wrong shortcut wins) or hijacks something else.

const renderPalette = () => {
  const { fetch } = makeFakeFetch([
    { method: "GET", path: "/api/state", body: stateFixture },
  ]);
  const client = createDaemonClient({ fetch });
  return render(
    <I18nProvider>
      <DaemonClientProvider client={client}>
        <DaemonStateProvider intervalMs={60_000}>
          <OSProvider>
            <CommandPalette />
          </OSProvider>
        </DaemonStateProvider>
      </DaemonClientProvider>
    </I18nProvider>,
  );
};

const keydown = (key: string, opts: KeyboardEventInit = {}) => {
  fireEvent.keyDown(window, { key, ...opts });
};

const dispatchOpenShortcut = () => {
  // CommandPalette uses isMac() for choice; happy-dom returns ''
  // for navigator.platform so we exercise the Ctrl+K path which is
  // the non-mac branch and is what the host fires anyway.
  keydown("k", { ctrlKey: true });
};

describe("CommandPalette", () => {
  it("opens on Ctrl+K (non-mac path) and renders search input", async () => {
    renderPalette();
    // Closed by default — input is not in the DOM yet
    expect(screen.queryByPlaceholderText(/Type a command/i)).toBeNull();

    act(() => dispatchOpenShortcut());

    const input = await screen.findByPlaceholderText(/Type a command/i);
    expect(input).toBeTruthy();
  });

  it("autofocuses the input when opened", async () => {
    renderPalette();
    act(() => dispatchOpenShortcut());
    const input = (await screen.findByPlaceholderText(
      /Type a command/i,
    )) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("closes on Esc", async () => {
    renderPalette();
    act(() => dispatchOpenShortcut());
    await screen.findByPlaceholderText(/Type a command/i);

    act(() => keydown("Escape"));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Type a command/i)).toBeNull(),
    );
  });

  it("filters by case-insensitive substring on label or section", async () => {
    renderPalette();
    act(() => dispatchOpenShortcut());
    const input = (await screen.findByPlaceholderText(
      /Type a command/i,
    )) as HTMLInputElement;

    // Default state shows "Open Settings" + lots of others
    expect(screen.getByText(/Open Settings/)).toBeTruthy();

    act(() => fireEvent.change(input, { target: { value: "settings" } }));
    expect(screen.getByText(/Open Settings/)).toBeTruthy();
    // "Open Pod Inspector" should be filtered out by 'settings' query
    expect(screen.queryByText(/Open Pod Inspector/)).toBeNull();
  });

  it("Down arrow moves the highlight; Enter executes and closes", async () => {
    renderPalette();
    act(() => dispatchOpenShortcut());
    const input = (await screen.findByPlaceholderText(
      /Type a command/i,
    )) as HTMLInputElement;

    // Arrow + Enter handlers live on the input element, not window.
    // We don't assert which row got highlighted (the highlight style
    // isn't a discoverable role) — we just confirm Enter runs the
    // top command and closes the palette (execute always closes).
    act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    act(() => fireEvent.keyDown(input, { key: "Enter" }));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Type a command/i)).toBeNull(),
    );
  });

  it("clicking a row executes the command (closes the palette)", async () => {
    renderPalette();
    act(() => dispatchOpenShortcut());
    await screen.findByPlaceholderText(/Type a command/i);

    // Click the first command row — execute() closes the palette.
    act(() => fireEvent.click(screen.getByText(/Open Settings/)));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Type a command/i)).toBeNull(),
    );
  });
});
