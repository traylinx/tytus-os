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
  | BrainAppendPatch;

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
    default:
      return null;
  }
}
