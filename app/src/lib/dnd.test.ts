import { describe, expect, it } from "vitest";
import {
  canAccept,
  detectKind,
  DND_MIMES,
  parsePayload,
  serializePayload,
  type DnDPayload,
} from "./dnd";
import { refFromDaemonPath, refFromVfsNode } from "./files/fileRef";

/**
 * Minimal DataTransfer fake — DataTransfer in happy-dom has gaps
 * around `files` and `types` ordering that make round-trip testing
 * fragile. This shim mirrors what HTML5 actually exposes.
 */
function makeDT(): DataTransfer {
  const data: Record<string, string> = {};
  const dt: Partial<DataTransfer> & {
    setData: DataTransfer["setData"];
    getData: DataTransfer["getData"];
    files: FileList;
    types: string[];
  } = {
    setData: (k: string, v: string) => {
      data[k] = v;
    },
    getData: (k: string) => data[k] ?? "",
    files: { length: 0 } as unknown as FileList,
    types: [],
    dropEffect: "copy",
    effectAllowed: "all",
  };
  Object.defineProperty(dt, "types", {
    get: () => Object.keys(data),
  });
  return dt as unknown as DataTransfer;
}

describe("serialize / parse round-trip", () => {
  const cases: DnDPayload[] = [
    {
      kind: "file",
      refs: [refFromVfsNode("n1"), refFromDaemonPath("/a/b.txt")],
    },
    { kind: "desktop-icon", iconIds: ["icon-1", "icon-2"] },
    { kind: "app", appId: "filemanager" },
    { kind: "app-window", windowId: "w-7" },
    {
      kind: "track",
      trackId: "track-99",
      title: "song",
      styleTags: "synthwave",
      hasAudio: true,
    },
    { kind: "text", text: "hello world" },
  ];
  for (const payload of cases) {
    it(`round-trips ${payload.kind}`, () => {
      const dt = makeDT();
      serializePayload(dt, payload);
      const out = parsePayload(dt);
      expect(out).toEqual(expect.objectContaining({ kind: payload.kind }));
    });
  }

  it("file payload round-trip preserves refs", () => {
    const refs = [
      refFromVfsNode("n1"),
      refFromDaemonPath("/a/b", { daemonSource: "shared", binding: 0 }),
    ];
    const dt = makeDT();
    serializePayload(dt, { kind: "file", refs });
    const out = parsePayload(dt);
    expect(out).toEqual({ kind: "file", refs });
  });

  it("text/plain fallback present on file drag", () => {
    const dt = makeDT();
    serializePayload(dt, {
      kind: "file",
      refs: [refFromDaemonPath("/home/seb/notes.md")],
    });
    expect(dt.getData(DND_MIMES.text)).toBe("notes.md");
  });
});

describe("detectKind", () => {
  it("returns file for FileRef MIME", () => {
    const dt = makeDT();
    serializePayload(dt, { kind: "file", refs: [refFromVfsNode("n1")] });
    expect(detectKind(dt)).toBe("file");
  });
  it("returns null for empty DataTransfer", () => {
    expect(detectKind(makeDT())).toBeNull();
  });
});

describe("canAccept matrix", () => {
  it("desktop accepts file/track/text/external/desktop-icon", () => {
    expect(canAccept("desktop", "file")).toBe(true);
    expect(canAccept("desktop", "track")).toBe(true);
    expect(canAccept("desktop", "text")).toBe(true);
    expect(canAccept("desktop", "external-files")).toBe(true);
    expect(canAccept("desktop", "desktop-icon")).toBe(true);
  });

  it("trash only accepts file + desktop-icon", () => {
    expect(canAccept("trash", "file")).toBe(true);
    expect(canAccept("trash", "desktop-icon")).toBe(true);
    expect(canAccept("trash", "track")).toBe(false);
    expect(canAccept("trash", "text")).toBe(false);
    expect(canAccept("trash", "app")).toBe(false);
  });

  it("dock accepts only app drags (reorder); dockAppIcon accepts file/external/track", () => {
    expect(canAccept("dock", "app")).toBe(true);
    expect(canAccept("dock", "file")).toBe(false);

    expect(canAccept("dockAppIcon", "file")).toBe(true);
    expect(canAccept("dockAppIcon", "external-files")).toBe(true);
    expect(canAccept("dockAppIcon", "track")).toBe(true);
    expect(canAccept("dockAppIcon", "app")).toBe(false);
  });

  it("appWindow accepts file/external/track for open-with style drops", () => {
    expect(canAccept("appWindow", "file")).toBe(true);
    expect(canAccept("appWindow", "external-files")).toBe(true);
    expect(canAccept("appWindow", "track")).toBe(true);
    expect(canAccept("appWindow", "app")).toBe(false);
  });

  it("external is a no-op target (drag-out only)", () => {
    expect(canAccept("external", "file")).toBe(false);
  });
});
