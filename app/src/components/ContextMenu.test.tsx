import { describe, expect, it } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { OSProvider, useOS } from "@/hooks/useOSStore";
import ContextMenu from "@/components/ContextMenu";
import type { FC, ReactNode } from "react";

// Phase 7 cont — verify the OPEN_APP_WITH_FILE action plumbs file +
// podId from contextData → the resulting window's `args`.

const Harness: FC<{ children: ReactNode }> = ({ children }) => (
  <OSProvider>
    <ContextMenu />
    {children}
  </OSProvider>
);

const Driver: FC<{ onState: (s: ReturnType<typeof useOS>["state"]) => void }> = ({
  onState,
}) => {
  const { state, dispatch } = useOS();
  onState(state);
  return (
    <button
      data-testid="trigger"
      onClick={() =>
        dispatch({
          type: "SHOW_CONTEXT_MENU",
          x: 100,
          y: 100,
          menuType: "file",
          items: [
            {
              id: "open-with-image",
              label: "Open with Image Viewer",
              icon: "Image",
              action: "OPEN_APP_WITH_FILE:imageviewer",
            },
          ],
          contextData: { file: "photo.png", podId: "02" },
        })
      }
    >
      open menu
    </button>
  );
};

describe("ContextMenu — OPEN_APP_WITH_FILE", () => {
  it("dispatches OPEN_WINDOW with file + podId in args", async () => {
    let snapshot: ReturnType<typeof useOS>["state"] | null = null;
    const { getByTestId, getByText } = render(
      <Harness>
        <Driver onState={(s) => (snapshot = s)} />
      </Harness>,
    );

    // Open the menu.
    fireEvent.click(getByTestId("trigger"));
    // The menu item should be visible.
    const item = getByText("Open with Image Viewer");
    // Click the item.
    fireEvent.click(item);

    // Allow the dispatch chain to flush.
    await act(async () => {
      await Promise.resolve();
    });

    expect(snapshot).not.toBeNull();
    const win = snapshot!.windows.find((w) => w.appId === "imageviewer");
    expect(win).toBeDefined();
    expect(win!.args?.file).toBe("photo.png");
    expect(win!.args?.podId).toBe("02");
    expect(win!.title).toContain("photo.png");
  });
});
