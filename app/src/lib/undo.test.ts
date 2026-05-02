import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetUndoForTest, peekUndoRing, pushUndo, undoLast } from "./undo";

beforeEach(() => _resetUndoForTest());
afterEach(() => _resetUndoForTest());

describe("undo ring", () => {
  it("pushes and pops in LIFO order", async () => {
    const a = vi.fn();
    const b = vi.fn();
    pushUndo({ label: "a", undo: a });
    pushUndo({ label: "b", undo: b });
    expect(peekUndoRing().length).toBe(2);
    const popped = await undoLast();
    expect(popped?.label).toBe("b");
    expect(b).toHaveBeenCalled();
    expect(a).not.toHaveBeenCalled();
  });

  it("caps at 5 entries; oldest fall off", () => {
    for (let i = 0; i < 8; i++) {
      pushUndo({ label: `op-${i}`, undo: () => {} });
    }
    const ring = peekUndoRing();
    expect(ring.length).toBe(5);
    expect(ring[0].label).toBe("op-3");
    expect(ring[4].label).toBe("op-7");
  });

  it("undoLast on empty ring returns null", async () => {
    expect(await undoLast()).toBeNull();
  });

  it("supports async undo functions", async () => {
    let done = false;
    pushUndo({
      label: "async",
      undo: async () => {
        await Promise.resolve();
        done = true;
      },
    });
    await undoLast();
    expect(done).toBe(true);
  });
});
