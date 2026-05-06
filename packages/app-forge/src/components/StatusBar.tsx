import type { ForgeCard, ForgeOutput, ForgeWorkspace } from '../repo/forgeRepo';
import { KIND_LABEL } from '../forgeConstants';
import { styles } from '../forgeStyles';

interface StatusBarProps {
  workspace: ForgeWorkspace | null;
  selectedCard: ForgeCard | null;
  cards: ForgeCard[];
  outputs: ForgeOutput[];
  busy: boolean;
}

export function StatusBar({ workspace, selectedCard, cards, outputs, busy }: StatusBarProps) {
  return (
    <footer style={styles.statusBar} aria-label="Forge status">
      <span style={styles.statusAccent}>{busy ? 'Forging…' : 'Ready'}</span>
      <span style={styles.statusItem}>{workspace ? workspace.mode : 'no workspace'}</span>
      <span style={styles.statusItem}>{cards.length} sources</span>
      <span style={styles.statusItem}>{outputs.length} outputs</span>
      <span style={styles.statusItem}>{selectedCard ? KIND_LABEL[selectedCard.kind] : 'no source'}</span>
      <span style={styles.statusSpacer} />
      <span style={styles.statusItem}>Local-first · SQLite-backed</span>
    </footer>
  );
}
