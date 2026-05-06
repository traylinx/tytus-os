import { Layers3, Trash2 } from 'lucide-react';
import type { ForgeCard, ForgeOutput, ForgeWorkspace } from '../repo/forgeRepo';
import type { StudioActionKey } from '../recipes/studyPack';
import { KIND_LABEL, outputTone, STUDIO_ACTIONS } from '../forgeConstants';
import { tighten } from '../forgeUtils';
import { styles } from '../forgeStyles';
import { PaneHeader } from './PaneHeader';
import { AgentChatPane } from './AgentChatPane';

interface StudioPaneProps {
  activeWorkspace: ForgeWorkspace | null;
  selectedCard: ForgeCard | null;
  outputs: ForgeOutput[];
  groupedOutputs: Map<string, ForgeOutput[]>;
  busy: boolean;
  runStudioAction: (action: StudioActionKey) => Promise<void>;
  clearOutputShelf: () => Promise<void>;
  promoteOutputToCard: (output: ForgeOutput) => Promise<void>;
  runRecipe: () => Promise<void>;
  saveSelected: (patch: Partial<Pick<ForgeCard, 'title' | 'content' | 'kind'>>) => Promise<void>;
  deleteSelected: () => Promise<void>;
  chatPrompt: string;
  setChatPrompt: (value: string) => void;
  askForge: () => Promise<void>;
}

export function StudioPane({
  activeWorkspace,
  selectedCard,
  outputs,
  groupedOutputs,
  busy,
  runStudioAction,
  clearOutputShelf,
  promoteOutputToCard,
  runRecipe,
  saveSelected,
  deleteSelected,
  chatPrompt,
  setChatPrompt,
  askForge,
}: StudioPaneProps) {
  return (
    <aside style={styles.studioPane}>
      <PaneHeader title="Studio" count={outputs.length} />
      <div style={styles.studioGrid}>
        {STUDIO_ACTIONS.map((action) => {
          const Icon = action.icon;
          const count = groupedOutputs.get(action.key)?.length ?? 0;
          return (
            <button key={action.key} style={styles.studioTile} onClick={() => runStudioAction(action.key)} disabled={!activeWorkspace || busy}>
              <Icon size={16} />
              <span style={styles.studioTileText}>
                <span style={styles.studioTileTitle}>{action.label}</span>
                <span style={styles.studioTileHint}>{count > 0 ? `${count} generated` : action.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <AgentChatPane
        chatPrompt={chatPrompt}
        setChatPrompt={setChatPrompt}
        askForge={askForge}
        disabled={!activeWorkspace}
        busy={busy}
      />

      <div style={styles.outputHeader}>
        <div style={styles.panelTitleNoMargin}>Outputs</div>
        {outputs.length > 0 && <button style={styles.ghostButton} onClick={clearOutputShelf} disabled={busy}>Clear</button>}
      </div>
      <div style={styles.outputList}>
        {outputs.map((output) => (
          <section key={output.id} style={{ ...styles.outputCard, borderLeftColor: outputTone[output.kind] ?? 'var(--accent-primary)' }}>
            <div style={styles.outputTitle}>{output.title}</div>
            <pre style={styles.outputPre}>{output.content}</pre>
            <button style={styles.outputAction} onClick={() => promoteOutputToCard(output)} disabled={busy}>Use as source</button>
          </section>
        ))}
        {outputs.length === 0 && <div style={styles.muted}>Run a recipe or synthesize locally from the current sources.</div>}
      </div>

      <div style={styles.inspectorPanel}>
        <div style={styles.panelTitle}><Layers3 size={15} /> Inspector</div>
        {selectedCard ? (
          <>
            <div style={styles.metaLine}>{KIND_LABEL[selectedCard.kind]} · {selectedCard.content.length} chars</div>
            <button style={styles.actionButton} onClick={runRecipe} disabled={busy}>Make outputs from all sources</button>
            <button style={styles.actionButton} onClick={() => saveSelected({ content: tighten(selectedCard.content) })}>Tighten source text</button>
            <button style={styles.actionButton} onClick={() => saveSelected({ content: selectedCard.content + '\n\nTODO: decide next action.' })}>Add next-action prompt</button>
            <button style={styles.dangerButton} onClick={deleteSelected} disabled={busy}><Trash2 size={13} /> Delete source</button>
          </>
        ) : <div style={styles.muted}>No source selected.</div>}
      </div>
    </aside>
  );
}
