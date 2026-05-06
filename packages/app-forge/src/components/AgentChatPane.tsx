import { Bot, MessageSquareText } from 'lucide-react';
import { styles } from '../forgeStyles';

interface AgentChatPaneProps {
  chatPrompt: string;
  setChatPrompt: (value: string) => void;
  askForge: () => Promise<void>;
  disabled: boolean;
  busy: boolean;
}

export function AgentChatPane({ chatPrompt, setChatPrompt, askForge, disabled, busy }: AgentChatPaneProps) {
  return (
    <section style={styles.agentChatPanel}>
      <div style={styles.panelTitleNoMargin}><Bot size={15} /> Agent Chat</div>
      <div style={styles.agentChatHint}>Ask Forge to synthesize the open sources. Current build is local/deterministic until real pod AI is wired.</div>
      <div style={styles.agentChatInputRow}>
        <MessageSquareText size={14} style={{ color: 'var(--text-secondary)' }} />
        <input
          value={chatPrompt}
          onChange={(e) => setChatPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void askForge(); }}
          placeholder="Ask about open files…"
          style={styles.chatInput}
          disabled={disabled}
        />
        <button style={styles.chatButton} disabled={disabled || !chatPrompt.trim() || busy} onClick={askForge}>Send</button>
      </div>
    </section>
  );
}
