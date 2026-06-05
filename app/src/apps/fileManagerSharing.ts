import type { Agent, IncludedPod } from "@/types/daemon";

export interface PodProvisionOption {
  podId: string;
  label: string;
  details: string;
}

const displayAgentType = (agentType: string | null | undefined): string => {
  if (!agentType) return "agent";
  if (agentType === "nemoclaw" || agentType === "openclaw") return "OpenClaw";
  if (agentType === "hermes") return "Hermes";
  return agentType;
};

const normalizeSharingPodId = (pod: string): string =>
  pod.trim().replace(/^(wannolot|tytus)-/, "");

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
