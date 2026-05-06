import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppDb } from '@tytus/host-api';
import {
  clearOutputs,
  createCard,
  createOutput,
  createWorkspace,
  deleteCard,
  listCards,
  listOutputs,
  listWorkspaces,
  updateCard,
  type ForgeCard,
  type ForgeCardKind,
  type ForgeOutput,
  type ForgeWorkspace,
} from '../repo/forgeRepo';
import { outputsForMode, outputsForStudioAction, type StudioActionKey } from '../recipes/studyPack';
import type { ForgeQuest } from '../forgeConstants';
import { QUESTS } from '../forgeConstants';
import { defaultContent, draftTitle, synthesizeLocallyFromPrompt } from '../forgeUtils';


function kindForImportedFile(file: File): ForgeCardKind {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.csv') || name.endsWith('.tsv')) return 'table';
  if (/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|css|html|sh|sql|yaml|yml)$/.test(name)) return 'code';
  if (/\.(md|markdown|mdx)$/.test(name)) return 'markdown';
  return 'text';
}

function isReadableImport(file: File): boolean {
  if (file.size > 1_000_000) return false;
  if (file.type.startsWith('text/')) return true;
  return /\.(txt|md|markdown|mdx|json|csv|tsv|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|css|html|sh|sql|yaml|yml|toml|xml|log)$/i.test(file.name);
}

function importedFileTitle(file: File): string {
  const maybeWithPath = file as File & { webkitRelativePath?: string };
  return maybeWithPath.webkitRelativePath || file.name;
}

