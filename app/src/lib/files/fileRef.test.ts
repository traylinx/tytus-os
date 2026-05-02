import { describe, expect, it } from "vitest";
import {
  FILE_REF_MIME,
  capabilitiesOf,
  isDaemonRef,
  isVfsRef,
  parseRefs,
  refFromDaemonPath,
  refFromVfsNode,
  refKey,
  serializeRefs,
  toFileMutationSource,
  type FileRef,
} from "./fileRef";

describe("fileRef constructors", () => {
  it("refFromVfsNode requires a nodeId", () => {
    expect(() => refFromVfsNode("")).toThrow(/nodeId/);
    const ref = refFromVfsNode("abc");
    expect(ref).toEqual({ source: "vfs", nodeId: "abc" });
  });

  it("refFromDaemonPath defaults daemonSource to tytus-home", () => {
    const ref = refFromDaemonPath("/home/sebastian/Documents/file.txt");
    expect(ref).toEqual({
      source: "daemon",
      daemonSource: "tytus-home",
      path: "/home/sebastian/Documents/file.txt",
    });
  });

  it("refFromDaemonPath carries binding/pod/readonly", () => {
    const ref = refFromDaemonPath("a/b", {
      daemonSource: "shared",
      binding: 2,
      readonly: true,
    });
    expect(ref).toEqual({
      source: "daemon",
      daemonSource: "shared",
      path: "a/b",
      binding: 2,
      readonly: true,
    });
  });

  it("refFromDaemonPath rejects empty path", () => {
    expect(() => refFromDaemonPath("")).toThrow(/path/);
  });
});

describe("capabilitiesOf", () => {
  it("vfs refs are fully writable", () => {
    expect(capabilitiesOf(refFromVfsNode("n1"))).toEqual({
      readonly: false,
      canMove: true,
      canCopy: true,
      canTrash: true,
      canDownload: true,
      canRename: true,
    });
  });

  it("daemon refs default to writable", () => {
    expect(capabilitiesOf(refFromDaemonPath("/x"))).toEqual({
      readonly: false,
      canMove: true,
      canCopy: true,
      canTrash: true,
      canDownload: true,
      canRename: true,
    });
  });

  it("daemon readonly refs lock down move/trash/rename but keep copy/download", () => {
    const ro = refFromDaemonPath("/x", { readonly: true });
    expect(capabilitiesOf(ro)).toEqual({
      readonly: true,
      canMove: false,
      canCopy: true,
      canTrash: false,
      canDownload: true,
      canRename: false,
    });
  });
});

describe("refKey", () => {
  it("produces stable distinct keys per backend", () => {
    expect(refKey(refFromVfsNode("n1"))).toBe("vfs:n1");
    expect(refKey(refFromDaemonPath("/a/b"))).toBe("daemon:tytus-home:/a/b");
    expect(
      refKey(refFromDaemonPath("/a", { daemonSource: "shared", binding: 3 })),
    ).toBe("daemon:shared:b3:/a");
    expect(
      refKey(
        refFromDaemonPath("/a", { daemonSource: "pod-workspace", pod: "02" }),
      ),
    ).toBe("daemon:pod-workspace:p02:/a");
  });

  it("vfs and daemon refs at same string never collide", () => {
    expect(refKey(refFromVfsNode("foo"))).not.toBe(
      refKey(refFromDaemonPath("foo")),
    );
  });
});

describe("toFileMutationSource", () => {
  it("strips FileRef-only fields", () => {
    const ref = refFromDaemonPath("/x", {
      daemonSource: "shared",
      binding: 2,
      pod: "ignored-here",
      readonly: true,
    });
    expect(toFileMutationSource(ref)).toEqual({
      source: "shared",
      path: "/x",
      binding: 2,
    });
  });
});

describe("serialize/parse round-trip", () => {
  const cases: FileRef[][] = [
    [refFromVfsNode("n1")],
    [refFromDaemonPath("/a/b.txt")],
    [
      refFromVfsNode("n1"),
      refFromDaemonPath("/a", { daemonSource: "shared", binding: 0 }),
      refFromDaemonPath("/c", { daemonSource: "pod-workspace", pod: "01" }),
    ],
    [refFromDaemonPath("/ro", { readonly: true })],
  ];

  for (const refs of cases) {
    it(`round-trips ${JSON.stringify(refs)}`, () => {
      const serialized = serializeRefs(refs);
      const parsed = parseRefs(serialized);
      expect(parsed).toEqual(refs);
    });
  }

  it("parseRefs returns null on garbage", () => {
    expect(parseRefs(null)).toBeNull();
    expect(parseRefs("")).toBeNull();
    expect(parseRefs("not json")).toBeNull();
    expect(parseRefs("{}")).toBeNull();
    expect(parseRefs(JSON.stringify([{ source: "alien" }]))).toBeNull();
    expect(
      parseRefs(JSON.stringify([{ source: "vfs" }])),
    ).toBeNull(); // missing nodeId
    expect(
      parseRefs(JSON.stringify([{ source: "daemon", path: "/x" }])),
    ).toBeNull(); // missing daemonSource
  });

  it("FILE_REF_MIME is the documented constant", () => {
    expect(FILE_REF_MIME).toBe("application/x-tytus-file-ref");
  });
});

describe("type predicates", () => {
  it("isVfsRef / isDaemonRef discriminate", () => {
    const v = refFromVfsNode("n1");
    const d = refFromDaemonPath("/x");
    expect(isVfsRef(v)).toBe(true);
    expect(isVfsRef(d)).toBe(false);
    expect(isDaemonRef(d)).toBe(true);
    expect(isDaemonRef(v)).toBe(false);
  });
});
