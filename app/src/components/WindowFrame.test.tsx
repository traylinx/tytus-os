import { describe, expect, it, beforeEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import WindowFrame from "@/components/WindowFrame";
import { OSProvider, useOS } from "@/hooks/useOSStore";
import type { FC } from "react";

const TestWindow: FC<{ onState: (s: ReturnType<typeof useOS>["state"]) => void }> = ({ onState }) => {
  const { state, dispatch } = useOS();
  onState(state);

  useEffect(() => {
    if (!state.windows.some((w) => w.appId === "filemanager")) {
      dispatch({ type: "OPEN_WINDOW", appId: "filemanager" });
    }
  }, [state.windows, dispatch]);

  const win = state.windows.find((w) => w.appId === "filemanager");
  if (!win) return null;
  return (
    <WindowFrame window={win}>
      <div>Window body</div>
    </WindowFrame>
  );
};

const fireWindowMouseMove = (clientX: number, clientY: number) => {
  act(() => {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY, bubbles: true }));
  });
};

const fireWindowMouseUp = () => {
  act(() => {
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
};

describe("WindowFrame drag", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("moves immediately through the React state drag path", async () => {
    let snapshot: ReturnType<typeof useOS>["state"] | null = null;
    const { container, findByText } = render(
      <OSProvider>
        <TestWindow onState={(s) => (snapshot = s)} />
      </OSProvider>,
    );

    await findByText("Window body");
    const before = snapshot!.windows.find((w) => w.appId === "filemanager")!;
    const frame = container.querySelector("[data-window-id]") as HTMLElement;
    const titlebar = frame.firstElementChild as HTMLElement;

    fireEvent.mouseDown(titlebar, { clientX: 100, clientY: 60, button: 0 });
    fireWindowMouseMove(180, 130);

    await waitFor(() => {
      const after = snapshot!.windows.find((w) => w.id === before.id)!;
      expect(after.position.x).toBe(before.position.x + 80);
      expect(after.position.y).toBe(before.position.y + 70);
    });

    fireWindowMouseUp();
    fireWindowMouseMove(260, 220);

    const afterUp = snapshot!.windows.find((w) => w.id === before.id)!;
    expect(afterUp.position.x).toBe(before.position.x + 80);
    expect(afterUp.position.y).toBe(before.position.y + 70);
  });
});