export function useForgeData(db: AppDb) {
  const [workspaces, setWorkspaces] = useState<ForgeWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [cards, setCards] = useState<ForgeCard[]>([]);
  const [outputs, setOutputs] = useState<ForgeOutput[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [chatPrompt, setChatPrompt] = useState('');

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );
  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) ?? cards[0] ?? null,
    [cards, selectedCardId],
  );
  const filteredCards = useMemo(() => {
    const q = sourceFilter.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => `${c.title}\n${c.content}`.toLowerCase().includes(q));
  }, [cards, sourceFilter]);

  const groupedOutputs = useMemo(() => {
    const map = new Map<string, ForgeOutput[]>();
    for (const output of outputs) {
      const list = map.get(output.kind) ?? [];
      list.push(output);
      map.set(output.kind, list);
    }
    return map;
  }, [outputs]);

  const reloadWorkspaces = useCallback(async () => {
    const next = await listWorkspaces(db);
    setWorkspaces(next);
    setActiveWorkspaceId((current) => current ?? next[0]?.id ?? null);
  }, [db]);

  const reloadWorkspaceData = useCallback(async (workspaceId: string | null) => {
    if (!workspaceId) {
      setCards([]);
      setOutputs([]);
      setSelectedCardId(null);
      return;
    }
    const [nextCards, nextOutputs] = await Promise.all([
      listCards(db, workspaceId),
      listOutputs(db, workspaceId),
    ]);
    setCards(nextCards);
    setOutputs(nextOutputs);
    setSelectedCardId((current) => current && nextCards.some((c) => c.id === current) ? current : nextCards[0]?.id ?? null);
  }, [db]);

  useEffect(() => {
    void reloadWorkspaces().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [reloadWorkspaces]);

  useEffect(() => {
    void reloadWorkspaceData(activeWorkspaceId).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [activeWorkspaceId, reloadWorkspaceData]);

  const ensureWorkspace = useCallback(async (): Promise<ForgeWorkspace> => {
    if (activeWorkspace) return activeWorkspace;
    const workspace = await createWorkspace(db, {
      title: 'Imported workspace',
      goal: 'Files and folders imported into Forge.',
      mode: 'work',
      metadata: { createdBy: 'file-import' },
    });
    await reloadWorkspaces();
    setActiveWorkspaceId(workspace.id);
    return workspace;
  }, [activeWorkspace, db, reloadWorkspaces]);

  const createQuest = useCallback(async (quest: ForgeQuest = QUESTS[0]) => {
    setBusy(true);
    setError(null);
    try {
      const workspace = await createWorkspace(db, {
        title: quest.title,
        goal: quest.goal,
        mode: quest.mode,
        metadata: { quest: quest.title },
      });
      const card = await createCard(db, {
        workspaceId: workspace.id,
        kind: 'markdown',
        title: 'Raw material',
        content: quest.seed,
        position: 1024,
      });
      await reloadWorkspaces();
      setActiveWorkspaceId(workspace.id);
      setSelectedCardId(card.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [db, reloadWorkspaces]);

  const addCard = useCallback(async (kind: ForgeCardKind) => {
    if (!activeWorkspace) return;
    setBusy(true);
    setError(null);
    try {
      const pos = cards.length > 0 ? Math.max(...cards.map((c) => c.position)) + 1024 : 1024;
      const card = await createCard(db, {
        workspaceId: activeWorkspace.id,
        kind,
        title: draftTitle(kind, draft),
        content: draft || defaultContent(kind),
        position: pos,
      });
      setDraft('');
      await reloadWorkspaceData(activeWorkspace.id);
      setSelectedCardId(card.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeWorkspace, cards, db, draft, reloadWorkspaceData]);

  const saveSelected = useCallback(async (patch: Partial<Pick<ForgeCard, 'title' | 'content' | 'kind'>>) => {
    if (!selectedCard || !activeWorkspace) return;
    setError(null);
    try {
      await updateCard(db, selectedCard.id, patch);
      await reloadWorkspaceData(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeWorkspace, db, reloadWorkspaceData, selectedCard]);

  const deleteSelected = useCallback(async () => {
    if (!selectedCard || !activeWorkspace) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCard(db, selectedCard.id);
      await reloadWorkspaceData(activeWorkspace.id);
      await reloadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeWorkspace, db, reloadWorkspaceData, reloadWorkspaces, selectedCard]);

  const clearOutputShelf = useCallback(async () => {
    if (!activeWorkspace) return;
    setBusy(true);
    setError(null);
    try {
      await clearOutputs(db, activeWorkspace.id);
      await reloadWorkspaceData(activeWorkspace.id);
      await reloadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeWorkspace, db, reloadWorkspaceData, reloadWorkspaces]);

  const promoteOutputToCard = useCallback(async (output: ForgeOutput) => {
    if (!activeWorkspace) return;
    setBusy(true);
    setError(null);
    try {
      const pos = cards.length > 0 ? Math.max(...cards.map((c) => c.position)) + 1024 : 1024;
      const card = await createCard(db, {
        workspaceId: activeWorkspace.id,
        kind: 'output',
        title: output.title,
        content: output.content,
        sourceCardIds: output.sourceCardIds,
        metadata: { promotedFromOutputId: output.id, outputKind: output.kind },
        position: pos,
      });
      await reloadWorkspaceData(activeWorkspace.id);
      await reloadWorkspaces();
      setSelectedCardId(card.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeWorkspace, cards, db, reloadWorkspaceData, reloadWorkspaces]);

  const runRecipe = useCallback(async () => {
    if (!activeWorkspace) return;
    setBusy(true);
    setError(null);
    try {
      const drafts = outputsForMode(activeWorkspace.mode, cards);
      for (const out of drafts) {
        await createOutput(db, {
          workspaceId: activeWorkspace.id,
          kind: out.kind,
          title: out.title,
          content: out.content,
          sourceCardIds: out.sourceCardIds,
        });
      }
      await reloadWorkspaceData(activeWorkspace.id);
      await reloadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeWorkspace, cards, db, reloadWorkspaceData, reloadWorkspaces]);

  const runStudioAction = useCallback(async (action: StudioActionKey) => {
    if (!activeWorkspace) return;
    setBusy(true);
    setError(null);
    try {
      const drafts = outputsForStudioAction(activeWorkspace.mode, cards, action);
      for (const out of drafts) {
        await createOutput(db, {
          workspaceId: activeWorkspace.id,
          kind: out.kind,
          title: out.title,
          content: out.content,
          sourceCardIds: out.sourceCardIds,
        });
      }
      await reloadWorkspaceData(activeWorkspace.id);
      await reloadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeWorkspace, cards, db, reloadWorkspaceData, reloadWorkspaces]);

  const importFiles = useCallback(async (incoming: FileList | File[]) => {
    const files = Array.from(incoming).filter(isReadableImport).slice(0, 80);
    if (files.length === 0) {
      setError('No readable text/code files selected. Binary files and files over 1 MB are skipped.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const workspace = await ensureWorkspace();
      const basePosition = cards.length > 0 ? Math.max(...cards.map((c) => c.position)) + 1024 : 1024;
      let firstCardId: string | null = null;
      for (const [index, file] of files.entries()) {
        const content = await file.text();
        const card = await createCard(db, {
          workspaceId: workspace.id,
          kind: kindForImportedFile(file),
          title: importedFileTitle(file),
          content,
          metadata: { source: 'file-import', fileName: file.name, size: file.size, type: file.type },
          position: basePosition + index * 1024,
        });
        firstCardId ??= card.id;
      }
      await reloadWorkspaceData(workspace.id);
      await reloadWorkspaces();
      if (firstCardId) setSelectedCardId(firstCardId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [cards, db, ensureWorkspace, reloadWorkspaceData, reloadWorkspaces]);

  const askForge = useCallback(async () => {
    if (!activeWorkspace || !chatPrompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createOutput(db, {
        workspaceId: activeWorkspace.id,
        kind: 'custom',
        title: `Local synthesis: ${chatPrompt.trim().slice(0, 42)}`,
        content: synthesizeLocallyFromPrompt(chatPrompt, cards),
        sourceCardIds: cards.map((c) => c.id),
      });
      setChatPrompt('');
      await reloadWorkspaceData(activeWorkspace.id);
      await reloadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeWorkspace, cards, chatPrompt, db, reloadWorkspaceData, reloadWorkspaces]);

  return {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeWorkspace,
    cards,
    outputs,
    selectedCard,
    setSelectedCardId,
    filteredCards,
    groupedOutputs,
    busy,
    error,
    draft,
    setDraft,
    sourceFilter,
    setSourceFilter,
    chatPrompt,
    setChatPrompt,
    createQuest,
    addCard,
    importFiles,
    saveSelected,
    deleteSelected,
    clearOutputShelf,
    promoteOutputToCard,
    runRecipe,
    runStudioAction,
    askForge,
  };
}
