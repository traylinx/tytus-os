/**
 * `studioReplaceBlockTool({ db })` — stages a `studio.replaceBlock`
 * patch.
 *
 * Per spec §"Tool registration via injection": tools that produce
 * patches return the Patch object. The TransactionRunner is what
 * actually commits — the engine emits `staged_patch` and the app
 * decides Apply/Discard.
 *
 * The tool reads the current block to fail-fast on bad ids before
 * staging. The actual commit happens via Studio's repo bound to the
 * patch applier (Studio.tsx applies the patch directly through
 * `documentRepo.updateBlock` once the user clicks Apply).
 */
import type { AppDb } from '@tytus/host-api';
import type { ToolDef } from '../../types';
import {
  validatePatch,
  type StudioBlockKind,
  type StudioReplaceBlockPatch,
} from '../../edits/algebra';

export interface StudioReplaceBlockFactoryOpts {
  db: AppDb;
}

export interface StudioReplaceBlockArgs {
  docId: string;
  blockId: string;
  newText: string;
  newBlockKind?: StudioBlockKind;
}

export const STUDIO_REPLACE_BLOCK_TOOL_NAME = 'studioReplaceBlock';

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

const isStudioBlockKind = (s: unknown): s is StudioBlockKind =>
  typeof s === 'string' && (ALL_KINDS as readonly string[]).includes(s);

const TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    docId: { type: 'string' },
    blockId: { type: 'string' },
    newText: { type: 'string' },
    newBlockKind: {
      type: 'string',
      enum: ALL_KINDS as readonly string[],
    },
  },
  required: ['docId', 'blockId', 'newText'],
};

export function parseStudioReplaceBlockArgs(
  raw: unknown,
): StudioReplaceBlockArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('studioReplaceBlock: args must be an object');
  }
  const a = raw as {
    docId?: unknown;
    blockId?: unknown;
    newText?: unknown;
    newBlockKind?: unknown;
  };
  if (typeof a.docId !== 'string' || a.docId.length === 0) {
    throw new Error('studioReplaceBlock: missing or invalid docId');
  }
  if (typeof a.blockId !== 'string' || a.blockId.length === 0) {
    throw new Error('studioReplaceBlock: missing or invalid blockId');
  }
  if (typeof a.newText !== 'string') {
    throw new Error('studioReplaceBlock: missing or invalid newText');
  }
  const out: StudioReplaceBlockArgs = {
    docId: a.docId,
    blockId: a.blockId,
    newText: a.newText,
  };
  if (a.newBlockKind !== undefined) {
    if (!isStudioBlockKind(a.newBlockKind)) {
      throw new Error(
        `studioReplaceBlock: invalid newBlockKind: ${String(a.newBlockKind)}`,
      );
    }
    out.newBlockKind = a.newBlockKind;
  }
  return out;
}

export function studioReplaceBlockTool(
  opts: StudioReplaceBlockFactoryOpts,
): ToolDef {
  return {
    name: STUDIO_REPLACE_BLOCK_TOOL_NAME,
    description:
      "Stage a replacement of a Studio block's text (and optionally its kind) in-place. Returns a `studio.replaceBlock` patch — the engine runner commits via Apply/Discard.",
    parameters: TOOL_PARAMETERS,
    requiresApproval: false,
    execute: async (args) => {
      const parsed = parseStudioReplaceBlockArgs(args);
      // Fail-fast verification — block must exist and belong to docId.
      const rows = await opts.db.query<{ document_id: string }>(
        `SELECT document_id FROM app_studio_blocks WHERE id = ? LIMIT 1`,
        [parsed.blockId],
      );
      if (rows.length === 0) {
        throw new Error(
          `studioReplaceBlock: block not found: ${parsed.blockId}`,
        );
      }
      if (rows[0].document_id !== parsed.docId) {
        throw new Error(
          `studioReplaceBlock: block ${parsed.blockId} does not belong to doc ${parsed.docId}`,
        );
      }
      const patch: StudioReplaceBlockPatch = {
        kind: 'studio.replaceBlock',
        docId: parsed.docId,
        blockId: parsed.blockId,
        newText: parsed.newText,
        ...(parsed.newBlockKind ? { newBlockKind: parsed.newBlockKind } : {}),
      };
      const issues = validatePatch(patch);
      if (issues.length > 0) {
        throw new Error(
          `studioReplaceBlock: patch failed validation: ${issues
            .map((i) => i.message)
            .join('; ')}`,
        );
      }
      return { patch } as unknown;
    },
  };
}
