/**
 * @tytus/ai-engine — optional middleware that Sheet, Studio, and Memo
 * rent for AI-driven document editing. Pure TS, no React, no DOM.
 *
 * M2 ships the engine package skeleton + Patch algebra + TransactionRunner.
 * Subsequent sub-PRs land the SSE consumer, common tools, cost telemetry,
 * and the createSession orchestrator.
 */

export type {
  AppId,
  AppMode,
  AssetResolver,
  CellValue,
  CostSummary,
  ErrorKind,
  MemoMeta,
  PreviewBlock,
  SendRequest,
  Session,
  SessionOptions,
  TextPos,
  TextRange,
  TokenUsage,
  ToolCtx,
  ToolDef,
  TransactionOutcome,
  A1,
  A1Pos,
  A1Range,
} from './types';

export type {
  Patch,
  PatchValidationIssue,
  TextReplacePatch,
  TextInsertPatch,
  TextDeletePatch,
  FileCreatePatch,
  SheetWriteRangePatch,
  SheetAddSheetPatch,
  SheetMoveRangePatch,
  MemoCreatePatch,
  MemoReplacePatch,
  MemoMetadataPatchPatch,
  MemoLinkPatch,
  BrainAppendPatch,
} from './edits/algebra';
export {
  PROPOSE_PATCHES_MAX,
  SHEET_MOVE_RANGE_MAX_MAPPINGS,
  isPatchUnimplemented,
  patchDocId,
  validatePatch,
} from './edits/algebra';

export type {
  CommitResult,
  PatchApplier,
  PreparedPatch,
  RunnerDeps,
  RunnerOutcome,
  Transaction,
  TxCtx,
} from './edits/transaction';
export { TransactionRunner } from './edits/transaction';
