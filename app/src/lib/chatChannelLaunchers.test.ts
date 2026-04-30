import { describe, it, expect } from "vitest";
import { getChannelLauncher } from "./chatChannelLaunchers";

describe("getChannelLauncher", () => {
  it("resolves canonical channels with their web URLs", () => {
    expect(getChannelLauncher("telegram")).toEqual({
      id: "telegram",
      label: "Telegram",
      webUrl: "https://web.telegram.org/",
      icon: "Send",
    });
    expect(getChannelLauncher("DISCORD").webUrl).toBe(
      "https://discord.com/app",
    );
  });

  it("returns null webUrl for channels without a canonical web client", () => {
    const r = getChannelLauncher("imessage");
    expect(r.label).toBe("iMessage");
    expect(r.webUrl).toBeNull();
  });

  it("falls back to title-cased label for unknown channels", () => {
    const r = getChannelLauncher("rocketchat");
    expect(r.label).toBe("Rocketchat");
    expect(r.webUrl).toBeNull();
    expect(r.icon).toBe("MessageCircle");
  });
});
