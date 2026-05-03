/**
 * Patch algebra — typed discriminated union the model emits via the
 * single `propose_patches` OpenAI tool. Every variant is carried through
 * the same Transaction machinery (preview → user approval → atomic
 * prepare/commit/rollback).
 *
 * `brain.append` IS in the union. M2-M7 ship the patch type with a
 * `not implemented` applier; M8 wires the daemon-routed real applier.
 *
 * Per spec §"Patch algebra" / 02-ai-engine.md.
 */

import type {
  A1Pos,
  A1Range,
  CellValue,
  MemoMeta,
  TextPos,
  TextRange,
} from '../types';

/** Hard cap on `sheet.moveRange.mappings.length`. Beyond this, the model
 *  must use a `plan` intent and ask the user to sort via the column
 *  header. Validated at stage-time. */
export const SHEET_MOVE_RANGE_MAX_MAPPINGS = 200;

/** Hard cap on `propose_patches.patches.length`. */
export const PROPOSE_PATCHES_MAX = 100;

export type Patch =
  | TextReplacePatch
  | TextInsertPatch
  | TextDeletePatch
  | FileCreatePatch
  | SheetWriteRangePatch
  | SheetAddSheetPatch
  | SheetMoveRangePatch
  | MemoCreatePatch
  | MemoReplacePatch
  | MemoMetadataPatchPatch
  | MemoLinkPatch
  | StudioReplaceBlockPatch
  | StudioInsertBlockPatch
  | StudioDeleteBlockPatch
  | BrainAppendPatch;

/** Block kinds Studio renders. Mirrored from
 *  `@tytus/app-studio` `BlockKind` — duplicated here so the engine
 *  package stays free of an app-package dep. Studio's repo asserts the
 *  union round-trips. */
export type StudioBlockKind =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'paragraph'
  | 'bullet'
  | 'code'
  | 'image'
  | 'embed'
  | 'separator';

export interface TextReplacePatch {
  kind: 'text.replace';
  docId: string;
  range: TextRange;
  text: string;
}

export interface TextInsertPatch {
  kind: 'text.insert';
  docId: string;
  at: TextPos;
  text: string;
}

export interface TextDeletePatch {
  kind: 'text.delete';
  docId: string;
  range: TextRange;
}

export interface FileCreatePatch {
  kind: 'file.create';
  parentId: string;
  name: string;
  content: string | Uint8Array;
  /** 'fail' rejects on collision; 'rename' appends -2/-3/… */
  existsPolicy: 'fail' | 'rename';
}

export interface SheetWriteRangePatch {
  kind: 'sheet.writeRange';
  sheetId: string;
  range: A1Range;
  values: CellValue[][];
}

export interface SheetAddSheetPatch {
  kind: 'sheet.addSheet';
  name: string;
  cells?: Record<A1Pos, CellValue>;
}

export interface SheetMoveRangePatch {
  kind: 'sheet.moveRange';
  sheetId: string;
  /** Maximum 200 mappings; over-cap rejects with `error.errorKind === 'patch_invalid'`. */
  mappings: Array<{ from: A1Range; to: A1Pos }>;
}

export interface MemoCreatePatch {
  kind: 'memo.create';
  folder: string;
  title: string;
  body: string;
  tags?: string[];
}

export interface MemoReplacePatch {
  kind: 'memo.replace';
  memoId: string;
  body: string;
}

export interface MemoMetadataPatchPatch {
  kind: 'memo.metadataPatch';
  memoId: string;
  set?: Partial<MemoMeta>;
  addTags?: string[];
  removeTags?: string[];
}

export interface MemoLinkPatch {
  kind: 'memo.link';
  fromMemoId: string;
  toMemoId: string;
  insertAt: TextPos;
}

export interface BrainAppendPatch {
  kind: 'brain.append';
  target: 'today' | { page: string };
  block: string;
  /** Required ai-source provenance string ("tytus-os/memo:v<N>"). */
  aiSource: string;
}

