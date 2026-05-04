/**
 * `@tytus/ai-engine` Sheet-tools barrel.
 *
 * Exports the three sheet-specific tools introduced in W6 PR-Sheet-Engine
 * (M4.4): `cellReadRange`, `cellReadSheet`, `cellFormula`. Apps build the
 * triple via `makeSheetTools({ db })` and pass it through
 * `createSession({ tools: SHEET_TOOLS })`.
 *
 * The pure formula evaluator (`evaluateFormula`) is also exported so
 * apps can preview values inline without going through a tool round-
 * trip — the engine session uses the tool form, the UI uses the bare
 * function.
 */
import type { AppDb } from '@tytus/host-api';
import type { ToolDef } from '../../types';
import { cellReadRangeTool } from './cellReadRange';
import { cellReadSheetTool } from './cellReadSheet';
import { cellFormulaTool } from './cellFormula';

export type {
  CellReadRangeArgs,
  CellReadRangeFactoryOpts,
  CellReadRangeResult,
} from './cellReadRange';
export {
  CELL_READ_RANGE_TOOL_NAME,
  cellReadRangeTool,
  parseCellReadRangeArgs,
  readRange,
} from './cellReadRange';

export type {
  CellReadSheetArgs,
  CellReadSheetFactoryOpts,
  CellReadSheetResult,
} from './cellReadSheet';
export {
  CELL_READ_SHEET_TOOL_NAME,
  cellReadSheetTool,
  parseCellReadSheetArgs,
  readSheet,
} from './cellReadSheet';

export type { CellFormulaArgs, CellFormulaResult } from './cellFormula';
export {
  CELL_FORMULA_TOOL_NAME,
  cellFormulaTool,
  evaluateFormula,
  parseCellFormulaArgs,
} from './cellFormula';

/**
 * Build the SHEET_TOOLS triple bound to a single AppDb. Apps call this
 * once per Sheet session and pass the result to `createSession`.
 */
export function makeSheetTools(opts: { db: AppDb }): ToolDef[] {
  return [
    cellReadRangeTool({ db: opts.db }),
    cellReadSheetTool({ db: opts.db }),
    cellFormulaTool(),
  ];
}
