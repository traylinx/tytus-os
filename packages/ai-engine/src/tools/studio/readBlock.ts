/**
 * `studioReadBlockTool({ db })` — read a single Studio block by
 * `(docId, blockId)`. Returns `{ id, kind, text, meta }`.
 *
 * Used by Rewrite selection — the active block's text is the input to
 * the rewrite prompt. We intentionally take both ids so the tool can
 * fail loudly when the model passes a block that doesn't belong to the
 * doc the session was opened against (cross-doc hallucinations).
 */
import type { AppDb } from '@tytus/host-api';
import type { ToolDef } from '../../types';
import type { StudioBlockKind } from '../../edits/algebra';

export interface StudioReadBlockFactoryOpts {
  db: AppDb;
}

export interface StudioReadBlockArgs {
  docId: string;
  blockId: string;
}

export interface StudioReadBlockResult {
  id: string;
  kind: StudioBlockKind;
  text: string;
  meta: Record<string, unknown>;
}

export const STUDIO_READ_BLOCK_TOOL_NAME = 'studioReadBlock';

const TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    docId: { type: 'string' },
    blockId: { type: 'string' },
  },
  required: ['docId', 'blockId'],
};

interface BlockDbRow {
  id: string;
  document_id: string;
  kind: string;
  text: string;
  meta_json: string;
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

export function parseStudioReadBlockArgs(raw: unknown): StudioReadBlockArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('studioReadBlock: args must be an object');
  }
  const a = raw as { docId?: unknown; blockId?: unknown };
  if (typeof a.docId !== 'string' || a.docId.length === 0) {
    throw new Error('studioReadBlock: missing or invalid docId');
  }
  if (typeof a.blockId !== 'string' || a.blockId.length === 0) {
    throw new Error('studioReadBlock: missing or invalid blockId');
  }
  return { docId: a.docId, blockId: a.blockId };
}

export async function readBlock(
  opts: StudioReadBlockFactoryOpts,
  args: StudioReadBlockArgs,
): Promise<StudioReadBlockResult> {
  const rows = await opts.db.query<BlockDbRow>(
    `SELECT id, document_id, kind, text, meta_json
       FROM app_studio_blocks
      WHERE id = ?
      LIMIT 1`,
    [args.blockId],
  );
  if (rows.length === 0) {
    throw new Error(`studioReadBlock: block not found: ${args.blockId}`);
  }
  const row = rows[0];
  if (row.document_id !== args.docId) {
    throw new Error(
      `studioReadBlock: block ${args.blockId} does not belong to doc ${args.docId}`,
    );
  }
  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.meta_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>;
    }
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    kind: isStudioBlockKind(row.kind)
      ? (row.kind as StudioBlockKind)
      : ('paragraph' as StudioBlockKind),
    text: row.text,
    meta,
  };
}

export function studioReadBlockTool(opts: StudioReadBlockFactoryOpts): ToolDef {
  return {
    name: STUDIO_READ_BLOCK_TOOL_NAME,
    description:
      'Read a single Studio block by (docId, blockId). Returns kind, text, and meta. Read-only; no patches staged.',
    parameters: TOOL_PARAMETERS,
    requiresApproval: false,
    execute: async (args) => {
      const parsed = parseStudioReadBlockArgs(args);
      const result = await readBlock(opts, parsed);
      return result as unknown;
    },
  };
}
