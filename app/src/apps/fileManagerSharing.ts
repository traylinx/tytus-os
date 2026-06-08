import type { Agent, IncludedPod } from "@/types/daemon";

export interface PodProvisionOption {
  podId: string;
  label: string;
  details: string;
}

export interface ShareTargetOption {
  targetId: string;
  /** DAM-local runtime id, e.g. "01". Not globally unique. */
  podId: string;
  /** Opaque route id. Unique selector for modern multi-route fleets. */
  routeId?: string;
  /** Selector to send to tray/provision helpers. Prefer routeId over podId. */
  provisionSelector: string;
  label: string;
  details: string;
  kind: "agent" | "included";
  shareCapable: boolean;
  disabledReason?: string;
  agentLabels?: string[];
}

export interface SharedFolderTargetRecord {
  runtime_id: string;
  route_id?: string;
  provision_selector?: string;
  kind?: string;
  labels?: string[];
  target_id?: string;
  enabled?: boolean;
}

const displayAgentType = (agentType: string | null | undefined): string => {
  if (!agentType) return "agent";
  if (agentType === "nemoclaw" || agentType === "openclaw") return "OpenClaw";
  if (agentType === "hermes") return "Hermes";
  return agentType;
};

const normalizeSharingPodId = (pod: string): string =>
  pod.trim().replace(/^(wannolot|tytus)-/, "");

const targetSort = (a: ShareTargetOption, b: ShareTargetOption): number => {
  if (a.kind !== b.kind) return a.kind === "agent" ? -1 : 1;
  const labelCmp = a.label.localeCompare(b.label, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (labelCmp !== 0) return labelCmp;
  return a.podId.localeCompare(b.podId, undefined, { numeric: true });
};

const safeTargetSlug = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "agent";
};

export const buildShareTargets = (
  agents: readonly Agent[],
  included: readonly IncludedPod[] = [],
): ShareTargetOption[] => {
  const targets: ShareTargetOption[] = [];

  for (const agent of agents) {
    if (!agent.pod_id) continue;
    const agentType = displayAgentType(agent.agent_type);
    if (agentType === "agent") continue;
    const label =
      agent.display_name?.trim() ||
      agent.display_label?.trim() ||
      `Pod ${agent.pod_id}`;
    const route =
      (agent as { route_id?: string | null }).route_id?.trim() ||
      safeTargetSlug(label);
    const provisionSelector = route || agent.pod_id;
    const shortRoute = route && route !== agent.pod_id ? ` · route ${route}` : "";
    targets.push({
      targetId: `agent:${agent.pod_id}:${route}:${safeTargetSlug(label)}`,
      podId: agent.pod_id,
      routeId: route,
      provisionSelector,
      label,
      // Do not expose the DAM-local runtime id in the user-facing target row.
      // Multiple real agents can all report pod_id=01; showing that here makes
      // Lisa/Claus/Hermie look broken even though route_id is the unique
      // selector used by provisioning.
      details: `${agentType}${shortRoute}`,
      kind: "agent",
      shareCapable: true,
      agentLabels: [label],
    });
  }

  for (const pod of included) {
    if (!pod.pod_id) continue;
    if (pod.kind === "ail") {
      targets.push({
        targetId: `included:${pod.pod_id}:ail`,
        podId: pod.pod_id,
        routeId: pod.route_id?.trim() || undefined,
        provisionSelector: pod.route_id?.trim() || pod.pod_id,
        label: pod.display_label?.trim() || `Pod ${pod.pod_id}`,
        details: `AIL gateway · pod ${pod.pod_id} · not share-capable`,
        kind: "included",
        shareCapable: false,
        disabledReason:
          "AIL gateway has no Tytus workspace container for shared folders.",
      });
      continue;
    }
    const label = pod.display_label?.trim() || `Pod ${pod.pod_id}`;
    targets.push({
      targetId: `included:${pod.pod_id}:${safeTargetSlug(label)}`,
      podId: pod.pod_id,
      routeId: pod.route_id?.trim() || undefined,
      provisionSelector: pod.route_id?.trim() || pod.pod_id,
      label,
      details: pod.route_id ? `route ${pod.route_id}` : "share-capable runtime",
      kind: "included",
      shareCapable: true,
      agentLabels: [label],
    });
  }

  return targets.sort(targetSort);
};

export const selectedTargetPodIds = (
  selectedTargetIds: ReadonlySet<string>,
  targets: readonly ShareTargetOption[],
): string[] => {
  const podIds = new Set<string>();
  for (const target of targets) {
    if (target.shareCapable && selectedTargetIds.has(target.targetId)) {
      podIds.add(normalizeSharingPodId(target.provisionSelector));
    }
  }
  return Array.from(podIds).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
};

