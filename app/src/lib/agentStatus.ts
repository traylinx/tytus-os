// ============================================================
// agentStatus — server-derived → UI presentation mapping
// ============================================================
//
// Phase 2 of TytusOS Remaining (cont.) sprint. The daemon now emits
// `state.agents[].status: AgentStatus` directly (≥ 0.7.0). The
// rendering surfaces (Pod Inspector + Settings PodCard) historically
// derived a 5-state ReadyState from `/api/pod/ready` polling. This
// module bridges the two so we can drop the per-pod /api/pod/ready
// HTTP traffic for new daemons without rewriting the UI components.
//
// Old daemons keep working: when `agent.status` is undefined, the
// caller falls back to its existing /api/pod/ready probe loop.

import type { AgentStatus } from "@/types/daemon";

export type ReadyVisualState =
  | "ready"
  | "starting"
  | "unhealthy"
  | "stopped"
  | "unknown";

export interface ReadyVisual {
  /** Single-token status the UI maps to a color. */
  state: ReadyVisualState;
  /** Long-form label for the status pill (e.g. "Running", "Booting"). */
  label: string;
  /** Diagnostic line; blank when there's nothing extra to show. */
  reason?: string;
  /** Whether the daemon considers the pod healthy enough to use. */
  ready: boolean;
}

export const READY_COLORS: Record<ReadyVisualState, string> = {
  ready: "#4CAF50",
  starting: "#FFC107",
  unhealthy: "#F44336",
  stopped: "#F44336",
  unknown: "#9E9E9E",
};

const VISUAL: Record<AgentStatus, ReadyVisual> = {
  ready: { state: "ready", label: "Running", ready: true },
  starting: {
    state: "starting",
    label: "Starting",
    ready: false,
    reason: "Pod is booting or edge auth not yet propagated",
  },
  unhealthy: {
    state: "unhealthy",
    label: "Unhealthy",
    ready: false,
    reason: "Gateway answering but upstream is failing",
  },
  stopped: {
    state: "stopped",
    label: "Offline",
    ready: false,
    reason: "Pod gateway unreachable (container may be down)",
  },
  unknown: {
    state: "unknown",
    label: "Probing",
    ready: false,
    reason: "Status not yet observed",
  },
};

/**
 * Map a server-derived `AgentStatus` to the UI-friendly visual.
 * Stable mapping — UI components depend on the `state` token for
 * conditional rendering (e.g. dock dot tint, sort order).
 */
export const visualForAgentStatus = (s: AgentStatus): ReadyVisual =>
  VISUAL[s] ?? VISUAL.unknown;