/**
 * Replace the text (and optionally the kind) of an existing Studio
 * block in-place. The applier writes to `app_studio_blocks` and bumps
 * the parent doc's `updated_at`. Maps 1:1 onto `documentRepo.updateBlock`.
 */
export interface StudioReplaceBlockPatch {
  kind: 'studio.replaceBlock';
  docId: string;
  blockId: string;
  newText: string;
  /** Optional kind override — Rewrite that converts a paragraph to a
   *  heading-1 supplies this. Leave undefined to preserve the existing
   *  kind. */
  newBlockKind?: StudioBlockKind;
}

/**
 * Insert a new block adjacent to a reference block in a Studio
 * document. Exactly one of `beforeBlockId` / `afterBlockId` must be set.
 * The applier resolves the position via the repo's `positionFor(...)`
 * (sparse 1024-step sort key, midpoint-on-insert).
 */
export interface StudioInsertBlockPatch {
  kind: 'studio.insertBlock';
  docId: string;
  /** Insert above the referenced block (mutually exclusive with afterBlockId). */
  beforeBlockId?: string;
  /** Insert below the referenced block (mutually exclusive with beforeBlockId). */
  afterBlockId?: string;
  block: {
    kind: StudioBlockKind;
    text: string;
    meta?: Record<string, unknown>;
  };
}

/**
 * Delete a Studio block. The applier writes to `app_studio_blocks`
 * and bumps the parent doc's `updated_at`.
 */
export interface StudioDeleteBlockPatch {
  kind: 'studio.deleteBlock';
  docId: string;
  blockId: string;
}

/**
 * Result type for static patch validation (separate from PatchApplier
 * runtime checks against current document state). The TransactionRunner
 * runs `validatePatch(p)` before stage-time so malformed patches surface
 * before any prepare() runs.
 */
export type PatchValidationIssue = { path: string; message: string };

/** Static validation — checks structural rules from the spec (e.g.
 *  sheet.moveRange max-200 mappings, file.create reserved-names blocked).
 *  NOT runtime state validation (that's PatchApplier.prepare). */
