import { describe, expect, it } from "vitest";
import {
  buildFileOpenWithMenu,
  inboxLineToFilename,
  isMissingInboxDiagnostic,
} from "@/apps/fileManagerOpenWith";

// Phase 7 cont — open-with hooks for Image / Document / Archive.

describe("inboxLineToFilename", () => {
  it("returns the bare filename when the line is single-token", () => {
    expect(inboxLineToFilename("photo.png")).toBe("photo.png");
    expect(inboxLineToFilename("  spaced.txt  ")).toBe("spaced.txt");
  });

  it("returns the last token of `ls -l`-style output when it has a dot", () => {
    expect(
      inboxLineToFilename(
        "-rw-r--r--  1 ubuntu  ubuntu  245K Apr 28 photo.png",
      ),
    ).toBe("photo.png");
  });

  it("falls back to the first token when no token has a dot", () => {
    expect(inboxLineToFilename("dir1 dir2 dir3")).toBe("dir1");
  });

  it("returns empty string for empty / whitespace-only lines", () => {
    expect(inboxLineToFilename("")).toBe("");
    expect(inboxLineToFilename("   \t  ")).toBe("");
  });
});

describe("buildFileOpenWithMenu", () => {
  it("returns Image Viewer entry for .png / .jpg / .gif", () => {
    for (const f of ["x.png", "x.jpg", "x.gif"]) {
      const items = buildFileOpenWithMenu(f);
      expect(items).not.toBeNull();
      expect(items![0].action).toBe("OPEN_APP_WITH_FILE:imageviewer");
    }
  });

  it("returns Document Viewer entry for .pdf", () => {
    const items = buildFileOpenWithMenu("notes.pdf");
    expect(items).not.toBeNull();
    expect(items![0].action).toBe("OPEN_APP_WITH_FILE:documentviewer");
  });

  it("returns Archive Manager entry for .zip", () => {
    const items = buildFileOpenWithMenu("backup.zip");
    expect(items).not.toBeNull();
    expect(items![0].action).toBe("OPEN_APP_WITH_FILE:archivemanager");
  });

  it("returns null for filenames matched by other apps (txt → texteditor)", () => {
    // .txt has an association (texteditor) but it's not one of the Phase 7
    // viewers, so the menu MUST stay empty — leaks would mis-route the file.
    expect(buildFileOpenWithMenu("readme.txt")).toBeNull();
  });

  it("returns null for unknown extensions", () => {
    expect(buildFileOpenWithMenu("opaque.xyz")).toBeNull();
    expect(buildFileOpenWithMenu("noext")).toBeNull();
  });
});

describe("isMissingInboxDiagnostic", () => {
  it("recognizes old-pod missing inbox stderr as empty-state input", () => {
    expect(
      isMissingInboxDiagnostic(
        "ls: cannot access '/app/workspace/inbox': No such file or directory",
      ),
    ).toBe(true);
    expect(isMissingInboxDiagnostic("/app/workspace/inbox: not found")).toBe(
      true,
    );
    expect(
      isMissingInboxDiagnostic(
        "tytus ls: no such path: /app/workspace/inbox/",
      ),
    ).toBe(true);
  });

  it("does not classify real file rows as diagnostics", () => {
    expect(isMissingInboxDiagnostic("photo.png 245K Apr 28 14:22")).toBe(false);
    expect(isMissingInboxDiagnostic("README.md")).toBe(false);
  });
});
