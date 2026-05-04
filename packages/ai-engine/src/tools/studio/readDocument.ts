/**
 * `studioReadDocumentTool({ db })` — Studio-specific tool factory that
 * reads a Studio document and its blocks by id, ordered by `position`
 * (the same sparse 1024-step sort key the Studio repo writes).
 *
 * Bound to an `AppDb` at session-creation time. The factory pattern
 * mirrors `cellReadRangeTool` / `webFetchTool`: the tool is a closure
 * over the per-app SQLite handle, not a free function. Apps create
 * one of each Studio tool per session and pass `STUDIO_TOOLS` through
 * `createSession({ tools: STUDIO_TOOLS })`.
 *
 * Returns:
 *
 *   {
 *     doc:    { id, title },
 *     blocks: Array<{ id, kind, text, position }>
 *   }
 *
 * Used by Continue (read all blocks above the cursor) and Outline (read
 * every block) ⌘K commands. Read-only; no patches staged.
 */
import type { AppDb } from '@tytus/host-api';
import type { ToolDef } from '../../types';
import type { StudioBlockKind } from '../../edits/algebra';

export interface StudioReadDocumentFactoryOpts {
  /** Per-app SQLite handle. Bound at session-creation time. */
  db: AppDb;
}

export interface StudioReadDocumentArgs {
  docId: string;
}

export interface StudioReadDocumentResult {
  doc: { id: string; title: string };
  blocks: Array<{
    id: string;
    kind: StudioBlockKind;
    text: string;
    position: number;
  }>;
}

export const STUDIO_READ_DOCUMENT_TOOL_NAME = 'studioReadDocument';

const TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    docId: {
      type: 'string',
      description:
        'Studio document id (e.g. "d_abc"). Resolves to the row in app_studio_documents.',
    },
  },
  required: ['docId'],
};

interface DocDbRow {
  id: string;
  title: string;
}

interface BlockDbRow {
  id: string;
  kind: string;
  text: string;
  position: number;
}

const ALL_KINDS: readonly StudioBlockKind[] = [
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

const isStudioBlockKind = (s: string): s is StudioBlockKind =>
  (ALL_KINDS as readonly string[]).includes(s);

/**
 * Parse + validate the model-supplied args. Exported so tests + callers
 * that want to bypass the tool envelope can reuse the validation.
 */
export function parseStudioReadDocumentArgs(
  raw: unknown,
): StudioReadDocumentArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('studioReadDocument: args must be an object');
  }
  const a = raw as { docId?: unknown };
  if (typeof a.docId !== 'string' || a.docId.length === 0) {
    throw new Error('studioReadDocument: missing or invalid docId');
  }
  return { docId: a.docId };
}

/**
 * Read a document + its blocks directly. Exported so the UI / tests
 * can preview the result without going through the tool envelope.
 */
export async function readDocument(
  opts: StudioReadDocumentFactoryOpts,
  args: StudioReadDocumentArgs,
): Promise<StudioReadDocumentResult> {
  const docRows = await opts.db.query<DocDbRow>(
    `SELECT id, title
       FROM app_studio_documents
      WHERE id = ?
      LIMIT 1`,
    [args.docId],
  );
  if (docRows.length === 0) {
    throw new Error(`studioReadDocument: document not found: ${args.docId}`);
  }
  const doc = docRows[0];
  const blockRows = await opts.db.query<BlockDbRow>(
    `SELECT id, kind, text, position
       FROM app_studio_blocks
      WHERE document_id = ?
      ORDER BY position ASC`,
    [args.docId],
  );
  const blocks = blockRows.map((b) => ({
    id: b.id,
    kind: isStudioBlockKind(b.kind)
      ? (b.kind as StudioBlockKind)
      : ('paragraph' as StudioBlockKind),
    text: b.text,
    position: b.position,
  }));
  return {
    doc: { id: doc.id, title: doc.title },
    blocks,
  };
}

export function studioReadDocumentTool(
  opts: StudioReadDocumentFactoryOpts,
): ToolDef {
  return {
    name: STUDIO_READ_DOCUMENT_TOOL_NAME,
    description:
      'Read a Studio document and its ordered blocks by docId. Read-only — does not stage a patch. Use before Outline / Continue / Rewrite to feed the model the current document state.',
    parameters: TOOL_PARAMETERS,
    requiresApproval: false,
    execute: async (args) => {
      const parsed = parseStudioReadDocumentArgs(args);
      const result = await readDocument(opts, parsed);
      return result as unknown;
    },
  };
}
