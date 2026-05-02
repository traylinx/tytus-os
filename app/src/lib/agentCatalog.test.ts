import { describe, it, expect } from "vitest";
import { resolveAgentDisplay } from "./agentCatalog";

const enT = (key: string): string => {
  const map: Record<string, string> = {
    "agents.openclaw.name": "OpenClaw",
    "agents.openclaw.tagline": "Tagline EN",
    "agents.openclaw.description": "Description EN",
    "agents.openclaw.highlight.0": "Bullet A",
    "agents.openclaw.highlight.1": "Bullet B",
    "agents.openclaw.highlight.2": "",
    "agents.openclaw.highlight.3": "",
  };
  return map[key] ?? key;
};

const passthroughT = (key: string): string => key;

describe("resolveAgentDisplay", () => {
  it("uses translated copy when available", () => {
    const r = resolveAgentDisplay(
      "nemoclaw",
      {
        name: "fallback",
        tagline: "fallback tagline",
        description: "fallback desc",
      },
      enT,
    );
    expect(r.name).toBe("OpenClaw");
    expect(r.tagline).toBe("Tagline EN");
    expect(r.description).toBe("Description EN");
    expect(r.highlights).toEqual(["Bullet A", "Bullet B"]);
    expect(r.icon).toBe("/agents/openclaw.svg");
    expect(r.homepage).toBe("https://openclaw.ai/");
    expect(r.github).toBe("https://github.com/openclaw/openclaw");
  });

  it("falls back to catalog strings when i18n returns the bare key", () => {
    const r = resolveAgentDisplay(
      "hermes",
      {
        name: "Hermes (cat)",
        tagline: "Hermes cat tagline",
        description: "Hermes cat description",
        icon_url: "/cat-icon.png",
        docs_url: "https://example.test/hermes",
      },
      passthroughT,
    );
    expect(r.name).toBe("Hermes (cat)");
    expect(r.tagline).toBe("Hermes cat tagline");
    expect(r.description).toBe("Hermes cat description");
    expect(r.highlights).toEqual([]);
    // Static facts always win when present in the override map.
    expect(r.icon).toBe("/agents/hermes.svg");
    expect(r.homepage).toBe("https://hermes-agent.nousresearch.com/");
  });

  it("handles unknown agent types via catalog fallback only", () => {
    const r = resolveAgentDisplay(
      "future-agent",
      {
        name: "FutureAgent",
        description: "Coming soon",
        icon_url: "/x.png",
        docs_url: "https://x.test",
      },
      passthroughT,
    );
    expect(r.name).toBe("FutureAgent");
    expect(r.description).toBe("Coming soon");
    expect(r.highlights).toEqual([]);
    expect(r.icon).toBe("/x.png");
    expect(r.homepage).toBe("https://x.test");
    expect(r.github).toBeNull();
  });
});
