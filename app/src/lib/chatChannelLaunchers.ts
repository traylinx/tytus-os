// Web/app launcher URLs for messenger channels. Used by the Chat app to
// surface "Open <Telegram|Discord|Slack|…>" buttons next to the per-pod
// landing.
//
// These open the messenger itself (web client), not a deep-link into the
// pod's specific bot — the daemon doesn't expose the bot username, so a
// bot-deep-link would be guesswork. Once the user is in the messenger
// they navigate to the conversation with their bot the normal way.

export interface ChannelLauncher {
  /** Display label, lowercase channel id (matches ChannelOption.name). */
  id: string;
  /** Human-readable label, e.g. "Telegram". Falls back to capitalised id. */
  label: string;
  /** Web URL that opens the messenger. Null when the channel has no
   * canonical web client (e.g. iMessage). */
  webUrl: string | null;
  /** Lucide icon name (rendered by the consumer, kept as a string here so
   * this lib stays free of React imports). */
  icon: string;
}

const REGISTRY: Record<string, Omit<ChannelLauncher, "id">> = {
  telegram: {
    label: "Telegram",
    webUrl: "https://web.telegram.org/",
    icon: "Send",
  },
  discord: {
    label: "Discord",
    webUrl: "https://discord.com/app",
    icon: "MessageCircle",
  },
  slack: {
    label: "Slack",
    webUrl: "https://app.slack.com/",
    icon: "Hash",
  },
  whatsapp: {
    label: "WhatsApp",
    webUrl: "https://web.whatsapp.com/",
    icon: "MessageSquare",
  },
  line: {
    label: "LINE",
    webUrl: "https://line.me/",
    icon: "MessageCircle",
  },
  imessage: {
    label: "iMessage",
    webUrl: null,
    icon: "MessageSquare",
  },
  matrix: {
    label: "Matrix",
    webUrl: "https://app.element.io/",
    icon: "Hash",
  },
  signal: {
    label: "Signal",
    webUrl: "https://signal.org/download/",
    icon: "MessageCircle",
  },
};

const titleCase = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);

export const getChannelLauncher = (channelId: string): ChannelLauncher => {
  const lower = channelId.toLowerCase();
  const entry = REGISTRY[lower];
  return {
    id: lower,
    label: entry?.label ?? titleCase(channelId),
    webUrl: entry?.webUrl ?? null,
    icon: entry?.icon ?? "MessageCircle",
  };
};
