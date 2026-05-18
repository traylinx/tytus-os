import { describe, expect, it } from "vitest";
import { sanitizeVisibleAgentText } from "@/runtime/agent-chat";

describe("sanitizeVisibleAgentText", () => {
  it("redacts private network URLs and provider names", () => {
    const text =
      "Gateway http://10.42.42.1:18080/v1 uses MiniMax and DeepSeek.";
    const sanitized = sanitizeVisibleAgentText(text);

    expect(sanitized).not.toContain("10.42.42.1");
    expect(sanitized).not.toMatch(/MiniMax|DeepSeek/i);
    expect(sanitized).toContain("[private gateway]");
    expect(sanitized).toMatch(/current model|private AI route/);
  });

  it("redacts bare IPv4 host details", () => {
    expect(
      sanitizeVisibleAgentText("reachable at 31.70.91.72:8080"),
    ).not.toContain("31.70.91.72");
  });

  it("redacts secondary provider names used by pod gateways", () => {
    const sanitized = sanitizeVisibleAgentText(
      "Xiaomi MiMo, Qwen, Alibaba and Nous Research are internal routes.",
    );
    expect(sanitized).not.toMatch(/Xiaomi|MiMo|Qwen|Alibaba|Nous Research/i);
  });
});