export const provisionedShareTargetIds = (
  provisionedPods: readonly string[],
  targets: readonly ShareTargetOption[],
  targetRecords: readonly SharedFolderTargetRecord[] = [],
): Set<string> => {
  const provisionedIds = new Set(provisionedPods.map(normalizeSharingPodId));
  const selected = new Set<string>();

  const explicitRecords = targetRecords.filter((record) => {
    if (record.enabled === false) return false;
    return (
      typeof record.target_id === "string" ||
      (Array.isArray(record.labels) && record.labels.length > 0)
    );
  });
  if (explicitRecords.length > 0) {
    for (const record of explicitRecords) {
      const runtimeId = normalizeSharingPodId(record.runtime_id);
      const labelSet = new Set(
        (record.labels ?? []).map((label) => label.trim()).filter(Boolean),
      );
      for (const target of targets) {
        if (normalizeSharingPodId(target.podId) !== runtimeId) continue;
        if (record.target_id === target.targetId) {
          selected.add(target.targetId);
          continue;
        }
        if (record.route_id && target.routeId === record.route_id) {
          selected.add(target.targetId);
          continue;
        }
        if (record.provision_selector && target.provisionSelector === record.provision_selector) {
          selected.add(target.targetId);
          continue;
        }
        if (labelSet.has(target.label)) selected.add(target.targetId);
      }
    }
    return selected;
  }

  for (const target of targets) {
    if (
      provisionedIds.has(normalizeSharingPodId(target.provisionSelector)) ||
      provisionedIds.has(normalizeSharingPodId(target.podId))
    ) {
      selected.add(target.targetId);
    }
  }
  return selected;
};

export const formatShareTargetsForPods = (
  provisionedPods: readonly string[],
  targets: readonly ShareTargetOption[],
  targetRecords: readonly SharedFolderTargetRecord[] = [],
): string => {
  const provisionedIds = provisionedShareTargetIds(
    provisionedPods,
    targets,
    targetRecords,
  );
  const labels = targets
    .filter((target) => provisionedIds.has(target.targetId))
    .map((target) => target.label);
  if (labels.length > 0) return labels.join(", ");
  const fallback = provisionedPods
    .map(normalizeSharingPodId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return fallback.length > 0 ? fallback.join(", ") : "(none)";
};

/**
 * Build the pod list used by shared-folder provisioning controls.
 *
 * Important: shared folders are provisioned per physical pod/runtime, not per
 * agent route. `state.agents` only covers agent pods. Included AIL gateways
 * live in `state.included`, but the same backend provision endpoint accepts
 * them too. Omitting included pods is why a new share could only target pod 01.
 */
export const buildSharedPodOptions = (
  agents: readonly Agent[],
  included: readonly IncludedPod[] = [],
): PodProvisionOption[] => {
  const byPod = new Map<
    string,
    { labels: string[]; capabilityTypes: Set<string> }
  >();

  const ensure = (podId: string) => {
    const current = byPod.get(podId) ?? {
      labels: [],
      capabilityTypes: new Set<string>(),
    };
    byPod.set(podId, current);
    return current;
  };

  for (const agent of agents) {
    if (!agent.pod_id) continue;
    const agentType = displayAgentType(agent.agent_type);
    if (agentType === "agent") continue;
    const current = ensure(agent.pod_id);
    const label = agent.display_label?.trim() || `Pod ${agent.pod_id}`;
    if (!current.labels.includes(label)) current.labels.push(label);
    current.capabilityTypes.add(agentType);
  }

  for (const pod of included) {
    if (!pod.pod_id) continue;
    if (pod.kind === "ail") continue;
    const current = ensure(pod.pod_id);
    const label = pod.display_label?.trim() || `AIL gateway ${pod.pod_id}`;
    if (!current.labels.includes(label)) current.labels.push(label);
    current.capabilityTypes.add("AIL gateway");
  }

  return Array.from(byPod.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([podId, info]) => ({
      podId,
      label:
        info.labels.length === 1
          ? info.labels[0]!
          : `Pod ${podId} — ${info.labels.join(", ")}`,
      details: `${Array.from(info.capabilityTypes).join(" + ")} · one shared runtime`,
    }));
};

export const unprovisionedSharedPodOptions = (
  provisionedPods: readonly string[],
  options: readonly PodProvisionOption[],
): PodProvisionOption[] => {
  const provisionedIds = new Set(provisionedPods.map(normalizeSharingPodId));
  return options.filter((option) =>
    !provisionedIds.has(normalizeSharingPodId(option.podId)),
  );
};
