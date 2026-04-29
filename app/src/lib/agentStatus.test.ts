import { describe, expect, it } from "vitest";
import {
  READY_COLORS,
  visualForAgentStatus,
} from "@/lib/agentStatus";
import type { AgentStatus } from "@/types/daemon";

describe("visualForAgentStatus", () => {
  it("maps every defined AgentStatus to a stable visual token", () => {
    const all: AgentStatus[] = [
      "ready",
      "starting",
      "unhealthy",
      "stopped",
      "unknown",
    ];
    for (const s of all) {
      const v = visualForAgentStatus(s);
      expect(v.state).toBeDefined();
      expect(v.label).toBeTruthy();
      // ready bool is the canonical "is the pod usable?" signal
      expect(typeof v.ready).toBe("boolean");
    }
  });

  it("only 'ready' surfaces ready=true", () => {
    expect(visualForAgentStatus("ready").ready).toBe(true);
    expect(visualForAgentStatus("starting").ready).toBe(false);
    expect(visualForAgentStatus("unhealthy").ready).toBe(false);
    expect(visualForAgentStatus("stopped").ready).toBe(false);
    expect(visualForAgentStatus("unknown").ready).toBe(false);
  });

  it("maps to distinct colors for distinct states", () => {
    expect(READY_COLORS.ready).not.toBe(READY_COLORS.starting);
    expect(READY_COLORS.ready).not.toBe(READY_COLORS.unhealthy);
    expect(READY_COLORS.ready).not.toBe(READY_COLORS.unknown);
    // unhealthy + stopped intentionally share a color (both are red —
    // the user shouldn't have to distinguish them at a glance).
    expect(READY_COLORS.unhealthy).toBe(READY_COLORS.stopped);
  });

  it("falls back to 'unknown' for an unrecognized string", () => {
    // Defensive: serde could surface a future enum variant the OS
    // hasn't been rebuilt for. Don't crash; render as Probing.
    const v = visualForAgentStatus("brand-new-state" as AgentStatus);
    expect(v.state).toBe("unknown");
  });
});
