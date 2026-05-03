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

export type {
  EngineEvent,
  TokenEvent,
  ToolCallEvent,
  ToolResultEvent,
  StagedPatchEvent,
  DoneEvent,
  ErrorEvent,
} from './events';

export type { ConsumeOptions, SsePodResponse } from './stream';
export { consumeStream, parseSseEvent, streamFromStrings } from './stream';

export type { Endpoint, ModelInfo } from './router';
export { PodOfflineError, discoverModels, pickModel, resolveEndpoint } from './router';

export type {
  CostReporterDeps,
  CostStore,
  UsageRecord,
} from './cost';
export { CostReporter, MemoryCostStore } from './cost';

export type { PromptDocument } from './prompts';
export { loadPrompt, parsePromptDocument, promptPath } from './prompts';

export type { ContextTrimResult, ContextTurn, SummaryFn } from './context';
export { trimContext } from './context';

export type { ToolRegistry } from './tools/registry';
export { createToolRegistry } from './tools/registry';

export type {
  ConsentScope,
  ConsentScopePreset,
  FileRefReadFactoryOpts,
} from './tools/common/fileRefRead';
export {
  classifyScope,
  fileRefReadTool,
  presetAutoApproves,
} from './tools/common/fileRefRead';

export type { WebFetchFactoryOpts } from './tools/common/webFetch';
export {
  classifyUrl,
  isAllowedContentType,
  isPrivateIPv4,
  isPrivateIPv6,
  webFetchTool,
} from './tools/common/webFetch';

// W6 PR-Sheet-Engine (M4.4) — sheet-specific tools.
export type {
  CellReadRangeArgs,
  CellReadRangeFactoryOpts,
  CellReadRangeResult,
  CellReadSheetArgs,
  CellReadSheetFactoryOpts,
  CellReadSheetResult,
  CellFormulaArgs,
  CellFormulaResult,
} from './tools/sheet';
export {
  CELL_FORMULA_TOOL_NAME,
  CELL_READ_RANGE_TOOL_NAME,
  CELL_READ_SHEET_TOOL_NAME,
  cellFormulaTool,
  cellReadRangeTool,
  cellReadSheetTool,
  evaluateFormula,
  makeSheetTools,
  parseCellFormulaArgs,
  parseCellReadRangeArgs,
  parseCellReadSheetArgs,
  readRange,
  readSheet,
} from './tools/sheet';

export type {
  ChatMessage,
  ChatRequest,
  PodTransport,
} from './transport';
export { makeHostPodTransport, toOpenAiTools } from './transport';

export type { CreateSessionTestOptions } from './engine';
export { createSession, createSessionWithTransport } from './engine';
