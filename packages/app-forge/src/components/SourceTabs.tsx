import type { ForgeCard } from '../repo/forgeRepo';
import { KIND_LABEL } from '../forgeConstants';
import { iconForKind } from '../forgeUtils';
import { styles } from '../forgeStyles';

interface SourceTabsProps {
  cards: ForgeCard[];
  selectedCard: ForgeCard | null;
  onSelect: (cardId: string) => void;
}

export function SourceTabs({ cards, selectedCard, onSelect }: SourceTabsProps) {
  if (!selectedCard) {
    return <div style={styles.tabBar}><div style={styles.activeTab}>No source selected</div></div>;
  }

  return (
    <div style={styles.tabBar} role="tablist" aria-label="Open source cards">
      {cards.slice(0, 8).map((card) => {
        const active = card.id === selectedCard.id;
        return (
          <button
            key={card.id}
            type="button"
            role="tab"
            aria-selected={active}
            style={{ ...styles.sourceTab, ...(active ? styles.sourceTabActive : {}) }}
            onClick={() => onSelect(card.id)}
            title={`${card.title || KIND_LABEL[card.kind]} · ${KIND_LABEL[card.kind]}`}
          >
            {iconForKind(card.kind)}
            <span style={styles.sourceTabTitle}>{card.title || KIND_LABEL[card.kind]}</span>
          </button>
        );
      })}
      {cards.length > 8 && <span style={styles.tabMeta}>+{cards.length - 8} more</span>}
      <span style={styles.tabMeta}>{KIND_LABEL[selectedCard.kind]} · {selectedCard.content.length} chars</span>
    </div>
  );
}
