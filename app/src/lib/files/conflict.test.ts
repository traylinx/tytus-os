import { describe, expect, it } from "vitest";
import {
  CONFLICT_RESOLUTIONS,
  findCollisions,
  nextAvailableName,
  splitExt,
} from "./conflict";

describe("splitExt", () => {
  it("splits on last dot", () => {
    expect(splitExt("foo.txt")).toEqual({ stem: "foo", ext: ".txt" });
    expect(splitExt("archive.tar.gz")).toEqual({
      stem: "archive.tar",
      ext: ".gz",
    });
  });

  it("treats leading-dot hidden files as no-extension", () => {
    expect(splitExt(".bashrc")).toEqual({ stem: ".bashrc", ext: "" });
    expect(splitExt(".env")).toEqual({ stem: ".env", ext: "" });
  });

  it("handles empty + no-dot inputs", () => {
    expect(splitExt("")).toEqual({ stem: "", ext: "" });
    expect(splitExt("readme")).toEqual({ stem: "readme", ext: "" });
  });
});

describe("nextAvailableName", () => {
  it("returns proposed unchanged when free", () => {
    expect(nextAvailableName([], "foo.txt")).toBe("foo.txt");
    expect(nextAvailableName(["bar.txt"], "foo.txt")).toBe("foo.txt");
  });

  it("appends (2) on first collision", () => {
    expect(nextAvailableName(["foo.txt"], "foo.txt")).toBe("foo (2).txt");
  });

  it("walks past existing (N) suffixes", () => {
    expect(
      nextAvailableName(["foo.txt", "foo (2).txt"], "foo.txt"),
    ).toBe("foo (3).txt");
  });

  it("is case-insensitive (HFS+ behaviour)", () => {
    expect(nextAvailableName(["Foo.txt"], "foo.txt")).toBe("foo (2).txt");
    expect(nextAvailableName(["FOO (2).TXT", "foo.txt"], "foo.txt")).toBe(
      "foo (3).txt",
    );
  });

  it("handles no-extension and hidden files", () => {
    expect(nextAvailableName(["readme"], "readme")).toBe("readme (2)");
    expect(nextAvailableName([".bashrc"], ".bashrc")).toBe(".bashrc (2)");
  });

  it("matches Finder behaviour for compound suffixes", () => {
    expect(
      nextAvailableName(["archive.tar.gz"], "archive.tar.gz"),
    ).toBe("archive.tar (2).gz");
  });

  it("rejects empty proposed", () => {
    expect(() => nextAvailableName([], "")).toThrow(/proposed/);
  });
});

describe("findCollisions", () => {
  it("returns indices of colliding incoming names", () => {
    expect(
      findCollisions(["a.txt", "b.txt"], ["x.txt", "B.TXT", "a.txt", "c.txt"]),
    ).toEqual([1, 2]);
  });

  it("returns empty array when nothing collides", () => {
    expect(findCollisions(["a.txt"], ["b.txt", "c.txt"])).toEqual([]);
  });
});

describe("CONFLICT_RESOLUTIONS", () => {
  it("enumerates all four resolutions", () => {
    expect(CONFLICT_RESOLUTIONS).toEqual([
      "replace",
      "keep-both",
      "skip",
      "cancel-all",
    ]);
  });
});
