// ============================================================
// Studio — multi-block document editor (M6.2 lift).
// ============================================================
//
// Replaces the legacy in-tree TextEditor + RichEditor + AIWriter
// triad with a single AI-native composition surface. Notes already
// migrated to Memo in W4-C, so we leave Notes alone.
//
// Two-pane layout:
//
//   Left:  list of documents (title + first-block preview, click to
//          open).
//   Right: open document. Editable title input + vertical list of
//          blocks. Each block renders by kind (heading-{1,2,3},
//          paragraph, bullet, code, image, embed, separator). Per-block
//          menu offers "Insert above / below / Delete / Convert kind".
//
// ⌘K command palette stub registers three Studio commands via
// host.shellMenu.register: Rewrite selection / Continue / Outline.
// All three currently fire a host.notifications.notify that points to
// the M6.x engine integration PR — the menu surface is end-to-end
// mountable today, the engine wiring lands next.
//
// Auto-save: text changes debounce ~400ms then call updateBlock.
// Title changes save on blur. New blocks `insertBlock` immediately —
// no debounce so the new row appears in the doc list update_at sort.
//
// Drag-reorder is OPTIONAL for this PR. We ship the menu-based "Insert
// above/below" path; native HTML5 drag-and-drop wiring lands as a
// follow-up cosmetic PR.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  PenLine,
  Trash2,
  MoreHorizontal,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  Code as CodeIcon,
  List as ListIcon,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  Minus,
  Boxes,
} from 'lucide-react';
import type { AppBootEnv, AppDb, HostClient } from '@tytus/host-api';
import type {
  StudioReplaceBlockPatch,
  StudioInsertBlockPatch,
} from '@tytus/ai-engine';
import {
  listDocuments,
  createDocument,
  getDocumentWithBlocks,
  updateDocument,
  deleteDocument,
  insertBlock,
  updateBlock,
  deleteBlock,
  type DocumentRow,
  type BlockRow,
  type BlockKind,
} from './repo/documentRepo';

// Keep the lucide imports referenced even if a particular icon isn't
// rendered in some branches — `erasableSyntaxOnly` + noUnusedLocals
// would otherwise complain.
void Sparkles;
void Boxes;

const TEXT_DEBOUNCE_MS = 400;

const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  'heading-1': 'Heading 1',
  'heading-2': 'Heading 2',
  'heading-3': 'Heading 3',
  paragraph: 'Paragraph',
  bullet: 'Bullet',
  code: 'Code',
  image: 'Image',
  embed: 'Embed',
  separator: 'Separator',
};

const BLOCK_KIND_ORDER: BlockKind[] = [
  'heading-1',
  'heading-2',
  'heading-3',
  'paragraph',
  'bullet',
  'code',
  'image',
  'embed',
  'separator',
];

// First-50-chars summary of a doc's first block — used in the left
// pane preview.
function summarise(blocks: BlockRow[]): string {
  const first = blocks.find((b) => b.text.length > 0);
  if (!first) return 'Empty document';
  const text = first.text.replace(/\s+/g, ' ').trim();
  return text.length <= 50 ? text : `${text.slice(0, 50)}…`;
}

// ---- Props ---------------------------------------------------------

export interface StudioProps {
  db: AppDb;
  host: HostClient;
  /** Engine session factory from `AppBootEnv`. Optional so the legacy
   *  in-tree boot path (which threads its own `host` and no engine yet)
   *  still mounts; when absent, ⌘K commands fall back to a tool-direct
   *  preview path that builds a stub patch without an LLM round-trip. */
  createSession?: AppBootEnv['createSession'];
}

interface OpenDoc {
  doc: DocumentRow;
  blocks: BlockRow[];
}

/** ⌘K command identity. */
type StudioComposeCommand = 'rewrite' | 'continue' | 'outline';

/**
 * Per-command modal state. The modal captures user intent before the
 * engine session is opened (tone for Rewrite, intent for Outline, no
 * extra input for Continue — but we keep the same shape so the close
 * + submit + label wiring stays uniform).
 */
interface ComposeModalState {
  command: StudioComposeCommand;
  /** Pre-populated default — "more concise" for rewrite, "the next
   *  paragraph" for continue, "the document so far" for outline. */
  input: string;
  /** Block id Rewrite + Continue anchor against. Outline has no anchor
   *  (it works on the whole doc). */
  anchorBlockId?: string;
}

/**
 * Apply/Discard ghost preview shown above the document while the user
 * decides whether to commit a staged patch. We support a single staged
 * preview at a time; queueing multiple outline bullets onto one preview
 * is a follow-up.
 */
interface GhostPreview {
  command: StudioComposeCommand;
  /** Either a single replace patch (Rewrite) or a list of insert patches
   *  (Continue = 1 patch, Outline = 5 patches at the head). */
  patches: Array<StudioReplaceBlockPatch | StudioInsertBlockPatch>;
  /** Human-friendly summary to show in the banner. */
  summary: string;
}

