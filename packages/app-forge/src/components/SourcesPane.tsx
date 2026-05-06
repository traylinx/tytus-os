import { useRef } from 'react';
import { FilePlus2, Files, Flag, FolderOpen, Plus, Search } from 'lucide-react';
import type { ForgeCard, ForgeWorkspace } from '../repo/forgeRepo';
import type { ForgeQuest } from '../forgeConstants';
import type { ForgeCardKind } from '../repo/forgeRepo';
import { CARD_KINDS, KIND_LABEL, QUESTS } from '../forgeConstants';
import { iconForKind } from '../forgeUtils';
import { styles } from '../forgeStyles';
import { PaneHeader } from './PaneHeader';

interface SourcesPaneProps {
  cards: ForgeCard[];
  busy: boolean;
  workspaces: ForgeWorkspace[];
  activeWorkspaceId: string | null;
  activeWorkspace: ForgeWorkspace | null;
  selectedCard: ForgeCard | null;
  filteredCards: ForgeCard[];
  sourceFilter: string;
  setSourceFilter: (value: string) => void;
  setActiveWorkspaceId: (id: string) => void;
  setSelectedCardId: (id: string) => void;
  createQuest: (quest?: ForgeQuest) => Promise<void>;
  draft: string;
  setDraft: (value: string) => void;
  addCard: (kind: ForgeCardKind) => Promise<void>;
  importFiles: (files: FileList | File[]) => Promise<void>;
}

export function SourcesPane({
  cards,
  busy,
  workspaces,
  activeWorkspaceId,
  activeWorkspace,
  selectedCard,
  filteredCards,
  sourceFilter,
  setSourceFilter,
  setActiveWorkspaceId,
  setSelectedCardId,
  createQuest,
  draft,
  setDraft,
  addCard,
  importFiles,
}: SourcesPaneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <aside style={styles.sourcesPane}>
      <PaneHeader title="Explorer" count={cards.length} />

      <div style={styles.explorerActions}>
        <button style={styles.primaryButton} disabled={busy} onClick={() => createQuest(QUESTS[0])}>
          <Plus size={14} /> New notebook
        </button>
        <button style={styles.explorerButton} disabled={busy} onClick={() => fileInputRef.current?.click()}>
          <FilePlus2 size={14} /> Open file
        </button>
        <button style={styles.explorerButton} disabled={busy} onClick={() => folderInputRef.current?.click()}>
          <FolderOpen size={14} /> Open folder
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files) void importFiles(files);
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: '', directory: '' }}
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files) void importFiles(files);
          e.currentTarget.value = '';
        }}
      />

      <div style={styles.searchBox}>
        <Search size={13} />
        <input
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          placeholder="Search files and sources"
          style={styles.searchInput}
        />
      </div>

      <details style={styles.explorerDetails}>
        <summary style={styles.detailsSummary}>Scratch source</summary>
        <section style={styles.sidebarComposer}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste notes, JSON, code, meeting chaos…"
            style={styles.sidebarComposerInput}
          />
          <div style={styles.sidebarComposerActions}>
            {CARD_KINDS.map((item) => (
              <button key={item.kind} style={styles.compactButton} disabled={!activeWorkspace || busy} onClick={() => addCard(item.kind)}>
                {iconForKind(item.kind)} {item.label}
              </button>
            ))}
          </div>
        </section>
      </details>

      <div style={styles.sectionTitle}>Notebooks</div>
      <div style={styles.workspaceList}>
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            style={{ ...styles.workspaceButton, ...(workspace.id === activeWorkspaceId ? styles.workspaceButtonActive : {}) }}
            onClick={() => setActiveWorkspaceId(workspace.id)}
          >
            <Flag size={13} />
            <span style={styles.workspaceName}>{workspace.title}</span>
          </button>
        ))}
        {workspaces.length === 0 && <div style={styles.muted}>Open a file/folder or create a notebook.</div>}
      </div>

      <details style={styles.explorerDetails}>
        <summary style={styles.detailsSummary}>Templates</summary>
        <div style={styles.questGrid}>
          {QUESTS.map((quest) => {
            const Icon = quest.icon;
            return (
              <button key={quest.mode} style={styles.questButton} onClick={() => createQuest(quest)} disabled={busy}>
                <Icon size={14} />
                <span style={styles.questText}>
                  <span style={styles.questTitle}>{quest.title}</span>
                  <span style={styles.questGoal}>{quest.goal}</span>
                </span>
              </button>
            );
          })}
        </div>
      </details>

      <div style={styles.sectionTitle}><Files size={12} /> Source tree</div>
      <div style={styles.sourceList}>
        {filteredCards.map((card) => (
          <button
            key={card.id}
            style={{ ...styles.sourceItem, ...(card.id === selectedCard?.id ? styles.sourceItemActive : {}) }}
            onClick={() => setSelectedCardId(card.id)}
          >
            {iconForKind(card.kind)}
            <span style={styles.sourceName}>{card.title || KIND_LABEL[card.kind]}</span>
            <span style={styles.sourceKind}>{KIND_LABEL[card.kind]}</span>
          </button>
        ))}
        {activeWorkspace && cards.length === 0 && <div style={styles.muted}>No sources yet. Open a file or folder.</div>}
      </div>
    </aside>
  );
}
