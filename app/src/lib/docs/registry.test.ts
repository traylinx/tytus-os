// ============================================================
// Help docs registry — coverage tests
// ============================================================
//
// The registry is built at module-load time from a Vite glob over
// ../docs/user-manual/*.md and ../docs/troubleshooting/*.md. These
// tests verify:
//   - every known slug is present after Sprint A + B closeout
//   - the recommended-order sort lands getting-started first
//   - findDoc / searchDocs behave correctly
//   - readingTimeMin always returns ≥ 1 minute
//
// New markdown files dropped into the docs folder will appear here
// automatically. Add a new entry to the EXPECTED_SLUGS list below
// when you intentionally add or rename a doc.

import { describe, expect, it } from "vitest";
import {
  DOCS,
  findDoc,
  searchDocs,
  readingTimeMin,
} from "@/lib/docs/registry";

const EXPECTED_SLUGS = [
  "getting-started",
  "resource-fabric",
  "agents",
  "shared-folders",
  "use-cases",
  "windows",
  "desktop",
  "dock",
  "launcher",
  "keyboard-shortcuts",
  "files",
  "atomek",
  "settings",
  "apps-catalog",
  "troubleshooting",
  "clipboard",
  "about",
];

describe("docs registry", () => {
  it("includes every known user-manual + troubleshooting slug", () => {
    const slugs = DOCS.map((d) => d.slug);
    for (const expected of EXPECTED_SLUGS) {
      expect(slugs).toContain(expected);
    }
  });

  it("orders getting-started first", () => {
    expect(DOCS[0]?.slug).toBe("getting-started");
  });

  it("places troubleshooting/clipboard between troubleshooting.md and about", () => {
    const slugs = DOCS.map((d) => d.slug);
    const tIdx = slugs.indexOf("troubleshooting");
    const cIdx = slugs.indexOf("clipboard");
    const aIdx = slugs.indexOf("about");
    expect(tIdx).toBeGreaterThanOrEqual(0);
    expect(cIdx).toBeGreaterThan(tIdx);
    expect(aIdx).toBeGreaterThan(cIdx);
  });

  it("parses titles from H1", () => {
    const gs = findDoc("getting-started");
    expect(gs?.title).toMatch(/Getting Started/i);
  });

  it("findDoc returns undefined for unknown slugs", () => {
    expect(findDoc("does-not-exist")).toBeUndefined();
  });

  it("searchDocs filters by title and body", () => {
    const allWhenEmpty = searchDocs("");
    expect(allWhenEmpty.length).toBe(DOCS.length);

    const matchByTitle = searchDocs("keyboard");
    expect(matchByTitle.some((d) => d.slug === "keyboard-shortcuts")).toBe(
      true,
    );

    const matchByBody = searchDocs("clipboard permission");
    // clipboard.md and settings.md both reference clipboard permission.
    expect(matchByBody.length).toBeGreaterThan(0);

    const noMatch = searchDocs("zxqzxqzxqlongnonsensestring");
    expect(noMatch.length).toBe(0);
  });

  it("reading time is always ≥ 1 minute", () => {
    for (const doc of DOCS) {
      expect(readingTimeMin(doc)).toBeGreaterThanOrEqual(1);
    }
  });

  it("every doc has a non-empty body", () => {
    for (const doc of DOCS) {
      expect(doc.body.length).toBeGreaterThan(0);
    }
  });
});