export function Studio({ db, host, createSession }: StudioProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  // Cache the first-block summary per doc so the left pane doesn't
  // re-query on every render. Re-hydrated whenever we re-list.
  const [summaries, setSummaries] = useState<Map<string, string>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenDoc | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openMenuBlockId, setOpenMenuBlockId] = useState<string | null>(null);

  // ⌘K command modal + ghost-preview state.
  const [composeModal, setComposeModal] = useState<ComposeModalState | null>(
    null,
  );
  const [ghostPreview, setGhostPreview] = useState<GhostPreview | null>(null);
  const [composing, setComposing] = useState(false);

  // Track the focused block so ⌘K Rewrite knows which block to anchor
  // against. We update this on textarea focus inside BlockView.
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

  // Debounce queue for text edits: blockId -> pending value. Flushed
  // every TEXT_DEBOUNCE_MS, with a final flush on unmount.
  const pendingTextRef = useRef<Map<string, { kind: 'text' | 'meta'; payload: unknown }>>(
    new Map(),
  );
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- left-pane refresh ------------------------------------------
  const refreshDocList = useCallback(async () => {
    try {
      const list = await listDocuments(db);
      setDocuments(list);
      // Hydrate summaries lazily — one query per doc. Fine at this
      // scale; if doc counts ever ramp into the thousands, switch to a
      // single JOIN query.
      const next = new Map<string, string>();
      for (const d of list) {
        const result = await getDocumentWithBlocks(db, d.id);
        next.set(d.id, summarise(result?.blocks ?? []));
      }
      setSummaries(next);
    } catch (e) {
      setError((e as Error).message || 'Could not list documents.');
    }
  }, [db]);

  useEffect(() => {
    void refreshDocList();
  }, [refreshDocList]);

  // ---- open the active document -----------------------------------
  useEffect(() => {
    if (!activeId) {
      setOpen(null);
      setDraftTitle('');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await getDocumentWithBlocks(db, activeId);
        if (cancelled) return;
        if (!result) {
          setOpen(null);
          setDraftTitle('');
          return;
        }
        setOpen(result);
        setDraftTitle(result.doc.title);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message || 'Could not open document.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, activeId]);

  // ---- ⌘K shell-menu integration ---------------------------------
  //
  // M6.x: register one Edit group with three composition commands —
  // Rewrite selection / Continue / Outline. Each opens a small modal
  // that captures user intent (tone, intent text), then fires off a
  // real `createSession({...})` request via the engine. The engine
  // emits `staged_patch` events which we translate into the in-pane
  // ghost preview banner with Apply/Discard.
  //
  // When `createSession` is missing (legacy boot) or the underlying
  // pod is offline, the same modal still works through the
  // tool-direct fallback: we build a stub `studio.replaceBlock` /
  // `studio.insertBlock` patch locally and surface the same
  // Apply/Discard banner. The user UX is identical; only the patch
  // body differs (templated text vs LLM tokens).
  //
  // The ref-passing pattern is slightly fiddly because the menu
  // closure captures stale state otherwise — we route `onClick`
  // through a stable handler that reads the LATEST state via refs.
  const focusedBlockIdRef = useRef<string | null>(null);
  const openDocRef = useRef<OpenDoc | null>(null);
  useEffect(() => {
    focusedBlockIdRef.current = focusedBlockId;
  }, [focusedBlockId]);
  useEffect(() => {
    openDocRef.current = open;
  }, [open]);

  const startCompose = useCallback(
    (command: StudioComposeCommand) => {
      if (!openDocRef.current) {
        host.notifications.notify({
          title: 'No document open',
          body: 'Open a document before invoking a Studio composition command.',
          level: 'info',
        });
        return;
      }
      const anchor =
        focusedBlockIdRef.current ??
        openDocRef.current.blocks[openDocRef.current.blocks.length - 1]?.id ??
        undefined;
      const defaultInput =
        command === 'rewrite'
          ? 'more concise'
          : command === 'continue'
            ? 'the next paragraph'
            : 'a 5-bullet outline of this document';
      setComposeModal({
        command,
        input: defaultInput,
        anchorBlockId: anchor,
      });
    },
    [host],
  );

  useEffect(() => {
    const dispose = host.shellMenu.register({
      appId: host.appId,
      groups: [
        {
          label: 'Edit',
          items: [
            {
              id: 'studio.rewrite-selection',
              label: 'Rewrite selection',
              shortcut: '⌘K',
              onClick: () => startCompose('rewrite'),
            },
            {
              id: 'studio.continue',
              label: 'Continue',
              shortcut: '⌘⇧K',
              onClick: () => startCompose('continue'),
            },
            {
              id: 'studio.outline',
              label: 'Outline',
              onClick: () => startCompose('outline'),
            },
          ],
        },
      ],
    });
    return dispose;
  }, [host, startCompose]);

  // ---- debounced flush --------------------------------------------
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      void flushPending();
    }, TEXT_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushPending = useCallback(async () => {
    const pending = pendingTextRef.current;
    if (pending.size === 0) return;
    const drained = Array.from(pending.entries());
    pending.clear();
    for (const [blockId, item] of drained) {
      try {
        if (item.kind === 'text') {
          await updateBlock(db, blockId, { text: item.payload as string });
        } else {
          await updateBlock(db, blockId, {
            meta: item.payload as Record<string, unknown>,
          });
        }
      } catch (e) {
        setError(`Could not save block: ${(e as Error).message}`);
      }
    }
  }, [db]);

  // Flush on unmount so the last keystroke isn't lost.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      void flushPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- title save (blur-driven) -----------------------------------
  const saveTitle = useCallback(async () => {
    if (!open) return;
    if (draftTitle === open.doc.title) return;
    await updateDocument(db, open.doc.id, { title: draftTitle });
    setOpen({ ...open, doc: { ...open.doc, title: draftTitle } });
    await refreshDocList();
  }, [open, draftTitle, db, refreshDocList]);

  // ---- block edits (debounced) ------------------------------------
  const editBlockText = useCallback(
    (blockId: string, text: string) => {
      // Optimistic in-memory update.
      setOpen((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          blocks: prev.blocks.map((b) =>
            b.id === blockId ? { ...b, text } : b,
          ),
        };
      });
      pendingTextRef.current.set(blockId, { kind: 'text', payload: text });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const editBlockMeta = useCallback(
    (blockId: string, meta: Record<string, unknown>) => {
      setOpen((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          blocks: prev.blocks.map((b) =>
            b.id === blockId ? { ...b, meta } : b,
          ),
        };
      });
      pendingTextRef.current.set(blockId, { kind: 'meta', payload: meta });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  // Compute a position-key for a new block inserted relative to a
  // reference. "above" → midpoint between predecessor and ref;
  // "below" → midpoint between ref and successor; "tail" →
  // max+1024.
  const positionFor = useCallback(
    (where: 'above' | 'below' | 'tail', refId?: string): number => {
      if (!open) return 1024;
      const blocks = open.blocks;
      if (blocks.length === 0) return 1024;
      if (where === 'tail') {
        return blocks[blocks.length - 1].position + 1024;
      }
      const idx = refId ? blocks.findIndex((b) => b.id === refId) : -1;
      if (idx < 0) return blocks[blocks.length - 1].position + 1024;
      const ref = blocks[idx];
      if (where === 'above') {
        const prev = idx > 0 ? blocks[idx - 1] : null;
        if (!prev) return ref.position - 1024;
        return Math.floor((prev.position + ref.position) / 2);
      }
      // below
      const next = idx < blocks.length - 1 ? blocks[idx + 1] : null;
      if (!next) return ref.position + 1024;
      return Math.floor((ref.position + next.position) / 2);
    },
    [open],
  );

  const reloadOpen = useCallback(async () => {
    if (!open) return;
    const refreshed = await getDocumentWithBlocks(db, open.doc.id);
    if (refreshed) setOpen(refreshed);
    await refreshDocList();
  }, [db, open, refreshDocList]);

  const insertBlockAt = useCallback(
    async (where: 'above' | 'below' | 'tail', refId?: string, kind: BlockKind = 'paragraph') => {
      if (!open) return;
      const position = positionFor(where, refId);
      await insertBlock(db, open.doc.id, { kind, position });
      await reloadOpen();
    },
    [db, open, positionFor, reloadOpen],
  );

  const removeBlock = useCallback(
    async (blockId: string) => {
      // Flush any pending edit for this block first so we don't write
      // through to a deleted row.
      pendingTextRef.current.delete(blockId);
      await deleteBlock(db, blockId);
      await reloadOpen();
    },
    [db, reloadOpen],
  );

  const convertBlock = useCallback(
    async (blockId: string, kind: BlockKind) => {
      // Flush any pending text edit for this block first so the
      // converted block keeps its in-flight value.
      const pending = pendingTextRef.current.get(blockId);
      if (pending && pending.kind === 'text') {
        await updateBlock(db, blockId, { kind, text: pending.payload as string });
        pendingTextRef.current.delete(blockId);
      } else {
        await updateBlock(db, blockId, { kind });
      }
      setOpenMenuBlockId(null);
      await reloadOpen();
    },
    [db, reloadOpen],
  );

  // ---- new document -----------------------------------------------
  const newDocument = useCallback(async () => {
    const doc = await createDocument(db, { title: 'Untitled' });
    // Seed with one paragraph so the editor lands on something
    // editable rather than an empty surface.
    await insertBlock(db, doc.id, { kind: 'paragraph', position: 1024 });
    await refreshDocList();
    setActiveId(doc.id);
  }, [db, refreshDocList]);

  const removeDocument = useCallback(async () => {
    if (!open) return;
    await deleteDocument(db, open.doc.id);
    setActiveId(null);
    setOpen(null);
    await refreshDocList();
  }, [db, open, refreshDocList]);

  // Close the per-block menu on outside click.
  useEffect(() => {
    if (!openMenuBlockId) return;
    const onClick = () => setOpenMenuBlockId(null);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [openMenuBlockId]);

  // ---- ⌘K compose: modal submit -> engine session -> staged patch -
  //
  // Hybrid path:
  //   1. ALWAYS try `createSession({...})` so the engine is exercised
  //      end-to-end. The shell's stub may throw — we swallow that and
  //      fall back to the tool-direct preview.
  //   2. ALWAYS produce a stub patch via the tool helpers so
  //      Apply/Discard works against a fully-mocked LLM. Real engine
  //      sessions emit `staged_patch` events that REPLACE the stub
  //      preview when the LLM actually streams a response.
  //
  // Per spec §"Same degenerate-acceptable as W6-A": if the streaming
  // UI is too much to integrate in one PR, a tool-direct stub
  // round-trip still proves the tool registry + patch type wiring.
  const submitCompose = useCallback(async () => {
    if (!composeModal) return;
    const openDoc = openDocRef.current;
    if (!openDoc) return;
    setComposing(true);
    try {
      // -- Build a stub patch (degenerate-acceptable preview) ---
      let preview: GhostPreview | null = null;
      const userInput = composeModal.input.trim() || 'concise';
      if (composeModal.command === 'rewrite') {
        const blockId =
          composeModal.anchorBlockId ??
          openDoc.blocks.find((b) => b.text.length > 0)?.id;
        if (!blockId) {
          throw new Error(
            'Rewrite needs a focused block — click into a block first.',
          );
        }
        const sourceBlock = openDoc.blocks.find((b) => b.id === blockId);
        const newText = `${sourceBlock?.text ?? ''} (rewrite: ${userInput})`;
        const patch: StudioReplaceBlockPatch = {
          kind: 'studio.replaceBlock',
          docId: openDoc.doc.id,
          blockId,
          newText,
        };
        preview = {
          command: 'rewrite',
          patches: [patch],
          summary: `Rewrite block as "${userInput}"`,
        };
      } else if (composeModal.command === 'continue') {
        const anchorId =
          composeModal.anchorBlockId ??
          openDoc.blocks[openDoc.blocks.length - 1]?.id;
        if (!anchorId) {
          throw new Error(
            'Continue needs at least one block to anchor against.',
          );
        }
        const patch: StudioInsertBlockPatch = {
          kind: 'studio.insertBlock',
          docId: openDoc.doc.id,
          afterBlockId: anchorId,
          block: {
            kind: 'paragraph',
            text: `(continued: ${userInput})`,
          },
        };
        preview = {
          command: 'continue',
          patches: [patch],
          summary: `Continue with "${userInput}"`,
        };
      } else {
        // outline: insert 5 bullet blocks at the document head.
        const headBlock = openDoc.blocks[0];
        if (!headBlock) {
          throw new Error('Outline needs a non-empty document.');
        }
        const patches: StudioInsertBlockPatch[] = [];
        for (let i = 0; i < 5; i++) {
          patches.push({
            kind: 'studio.insertBlock',
            docId: openDoc.doc.id,
            beforeBlockId: headBlock.id,
            block: {
              kind: 'bullet',
              text: `(outline ${i + 1}/5: ${userInput})`,
            },
          });
        }
        preview = {
          command: 'outline',
          patches,
          summary: `Outline: 5 bullets prefixed by "${userInput}"`,
        };
      }
      setGhostPreview(preview);

      // -- Real engine session attempt -------------------------
      // We do NOT block on the result — the modal closes immediately
      // so the user sees the stub preview right away. If the engine
      // produces real `staged_patch` events, they REPLACE the stub
      // preview asynchronously. (Today's stub `createSession` throws
      // synchronously, so the catch-and-ignore below is the live
      // behaviour until M2 wires the real engine through the loader.)
      if (createSession) {
        try {
          const session = createSession({
            app: 'studio',
            mode: 'text',
            documentId: openDoc.doc.id,
            documentRevision: 0,
            tools: [],
            initialContext: {
              command: composeModal.command,
              userInput,
              focusedBlockId: composeModal.anchorBlockId,
            },
          });
          // Best-effort: kick off the request, drain events, replace the
          // preview if the engine produces real staged patches. Don't
          // await — let the user keep editing.
          void (async () => {
            try {
              const stream = session.send({
                intent: 'edit',
                prompt: `Studio ${composeModal.command} (${userInput})`,
              });
              const real: Array<
                StudioReplaceBlockPatch | StudioInsertBlockPatch
              > = [];
              for await (const event of stream as AsyncIterable<{
                kind?: string;
                patch?: unknown;
              }>) {
                if (
                  event &&
                  event.kind === 'staged_patch' &&
                  typeof event.patch === 'object' &&
                  event.patch !== null
                ) {
                  const p = event.patch as { kind?: string };
                  if (
                    p.kind === 'studio.replaceBlock' ||
                    p.kind === 'studio.insertBlock'
                  ) {
                    real.push(
                      event.patch as
                        | StudioReplaceBlockPatch
                        | StudioInsertBlockPatch,
                    );
                  }
                }
              }
              if (real.length > 0) {
                setGhostPreview((prev) =>
                  prev && prev.command === composeModal.command
                    ? { ...prev, patches: real }
                    : prev,
                );
              }
            } catch {
              /* engine errored — keep the stub preview. */
            }
          })();
        } catch {
          /* createSession itself threw — stub preview stands. */
        }
      }
    } catch (e) {
      setError((e as Error).message || 'Compose failed.');
    } finally {
      setComposeModal(null);
      setComposing(false);
    }
  }, [composeModal, createSession]);

  /** Apply every patch in the current ghost preview, then clear it. */
  const applyGhostPreview = useCallback(async () => {
    if (!ghostPreview || !open) return;
    try {
      // We commit the patches here directly through the repo. In a
      // future PR a TransactionRunner-bound applier will own this; for
      // M6.x we keep the path narrow.
      for (const patch of ghostPreview.patches) {
        if (patch.kind === 'studio.replaceBlock') {
          const update: { text: string; kind?: BlockKind } = {
            text: patch.newText,
          };
          if (patch.newBlockKind) update.kind = patch.newBlockKind;
          await updateBlock(db, patch.blockId, update);
        } else {
          // studio.insertBlock — resolve a position via the existing
          // sparse 1024-step rule.
          const blocks = openDocRef.current?.blocks ?? [];
          let position = 1024;
          if (patch.beforeBlockId) {
            const idx = blocks.findIndex((b) => b.id === patch.beforeBlockId);
            if (idx >= 0) {
              const ref = blocks[idx];
              const prev = idx > 0 ? blocks[idx - 1] : null;
              position = prev
                ? Math.floor((prev.position + ref.position) / 2)
                : ref.position - 1024;
            }
          } else if (patch.afterBlockId) {
            const idx = blocks.findIndex((b) => b.id === patch.afterBlockId);
            if (idx >= 0) {
              const ref = blocks[idx];
              const next = idx < blocks.length - 1 ? blocks[idx + 1] : null;
              position = next
                ? Math.floor((ref.position + next.position) / 2)
                : ref.position + 1024;
            }
          }
          await insertBlock(db, patch.docId, {
            kind: patch.block.kind,
            text: patch.block.text,
            meta: patch.block.meta,
            position,
          });
        }
      }
      await reloadOpen();
    } catch (e) {
      setError(`Apply failed: ${(e as Error).message}`);
    } finally {
      setGhostPreview(null);
    }
  }, [db, ghostPreview, open, reloadOpen]);

  const discardGhostPreview = useCallback(() => {
    setGhostPreview(null);
  }, []);

  // ---- render -----------------------------------------------------

  const titlebar = useMemo(
    () => (
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {open && (
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            placeholder="Untitled"
            aria-label="Document title"
            style={{
              flex: 1,
              minWidth: 200,
              fontSize: 18,
              fontWeight: 600,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              color: 'inherit',
            }}
          />
        )}
        {open && (
          <button
            type="button"
            onClick={() => void removeDocument()}
            title="Delete document"
            style={{
              border: '1px solid rgba(239,68,68,0.45)',
              background: 'var(--bg-window, #1f1f1f)',
              color: 'var(--accent-error, #ef4444)',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
          >
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>
    ),
    [open, draftTitle, saveTitle, removeDocument],
  );

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        background: 'var(--bg-window, #141414)',
        color: 'var(--text-primary, #f5f5f5)',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* Left pane: document list */}
      <aside
        style={{
          width: 280,
          borderRight: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-titlebar, rgba(255,255,255,0.04))',
        }}
      >
        <div
          style={{
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PenLine size={16} />
            <strong>Studio</strong>
          </div>
          <button
            type="button"
            onClick={() => void newDocument()}
            title="New document"
            style={{
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
              background: 'var(--bg-window, #1f1f1f)',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
          >
            <Plus size={12} /> New document
          </button>
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {documents.length === 0 && (
            <li
              style={{
                padding: '16px 12px',
                color: 'var(--text-secondary, rgba(255,255,255,0.62))',
                fontSize: 13,
              }}
            >
              No documents yet — hit New document.
            </li>
          )}
          {documents.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setActiveId(d.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background:
                    activeId === d.id ? 'var(--bg-hover, rgba(255,255,255,0.08))' : 'transparent',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  display: 'block',
                }}
              >
                <div style={{ fontWeight: 500, fontSize: 13 }}>{d.title}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary, rgba(255,255,255,0.62))',
                    marginTop: 2,
                  }}
                >
                  {summaries.get(d.id) ?? 'Empty document'}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <div
            style={{
              padding: '6px 12px',
              fontSize: 11,
              color: 'var(--accent-error, #ef4444)',
              borderTop: '1px solid rgba(239,68,68,0.35)',
              background: 'rgba(239,68,68,0.10)',
            }}
          >
            {error}
          </div>
        )}
      </aside>

      {/* Right pane: open document */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {!open && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-disabled, rgba(255,255,255,0.42))',
              fontSize: 14,
            }}
          >
            Select a document or create a new one.
          </div>
        )}
        {open && (
          <>
            {titlebar}
            {ghostPreview && (
              <GhostPreviewBanner
                preview={ghostPreview}
                onApply={() => void applyGhostPreview()}
                onDiscard={discardGhostPreview}
              />
            )}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px 24px',
              }}
            >
              {open.blocks.length === 0 && (
                <div
                  style={{
                    color: 'var(--text-disabled, rgba(255,255,255,0.42))',
                    fontSize: 13,
                    padding: '24px 0',
                    textAlign: 'center',
                  }}
                >
                  Empty document — start typing or hit "+ New block".
                </div>
              )}
              {open.blocks.map((block) => (
                <BlockView
                  key={block.id}
                  block={block}
                  isMenuOpen={openMenuBlockId === block.id}
                  onOpenMenu={() => setOpenMenuBlockId(block.id)}
                  onCloseMenu={() => setOpenMenuBlockId(null)}
                  onTextChange={(text) => editBlockText(block.id, text)}
                  onMetaChange={(meta) => editBlockMeta(block.id, meta)}
                  onInsertAbove={() => void insertBlockAt('above', block.id)}
                  onInsertBelow={() => void insertBlockAt('below', block.id)}
                  onDelete={() => void removeBlock(block.id)}
                  onConvert={(kind) => void convertBlock(block.id, kind)}
                  onFocus={() => setFocusedBlockId(block.id)}
                />
              ))}
              <div
                style={{
                  marginTop: 16,
                  textAlign: 'center',
                }}
              >
                <button
                  type="button"
                  onClick={() => void insertBlockAt('tail')}
                  title="Append a new paragraph block"
                  style={{
                    border: '1px dashed var(--border-strong, rgba(255,255,255,0.22))',
                    background: 'transparent',
                    borderRadius: 4,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--text-secondary, rgba(255,255,255,0.68))',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Plus size={12} /> New block
                </button>
              </div>
            </div>
          </>
        )}
      </main>
      {composeModal && (
        <ComposeModal
          state={composeModal}
          composing={composing}
          onChange={(input) =>
            setComposeModal((prev) => (prev ? { ...prev, input } : prev))
          }
          onSubmit={() => void submitCompose()}
          onCancel={() => setComposeModal(null)}
        />
      )}
    </div>
  );
}

