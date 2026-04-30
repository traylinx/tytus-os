import { describe, it, expect } from "vitest";
import { includedLabel } from "./includedLabel";

describe("includedLabel", () => {
  it("returns 'AIL' for a single included pod", () => {
    const list = [{ pod_id: "04" }];
    expect(includedLabel(list[0]!, list)).toBe("AIL");
  });

  it("disambiguates when multiple included pods exist", () => {
    const list = [{ pod_id: "01" }, { pod_id: "04" }];
    expect(includedLabel(list[0]!, list)).toBe("AIL (01)");
    expect(includedLabel(list[1]!, list)).toBe("AIL (04)");
  });

  it("returns 'AIL' when called with an empty list (defensive)", () => {
    // Caller should never pass an empty list, but the helper degrades
    // gracefully rather than rendering 'AIL ()'.
    expect(includedLabel({ pod_id: "04" }, [])).toBe("AIL");
  });
});
