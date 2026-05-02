import { describe, expect, it } from "vitest";
import { sameRef } from "./clipboard";
import { refFromDaemonPath, refFromVfsNode } from "@/lib/files/fileRef";

describe("sameRef", () => {
  it("two vfs refs with same nodeId are equal", () => {
    expect(sameRef(refFromVfsNode("a"), refFromVfsNode("a"))).toBe(true);
    expect(sameRef(refFromVfsNode("a"), refFromVfsNode("b"))).toBe(false);
  });
  it("vfs vs daemon never equal", () => {
    expect(
      sameRef(refFromVfsNode("a"), refFromDaemonPath("a")),
    ).toBe(false);
  });
  it("daemon refs require same daemonSource + path + binding + pod", () => {
    expect(
      sameRef(
        refFromDaemonPath("/x", { daemonSource: "shared", binding: 0 }),
        refFromDaemonPath("/x", { daemonSource: "shared", binding: 0 }),
      ),
    ).toBe(true);
    expect(
      sameRef(
        refFromDaemonPath("/x", { daemonSource: "shared", binding: 0 }),
        refFromDaemonPath("/x", { daemonSource: "shared", binding: 1 }),
      ),
    ).toBe(false);
    expect(
      sameRef(
        refFromDaemonPath("/x", { daemonSource: "tytus-home" }),
        refFromDaemonPath("/x", { daemonSource: "shared" }),
      ),
    ).toBe(false);
  });
});
