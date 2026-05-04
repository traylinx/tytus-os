/**
 * `studioInsertBlockTool({ db })` — stages a `studio.insertBlock` patch.
 *
 * Insert a new block adjacent to a reference block. Exactly one of
 * `beforeBlockId` / `afterBlockId` must be set (validatePatch enforces).
 *
 * Used by Continue (insert below the cursor) and Outline (insert each
 * outline bullet at the document head). The actual commit happens via
 * Studio's repo bound to the patch applier — Studio.tsx applies through
 * `documentRepo.insertBlock` once the user clicks Apply.
 */
import type { AppDb } from '@tytus/host-api';
import type { ToolDef } from '../../types';
import {
  validatePatch,
  type StudioBlockKind,
  type StudioInsertBlockPatch,
} from '../../edits/algebra';

export interface StudioInsertBlockFactoryOpts {
  db: AppDb;
}

export interface StudioInsertBlockArgs {
  docId: string;
  beforeBlockId?: string;
  afterBlockId?: string;
  kind: StudioBlockKind;
  text: string;
  meta?: Record<string, unknown>;
}

export const STUDIO_INSERT_BLOCK_TOOL_NAME = 'studioInsertBlock';

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
    beforeBlockId: { type: 'string' },
    afterBlockId: { type: 'string' },
    kind: { type: 'string', enum: ALL_KINDS as readonly string[] },
    text: { type: 'string' },
    meta: { type: 'object' },
  },
  required: ['docId', 'kind', 'text'],
};

export function parseStudioInsertBlockArgs(
  raw: unknown,
): StudioInsertBlockArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('studioInsertBlock: args must be an object');
  }
  const a = raw as {
    docId?: unknown;
    beforeBlockId?: unknown;
    afterBlockId?: unknown;
    kind?: unknown;
    text?: unknown;
    meta?: unknown;
  };
  if (typeof a.docId !== 'string' || a.docId.length === 0) {
    throw new Error('studioInsertBlock: missing or invalid docId');
  }
  if (!isStudioBlockKind(a.kind)) {
    throw new Error(
      `studioInsertBlock: missing or invalid kind: ${String(a.kind)}`,
    );
  }
  if (typeof a.text !== 'string') {
    throw new Error('studioInsertBlock: missing or invalid text');
  }
  const before =
    typeof a.beforeBlockId === 'string' && a.beforeBlockId.length > 0
      ? a.beforeBlockId
      : undefined;
  const after =
    typeof a.afterBlockId === 'string' && a.afterBlockId.length > 0
      ? a.afterBlockId
      : undefined;
  if (!before && !after) {
    throw new Error(
      'studioInsertBlock: requires exactly one of beforeBlockId or afterBlockId',
    );
  }
  if (before && after) {
    throw new Error(
      'studioInsertBlock: cannot set both beforeBlockId and afterBlockId',
    );
  }
  let meta: Record<string, unknown> | undefined;
  if (a.meta !== undefined) {
    if (
      !a.meta ||
      typeof a.meta !== 'object' ||
      Array.isArray(a.meta)
    ) {
      throw new Error('studioInsertBlock: meta must be an object if supplied');
    }
    meta = a.meta as Record<string, unknown>;
  }
  return {
    docId: a.docId,
    ...(before ? { beforeBlockId: before } : {}),
    ...(after ? { afterBlockId: after } : {}),
    kind: a.kind,
    text: a.text,
    ...(meta ? { meta } : {}),
  };
}

export function studioInsertBlockTool(
  opts: StudioInsertBlockFactoryOpts,
): ToolDef {
  return {
    name: STUDIO_INSERT_BLOCK_TOOL_NAME,
    description:
      'Stage a new Studio block adjacent to a reference block. Pass exactly one of beforeBlockId or afterBlockId. Returns a `studio.insertBlock` patch — the engine runner commits via Apply/Discard.',
    parameters: TOOL_PARAMETERS,
    requiresApproval: false,
    execute: async (args) => {
      const parsed = parseStudioInsertBlockArgs(args);
      // Fail-fast verification — anchor block must exist and belong to
      // docId.
      const anchorId = parsed.beforeBlockId ?? parsed.afterBlockId!;
      const rows = await opts.db.query<{ document_id: string }>(
        `SELECT document_id FROM app_studio_blocks WHERE id = ? LIMIT 1`,
        [anchorId],
      );
      if (rows.length === 0) {
        throw new Error(
          `studioInsertBlock: anchor block not found: ${anchorId}`,
        );
      }
      if (rows[0].document_id !== parsed.docId) {
        throw new Error(
          `studioInsertBlock: anchor block ${anchorId} does not belong to doc ${parsed.docId}`,
        );
      }
      const patch: StudioInsertBlockPatch = {
        kind: 'studio.insertBlock',
        docId: parsed.docId,
        ...(parsed.beforeBlockId ? { beforeBlockId: parsed.beforeBlockId } : {}),
        ...(parsed.afterBlockId ? { afterBlockId: parsed.afterBlockId } : {}),
        block: {
          kind: parsed.kind,
          text: parsed.text,
          ...(parsed.meta ? { meta: parsed.meta } : {}),
        },
      };
      const issues = validatePatch(patch);
      if (issues.length > 0) {
        throw new Error(
          `studioInsertBlock: patch failed validation: ${issues
            .map((i) => i.message)
            .join('; ')}`,
        );
      }
      return { patch } as unknown;
    },
  };
}
