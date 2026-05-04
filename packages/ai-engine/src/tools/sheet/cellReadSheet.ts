/**
 * `cellReadSheetTool(opts)` — Sheet-specific tool factory that reads
 * the entire grid of one sheet plus its declared dimensions.
 *
 * Bound to an `AppDb` at session-creation time. Returns
 * `{ rows, cols, cells }` where `cells` is a 2D row-major dense
 * rectangle sized exactly `rows × cols`. Missing cells render as ''.
 *
 * Reads target `app_sheet_sheets` (for dimensions) + `app_sheet_cells`
 * (for the values). Throws if the sheet id is unknown.
 */
import type { AppDb } from '@tytus/host-api';
import type { ToolDef } from '../../types';

export interface CellReadSheetFactoryOpts {
  /** Per-app SQLite handle. */
  db: AppDb;
}

export interface CellReadSheetArgs {
  sheetId: string;
}

export interface CellReadSheetResult {
  sheetId: string;
  rows: number;
  cols: number;
  cells: string[][];
}

const TOOL_NAME = 'sheet.cellReadSheet';

const TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    sheetId: {
      type: 'string',
      description: 'Sheet id (the row-key of `app_sheet_sheets`).',
    },
  },
  required: ['sheetId'],
};

interface SheetDimsRow {
  rows: number;
  cols: number;
}

interface CellDbRow {
  row: number;
  col: number;
  value: string;
}

/** Coerce + range-check a CellReadSheetArgs payload. Throws on bad shape. */
export function parseCellReadSheetArgs(raw: unknown): CellReadSheetArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('sheet.cellReadSheet: args must be an object');
  }
  const a = raw as Record<string, unknown>;
  const sheetId = a.sheetId;
  if (typeof sheetId !== 'string' || sheetId.length === 0) {
    throw new Error('sheet.cellReadSheet: missing or invalid sheetId');
  }
  return { sheetId };
}

export async function readSheet(
  db: AppDb,
  args: CellReadSheetArgs,
): Promise<CellReadSheetResult> {
  const dims = await db.query<SheetDimsRow>(
    `SELECT rows, cols FROM app_sheet_sheets WHERE id = ?`,
    [args.sheetId],
  );
  if (dims.length === 0) {
    throw new Error(`sheet.cellReadSheet: unknown sheetId "${args.sheetId}"`);
  }
  const { rows, cols } = dims[0];
  const cellRows = await db.query<CellDbRow>(
    `SELECT row, col, value FROM app_sheet_cells
       WHERE sheet_id = ?
       ORDER BY row ASC, col ASC`,
    [args.sheetId],
  );
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ''),
  );
  for (const r of cellRows) {
    // Cells use 1-indexed coordinates; convert to 0-indexed grid offsets.
    const ri = r.row - 1;
    const ci = r.col - 1;
    if (ri >= 0 && ri < rows && ci >= 0 && ci < cols) {
      grid[ri][ci] = r.value;
    }
  }
  return { sheetId: args.sheetId, rows, cols, cells: grid };
}

/** Build the sheet.cellReadSheet ToolDef bound to an AppDb. */
export function cellReadSheetTool(opts: CellReadSheetFactoryOpts): ToolDef {
  return {
    name: TOOL_NAME,
    description:
      'Read the entire grid of one sheet. Returns the declared (rows, cols) plus a dense 2D row-major string array of values; missing cells render as the empty string.',
    parameters: TOOL_PARAMETERS,
    requiresApproval: false,
    execute: async (args) => {
      const parsed = parseCellReadSheetArgs(args);
      return readSheet(opts.db, parsed);
    },
  };
}

export const CELL_READ_SHEET_TOOL_NAME = TOOL_NAME;