// ---- ComposeModal --------------------------------------------------
//
// The lightweight modal Studio shows when the user invokes a ⌘K
// command. Captures one piece of free-text intent (tone for Rewrite,
// continuation hint for Continue, outline angle for Outline) and
// kicks off `submitCompose`. The same component handles all three
// commands — only the labels + placeholder change.

interface ComposeModalProps {
  state: ComposeModalState;
  composing: boolean;
  onChange: (input: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function ComposeModal({
  state,
  composing,
  onChange,
  onSubmit,
  onCancel,
}: ComposeModalProps) {
  const titleByCommand: Record<StudioComposeCommand, string> = {
    rewrite: 'Rewrite selection',
    continue: 'Continue writing',
    outline: 'Outline document',
  };
  const labelByCommand: Record<StudioComposeCommand, string> = {
    rewrite: 'Tone',
    continue: 'Direction',
    outline: 'Angle',
  };
  return (
    <div
      role="dialog"
      aria-label={titleByCommand[state.command]}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: 'var(--bg-window, #1f1f1f)',
          borderRadius: 6,
          padding: 16,
          width: 360,
          boxShadow: '0 6px 24px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {titleByCommand[state.command]}
        </div>
        <label style={{ fontSize: 12, color: 'var(--text-secondary, rgba(255,255,255,0.68))' }}>
          {labelByCommand[state.command]}
        </label>
        <input
          type="text"
          autoFocus
          value={state.input}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${state.command} input`}
          style={{
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 13,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={composing}
            style={{
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
              background: 'var(--bg-window, #1f1f1f)',
              borderRadius: 4,
              padding: '4px 10px',
              cursor: composing ? 'not-allowed' : 'pointer',
              fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={composing}
            style={{
              border: '1px solid rgba(40,80,180,0.5)',
              background: 'var(--accent-primary, #8b5cf6)',
              color: 'white',
              borderRadius: 4,
              padding: '4px 10px',
              cursor: composing ? 'not-allowed' : 'pointer',
              fontSize: 12,
            }}
          >
            {composing ? 'Working…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- GhostPreviewBanner --------------------------------------------
//
// Shows the staged-patch summary above the document body with
// Apply/Discard buttons. Sits between the titlebar and the block
// list so the user can keep scanning the document while deciding.

interface GhostPreviewBannerProps {
  preview: GhostPreview;
  onApply: () => void;
  onDiscard: () => void;
}

function GhostPreviewBanner({
  preview,
  onApply,
  onDiscard,
}: GhostPreviewBannerProps) {
  return (
    <div
      role="status"
      aria-label={`Ghost preview: ${preview.command}`}
      style={{
        background: 'rgba(139,92,246,0.14)',
        borderBottom: '1px solid rgba(40,80,180,0.2)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 12,
      }}
    >
      <Sparkles size={14} />
      <span style={{ flex: 1 }}>
        <strong style={{ marginRight: 6 }}>{preview.command}</strong>
        <span style={{ color: 'var(--text-secondary, rgba(255,255,255,0.74))' }}>{preview.summary}</span>
        <span style={{ color: 'var(--text-disabled, rgba(255,255,255,0.42))', marginLeft: 6 }}>
          ({preview.patches.length} patch
          {preview.patches.length === 1 ? '' : 'es'})
        </span>
      </span>
      <button
        type="button"
        onClick={onDiscard}
        style={{
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
          background: 'var(--bg-window, #1f1f1f)',
          borderRadius: 4,
          padding: '2px 8px',
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Discard
      </button>
      <button
        type="button"
        onClick={onApply}
        style={{
          border: '1px solid rgba(40,80,180,0.5)',
          background: 'var(--accent-primary, #8b5cf6)',
          color: 'white',
          borderRadius: 4,
          padding: '2px 10px',
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Apply
      </button>
    </div>
  );
}

// ---- BlockView ------------------------------------------------------
//
// Pure render-shaped subcomponent. All persistence happens via the
// callbacks the parent supplies. Kind-specific UI is dispatched by a
// switch — separator + image + embed have render shapes that don't
// match the textarea / heading / bullet / code shape.

interface BlockViewProps {
  block: BlockRow;
  isMenuOpen: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onTextChange: (text: string) => void;
  onMetaChange: (meta: Record<string, unknown>) => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
  onConvert: (kind: BlockKind) => void;
  /** Called when any text surface inside the block gains focus — Studio
   *  uses this to anchor ⌘K Rewrite/Continue against the user's last
   *  cursor location. Optional: not wired by the per-block menu path. */
  onFocus?: () => void;
}

const KIND_ICON: Record<BlockKind, React.ReactNode> = {
  'heading-1': <Heading1 size={12} />,
  'heading-2': <Heading2 size={12} />,
  'heading-3': <Heading3 size={12} />,
  paragraph: <Pilcrow size={12} />,
  bullet: <ListIcon size={12} />,
  code: <CodeIcon size={12} />,
  image: <ImageIcon size={12} />,
  embed: <Plus size={12} />,
  separator: <Minus size={12} />,
};

function BlockView(props: BlockViewProps) {
  const {
    block, isMenuOpen, onOpenMenu, onCloseMenu,
    onTextChange, onMetaChange,
    onInsertAbove, onInsertBelow, onDelete, onConvert, onFocus,
  } = props;

  // Stop propagation so the global outside-click handler doesn't
  // immediately close the menu we just opened.
  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMenuOpen) onCloseMenu();
    else onOpenMenu();
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        gap: 6,
        marginBottom: 6,
      }}
      data-block-id={block.id}
      data-block-kind={block.kind}
    >
      {/* Per-block menu button (3-dot) */}
      <div
        style={{
          width: 22,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'flex-start',
          paddingTop: 4,
        }}
      >
        <button
          type="button"
          onClick={handleMenuToggle}
          aria-label="Block menu"
          title="Block menu"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--text-disabled, rgba(255,255,255,0.42))',
            padding: 0,
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      {/* Block body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <BlockBody
          block={block}
          onTextChange={onTextChange}
          onMetaChange={onMetaChange}
        />
      </div>

      {/* Menu popover */}
      {isMenuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 22,
            left: 0,
            zIndex: 5,
            background: 'var(--bg-window, #1f1f1f)',
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
            borderRadius: 4,
            boxShadow: '0 4px 12px var(--border-subtle, rgba(255,255,255,0.12))',
            minWidth: 180,
            padding: 4,
            fontSize: 12,
          }}
        >
          <MenuItem
            onClick={() => { onCloseMenu(); onInsertAbove(); }}
            icon={<ChevronUp size={12} />}
            label="Insert above"
          />
          <MenuItem
            onClick={() => { onCloseMenu(); onInsertBelow(); }}
            icon={<ChevronDown size={12} />}
            label="Insert below"
          />
          <MenuItem
            onClick={() => { onCloseMenu(); onDelete(); }}
            icon={<Trash2 size={12} />}
            label="Delete"
            danger
          />
          <div
            style={{
              borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
              margin: '4px 0',
            }}
          />
          <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--text-secondary, rgba(255,255,255,0.62))' }}>
            Convert to
          </div>
          {BLOCK_KIND_ORDER.map((kind) => (
            <MenuItem
              key={kind}
              onClick={() => onConvert(kind)}
              icon={KIND_ICON[kind]}
              label={BLOCK_KIND_LABELS[kind]}
              checked={kind === block.kind}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  checked?: boolean;
  danger?: boolean;
}

function MenuItem({ onClick, icon, label, checked, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        textAlign: 'left',
        background: checked ? 'var(--bg-hover, rgba(255,255,255,0.08))' : 'transparent',
        border: 'none',
        padding: '4px 8px',
        cursor: 'pointer',
        borderRadius: 3,
        fontSize: 12,
        color: danger ? 'var(--accent-error, #ef4444)' : 'inherit',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---- BlockBody ------------------------------------------------------
//
// Per-kind editor surface. Heading/paragraph/bullet use a textarea
// (auto-grows via onInput height adjust). Code adds a language picker
// and a monospace textarea. Image renders the src + caption editor.
// Embed renders a card placeholder. Separator is a non-editable hr.

interface BlockBodyProps {
  block: BlockRow;
  onTextChange: (text: string) => void;
  onMetaChange: (meta: Record<string, unknown>) => void;
}

function BlockBody({ block, onTextChange, onMetaChange }: BlockBodyProps) {
  switch (block.kind) {
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
      return <HeadingBlock block={block} onTextChange={onTextChange} />;
    case 'paragraph':
      return (
        <AutoTextarea
          value={block.text}
          placeholder="Type something…"
          onChange={onTextChange}
          fontSize={14}
        />
      );
    case 'bullet':
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          <span
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: 'var(--text-secondary, rgba(255,255,255,0.68))',
              userSelect: 'none',
            }}
          >
            •
          </span>
          <AutoTextarea
            value={block.text}
            placeholder="List item"
            onChange={onTextChange}
            fontSize={14}
          />
        </div>
      );
    case 'code':
      return (
        <CodeBlock
          block={block}
          onTextChange={onTextChange}
          onMetaChange={onMetaChange}
        />
      );
    case 'image':
      return (
        <ImageBlock
          block={block}
          onTextChange={onTextChange}
          onMetaChange={onMetaChange}
        />
      );
    case 'embed':
      return <EmbedBlock block={block} />;
    case 'separator':
      return (
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
            margin: '8px 0',
          }}
        />
      );
  }
}

// ---- AutoTextarea ---------------------------------------------------
//
// Borderless textarea that auto-resizes to fit its content. Used by
// every text-bearing block kind so the editor surface feels like one
// continuous document rather than a stack of fixed-height inputs.

interface AutoTextareaProps {
  value: string;
  placeholder?: string;
  onChange: (text: string) => void;
  fontSize?: number;
  monospace?: boolean;
  fontWeight?: number;
}

function AutoTextarea(props: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [props.value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      style={{
        width: '100%',
        border: 'none',
        background: 'transparent',
        outline: 'none',
        resize: 'none',
        fontFamily: props.monospace
          ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
          : 'inherit',
        fontSize: props.fontSize ?? 14,
        fontWeight: props.fontWeight ?? 400,
        lineHeight: 1.5,
        color: 'inherit',
        padding: 0,
        overflow: 'hidden',
      }}
    />
  );
}

// ---- HeadingBlock ---------------------------------------------------

function HeadingBlock({
  block,
  onTextChange,
}: {
  block: BlockRow;
  onTextChange: (text: string) => void;
}) {
  const sizeForKind = (kind: BlockKind): number => {
    switch (kind) {
      case 'heading-1': return 24;
      case 'heading-2': return 20;
      case 'heading-3': return 17;
      default: return 16;
    }
  };
  return (
    <AutoTextarea
      value={block.text}
      placeholder={`Heading ${block.kind.slice(-1)}`}
      onChange={onTextChange}
      fontSize={sizeForKind(block.kind)}
      fontWeight={700}
    />
  );
}

// ---- CodeBlock ------------------------------------------------------

function CodeBlock({
  block,
  onTextChange,
  onMetaChange,
}: {
  block: BlockRow;
  onTextChange: (text: string) => void;
  onMetaChange: (meta: Record<string, unknown>) => void;
}) {
  const language = (block.meta.language as string | undefined) ?? '';
  return (
    <div
      style={{
        background: 'var(--bg-titlebar, rgba(255,255,255,0.04))',
        borderRadius: 4,
        padding: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-secondary, rgba(255,255,255,0.62))' }}>Language</span>
        <input
          type="text"
          value={language}
          placeholder="ts, py, sh…"
          onChange={(e) => onMetaChange({ ...block.meta, language: e.target.value })}
          aria-label="Code language"
          style={{
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
            borderRadius: 3,
            padding: '1px 4px',
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            width: 80,
            background: 'var(--bg-window, #1f1f1f)',
          }}
        />
      </div>
      <AutoTextarea
        value={block.text}
        placeholder="// code"
        onChange={onTextChange}
        fontSize={13}
        monospace
      />
    </div>
  );
}

// ---- ImageBlock -----------------------------------------------------

function ImageBlock({
  block,
  onTextChange,
  onMetaChange,
}: {
  block: BlockRow;
  onTextChange: (text: string) => void;
  onMetaChange: (meta: Record<string, unknown>) => void;
}) {
  const src = (block.meta.src as string | undefined) ?? '';
  const alt = (block.meta.alt as string | undefined) ?? '';
  return (
    <div>
      {src.length > 0 ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: '100%',
            maxHeight: 280,
            display: 'block',
            borderRadius: 4,
            background: 'var(--bg-hover, rgba(255,255,255,0.08))',
          }}
        />
      ) : (
        <div
          style={{
            border: '1px dashed var(--border-strong, rgba(255,255,255,0.22))',
            borderRadius: 4,
            padding: 16,
            textAlign: 'center',
            color: 'var(--text-secondary, rgba(255,255,255,0.62))',
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ImageIcon size={20} />
          No image src yet
        </div>
      )}
      <input
        type="text"
        value={src}
        placeholder="Image src URL"
        onChange={(e) => onMetaChange({ ...block.meta, src: e.target.value })}
        aria-label="Image source URL"
        style={{
          width: '100%',
          marginTop: 4,
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
          borderRadius: 3,
          padding: '2px 6px',
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      />
      <input
        type="text"
        value={alt}
        placeholder="Alt text"
        onChange={(e) => onMetaChange({ ...block.meta, alt: e.target.value })}
        aria-label="Image alt text"
        style={{
          width: '100%',
          marginTop: 2,
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
          borderRadius: 3,
          padding: '2px 6px',
          fontSize: 11,
        }}
      />
      <AutoTextarea
        value={block.text}
        placeholder="Caption…"
        onChange={onTextChange}
        fontSize={12}
      />
    </div>
  );
}

// ---- EmbedBlock -----------------------------------------------------
//
// M6.2: render a card placeholder showing the embed target. The
// actual embedded view (e.g. inline Sheet preview, Memo backlink)
// ships in a follow-up PR — Studio's embed renderer needs the loader
// to expose a sub-mount surface for cross-app components, which is
// itself M6.x scope.

function EmbedBlock({ block }: { block: BlockRow }) {
  const kind = (block.meta.kind as string | undefined) ?? 'unknown';
  const targetId = (block.meta.targetId as string | undefined) ?? '(no target)';
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
        borderLeft: '3px solid rgba(80,120,200,0.6)',
        borderRadius: 4,
        padding: '8px 12px',
        background: 'rgba(139,92,246,0.10)',
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>Embed</div>
      <div style={{ color: 'var(--text-secondary, rgba(255,255,255,0.68))', fontFamily: 'ui-monospace, monospace' }}>
        {kind}:{targetId}
      </div>
      <div style={{ color: 'var(--text-disabled, rgba(255,255,255,0.42))', fontSize: 11, marginTop: 4 }}>
        Inline preview lands in M6.x.
      </div>
    </div>
  );
}

export default Studio;
