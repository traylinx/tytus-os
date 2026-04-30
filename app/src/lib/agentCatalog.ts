// ============================================================
// Agent catalog display data — single source of truth.
// ============================================================
//
// The Provider catalog (`/api/catalog`) stays minimal/API-shaped for
// non-UI consumers. Anywhere we render a card (Settings → Agents,
// Chat → per-pod landing) we enrich it with marketing display copy
// driven through the i18n layer so language packs can localise the
// strings without forking the table.
//
// Tagline / description / highlights are i18n keys; everything else
// (icons, links, port numbers — facts, not prose) lives here as
// literals.

import type { AgentType } from "@/types/daemon";

export interface AgentDisplay {
  icon: string;
  homepage?: string;
  github?: string;
  /** i18n key for the marketing tagline. */
  taglineKey: string;
  /** i18n key for the long description paragraph. */
  descriptionKey: string;
  /** i18n keys for the bullet highlights (rendered as a list). */
  highlightKeys: string[];
}

export const AGENT_DISPLAY: Record<AgentType, AgentDisplay> = {
  nemoclaw: {
    icon: "/agents/openclaw.svg",
    homepage: "https://openclaw.ai/",
    github: "https://github.com/openclaw/openclaw",
    taglineKey: "agents.openclaw.tagline",
    descriptionKey: "agents.openclaw.description",
    highlightKeys: [
      "agents.openclaw.highlight.0",
      "agents.openclaw.highlight.1",
      "agents.openclaw.highlight.2",
      "agents.openclaw.highlight.3",
    ],
  },
  hermes: {
    icon: "/agents/hermes.svg",
    homepage: "https://hermes-agent.nousresearch.com/",
    github: "https://github.com/NousResearch/hermes-agent",
    taglineKey: "agents.hermes.tagline",
    descriptionKey: "agents.hermes.description",
    highlightKeys: [
      "agents.hermes.highlight.0",
      "agents.hermes.highlight.1",
      "agents.hermes.highlight.2",
      "agents.hermes.highlight.3",
    ],
  },
};

/** Resolve display copy for an agent type, falling back to catalog data. */
export interface ResolvedAgentDisplay {
  name: string;
  tagline: string;
  description: string;
  highlights: string[];
  icon: string | null;
  homepage: string | null;
  github: string | null;
}

export const resolveAgentDisplay = (
  agentType: string,
  catalogFallback: {
    name?: string;
    tagline?: string;
    description?: string;
    icon_url?: string;
    docs_url?: string;
  } | null,
  t: (key: string) => string,
): ResolvedAgentDisplay => {
  const override = AGENT_DISPLAY[agentType as AgentType];
  if (!override) {
    return {
      name: catalogFallback?.name ?? agentType,
      tagline: catalogFallback?.tagline ?? "",
      description: catalogFallback?.description ?? "",
      highlights: [],
      icon: catalogFallback?.icon_url ?? null,
      homepage: catalogFallback?.docs_url ?? null,
      github: null,
    };
  }
  // i18n `t` returns the key itself when missing; treat that as "no copy"
  // so we fall back to the API-shaped catalog string instead of leaking
  // the dotted key into the UI.
  const tr = (key: string, fallback: string): string => {
    const v = t(key);
    return v && v !== key ? v : fallback;
  };
  return {
    name: tr(`agents.${agentType}.name`, catalogFallback?.name ?? agentType),
    tagline: tr(override.taglineKey, catalogFallback?.tagline ?? ""),
    description: tr(
      override.descriptionKey,
      catalogFallback?.description ?? "",
    ),
    highlights: override.highlightKeys
      .map((k) => tr(k, ""))
      .filter((s) => s.length > 0),
    icon: override.icon ?? catalogFallback?.icon_url ?? null,
    homepage: override.homepage ?? catalogFallback?.docs_url ?? null,
    github: override.github ?? null,
  };
};
