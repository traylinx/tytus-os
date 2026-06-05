import { describe, expect, it } from "vitest";
import type { Agent, IncludedPod } from "@/types/daemon";
import {
  buildSharedPodOptions,
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
  it("includes both agent pods and included AIL pods", () => {
    const options = buildSharedPodOptions(
      [
        agent({ pod_id: "01", display_label: "Lisa" }),
        agent({ pod_id: "01", display_label: "Claus" }),
        agent({ pod_id: "01", agent_type: "hermes", display_label: "Hermie" }),
      ],
      [included({ pod_id: "02", display_label: "AIL gateway 02" })],
    );

    expect(options.map((o) => o.podId)).toEqual(["01", "02"]);
    expect(options[0]?.label).toBe("Pod 01 — Lisa, Claus, Hermie");
    expect(options[0]?.details).toContain("OpenClaw");
    expect(options[0]?.details).toContain("Hermes");
    expect(options[1]).toMatchObject({
      podId: "02",
      label: "AIL gateway 02",
    });
    expect(options[1]?.details).toContain("AIL gateway");
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
    ).toEqual(["02"]);
  });
});
