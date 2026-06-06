import { describe, expect, it } from "vitest";
import type { Agent, IncludedPod } from "@/types/daemon";
import {
  buildShareTargets,
  buildSharedPodOptions,
  formatShareTargetsForPods,
  provisionedShareTargetIds,
  selectedTargetPodIds,
  unprovisionedSharedPodOptions,
} from "./fileManagerSharing";

const agent = (overrides: Partial<Agent>): Agent =>
  ({
    agent_type: "nemoclaw",
    pod_id: "01",
    display_label: "Lisa",
    api_url: "https://example.invalid/v1",
    public_url: "https://example.invalid",
    ui_url: null,
    units: 1,
    user_key: "sk-test",
    ...overrides,
  }) as Agent;

const included = (overrides: Partial<IncludedPod>): IncludedPod =>
  ({
    endpoint: "http://10.42.42.1:18080",
    kind: "ail",
    pod_id: "02",
    public_url: "https://example.invalid",
    user_key: "sk-test",
    ...overrides,
  }) as IncludedPod;

describe("buildSharedPodOptions", () => {
  it("groups agent pods and excludes included AIL pods from share provisioning", () => {
    const options = buildSharedPodOptions(
      [
        agent({ pod_id: "01", display_label: "Lisa" }),
        agent({ pod_id: "01", display_label: "Claus" }),
        agent({ pod_id: "01", agent_type: "hermes", display_label: "Hermie" }),
      ],
      [included({ pod_id: "02", display_label: "AIL gateway 02" })],
    );

    expect(options.map((o) => o.podId)).toEqual(["01"]);
    expect(options[0]?.label).toBe("Pod 01 — Lisa, Claus, Hermie");
    expect(options[0]?.details).toContain("OpenClaw");
    expect(options[0]?.details).toContain("Hermes");
  });

  it("detects unprovisioned options with wannolot-prefixed sidecar ids", () => {
    const options = buildSharedPodOptions(
      [agent({ pod_id: "01", display_label: "Lisa" })],
      [included({ pod_id: "02" })],
    );

    expect(
      unprovisionedSharedPodOptions(["wannolot-01"], options).map(
        (o) => o.podId,
      ),
    ).toEqual([]);
  });
});

describe("buildShareTargets", () => {
  it("renders one checkbox target per named agent and marks AIL-only runtimes unavailable", () => {
    const targets = buildShareTargets(
      [
        agent({ pod_id: "01", route_id: "lisa", display_label: "Lisa" }),
        agent({ pod_id: "01", route_id: "claus", display_label: "Claus" }),
        agent({
          pod_id: "01",
          route_id: "hermie",
          agent_type: "hermes",
          display_label: "Hermie",
        }),
      ],
      [included({ pod_id: "02", route_id: "ail-02", display_label: "Pod 02" })],
    );

    expect(targets.map((target) => target.label)).toEqual([
      "Claus",
      "Hermie",
      "Lisa",
      "Pod 02",
    ]);
    expect(targets.map((target) => target.podId)).toEqual([
      "01",
      "01",
      "01",
      "02",
    ]);
    expect(targets[0]?.shareCapable).toBe(true);
    expect(targets[3]?.shareCapable).toBe(false);
  });

  it("serializes selected agent targets to deduped physical pod ids for daemon calls", () => {
    const targets = buildShareTargets([
      agent({ pod_id: "01", route_id: "lisa", display_label: "Lisa" }),
      agent({ pod_id: "01", route_id: "claus", display_label: "Claus" }),
      agent({ pod_id: "03", route_id: "vega", display_label: "Vega" }),
    ]);

    expect(
      selectedTargetPodIds(new Set([targets[0]!.targetId, targets[1]!.targetId]), targets),
    ).toEqual(["01"]);
  });

  it("maps legacy sidecar provisioned pod ids back to all agent labels", () => {
    const targets = buildShareTargets([
      agent({ pod_id: "01", route_id: "lisa", display_label: "Lisa" }),
      agent({ pod_id: "01", route_id: "claus", display_label: "Claus" }),
      agent({
        pod_id: "01",
        route_id: "hermie",
        agent_type: "hermes",
        display_label: "Hermie",
      }),
    ]);

    const provisioned = provisionedShareTargetIds(["wannolot-01"], targets);

    expect(provisioned.size).toBe(3);
    expect(provisioned.has(targets[0]!.targetId)).toBe(true);
    expect(formatShareTargetsForPods(["wannolot-01"], targets)).toBe(
      "Claus, Hermie, Lisa",
    );
  });

  it("uses v2 target records for per-agent shared-folder policy", () => {
    const targets = buildShareTargets([
      agent({ pod_id: "01", route_id: "lisa", display_label: "Lisa" }),
      agent({ pod_id: "01", route_id: "claus", display_label: "Claus" }),
      agent({
        pod_id: "01",
        route_id: "hermie",
        agent_type: "hermes",
        display_label: "Hermie",
      }),
    ]);

    const selected = provisionedShareTargetIds(["wannolot-01"], targets, [
      { runtime_id: "01", labels: ["Hermie"], enabled: true },
    ]);

    expect(Array.from(selected)).toEqual([targets[1]!.targetId]);
    expect(
      formatShareTargetsForPods(["wannolot-01"], targets, [
        { runtime_id: "01", labels: ["Hermie"], enabled: true },
      ]),
    ).toBe("Hermie");
  });
});