export function validatePatch(patch: Patch): PatchValidationIssue[] {
  const issues: PatchValidationIssue[] = [];
  switch (patch.kind) {
    case 'sheet.moveRange':
      if (patch.mappings.length > SHEET_MOVE_RANGE_MAX_MAPPINGS) {
        issues.push({
          path: '/mappings',
          message: `sheet.moveRange capped at ${SHEET_MOVE_RANGE_MAX_MAPPINGS} mappings, got ${patch.mappings.length}. Use a plan intent + UI sort instead.`,
        });
      }
      if (patch.mappings.length === 0) {
        issues.push({
          path: '/mappings',
          message: 'sheet.moveRange requires at least 1 mapping',
        });
      }
      break;
    case 'file.create': {
      const name = patch.name;
      if (!name || name === '.' || name === '..') {
        issues.push({
          path: '/name',
          message: `invalid file name: "${name}"`,
        });
      }
      if (
        name.startsWith('.') &&
        patch.existsPolicy !== 'rename'
      ) {
        issues.push({
          path: '/name',
          message: `hidden names (.-prefixed) only allowed with existsPolicy: 'rename', got "${name}"`,
        });
      }
      const reserved = new Set([
        'CON',
        'PRN',
        'AUX',
        'NUL',
        'COM1',
        'COM2',
        'LPT1',
        'LPT2',
      ]);
      if (reserved.has(name.toUpperCase())) {
        issues.push({
          path: '/name',
          message: `reserved file name: "${name}"`,
        });
      }
      break;
    }
    case 'text.replace':
    case 'text.delete': {
      const { start, end } = patch.range;
      if (start.offset < 0 || end.offset < start.offset) {
        issues.push({
          path: '/range',
          message: `invalid text range: start=${start.offset}, end=${end.offset}`,
        });
      }
      break;
    }
    case 'text.insert':
      if (patch.at.offset < 0) {
        issues.push({
          path: '/at',
          message: `invalid insert offset: ${patch.at.offset}`,
        });
      }
      break;
    case 'brain.append':
      if (!patch.aiSource) {
        issues.push({
          path: '/aiSource',
          message:
            'brain.append requires non-empty aiSource (e.g. "tytus-os/memo:v1")',
        });
      }
      break;
    case 'memo.create':
      if (!patch.title) {
        issues.push({ path: '/title', message: 'memo.create requires a title' });
      }
      break;
    // sheet.writeRange / sheet.addSheet / memo.replace / memo.metadataPatch /
    // memo.link have no static-only invariants beyond the shape; runtime
    // checks happen in their PatchApplier.prepare.
    case 'studio.replaceBlock':
      if (!patch.docId) {
        issues.push({
          path: '/docId',
          message: 'studio.replaceBlock requires a non-empty docId',
        });
      }
      if (!patch.blockId) {
        issues.push({
          path: '/blockId',
          message: 'studio.replaceBlock requires a non-empty blockId',
        });
      }
      if (typeof patch.newText !== 'string') {
        issues.push({
          path: '/newText',
          message: 'studio.replaceBlock requires newText (string)',
        });
      }
      break;
    case 'studio.insertBlock':
      if (!patch.docId) {
        issues.push({
          path: '/docId',
          message: 'studio.insertBlock requires a non-empty docId',
        });
      }
      if (!patch.beforeBlockId && !patch.afterBlockId) {
        issues.push({
          path: '/anchor',
          message:
            'studio.insertBlock requires exactly one of beforeBlockId or afterBlockId',
        });
      }
      if (patch.beforeBlockId && patch.afterBlockId) {
        issues.push({
          path: '/anchor',
          message:
            'studio.insertBlock cannot set both beforeBlockId and afterBlockId',
        });
      }
      if (!patch.block || typeof patch.block !== 'object') {
        issues.push({
          path: '/block',
          message: 'studio.insertBlock requires a block object',
        });
      } else {
        if (typeof patch.block.text !== 'string') {
          issues.push({
            path: '/block/text',
            message: 'studio.insertBlock requires block.text (string)',
          });
        }
        if (!patch.block.kind) {
          issues.push({
            path: '/block/kind',
            message: 'studio.insertBlock requires block.kind',
          });
        }
      }
      break;
    case 'studio.deleteBlock':
      if (!patch.docId) {
        issues.push({
          path: '/docId',
          message: 'studio.deleteBlock requires a non-empty docId',
        });
      }
      if (!patch.blockId) {
        issues.push({
          path: '/blockId',
          message: 'studio.deleteBlock requires a non-empty blockId',
        });
      }
      break;
    case 'sheet.writeRange':
    case 'sheet.addSheet':
    case 'memo.replace':
    case 'memo.metadataPatch':
    case 'memo.link':
      break;
  }
  return issues;
}

/** True when the patch is currently fenced behind a "not implemented"
 *  applier (M2-M7 → M8 wires brain.append). Apps surface this gracefully
 *  in the transaction modal. */
export function isPatchUnimplemented(patch: Patch): boolean {
  return patch.kind === 'brain.append';
}

/** Returns the docId touched by a patch, when it operates on a document
 *  buffer (text + memo.replace). Used by TransactionRunner to compute
 *  baseRevisions. Returns null for patches that don't write a buffer
 *  document (file.create makes a new file; sheet.* reference sheetId, not
 *  buffer documentId; brain.append targets a journal page). */
export function patchDocId(patch: Patch): string | null {
  switch (patch.kind) {
    case 'text.replace':
    case 'text.insert':
    case 'text.delete':
      return patch.docId;
    case 'memo.replace':
      return patch.memoId;
    case 'studio.replaceBlock':
    case 'studio.insertBlock':
    case 'studio.deleteBlock':
      return patch.docId;
    default:
      return null;
  }
}
