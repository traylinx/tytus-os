/**
 * `cellReadRangeTool(opts)` — Sheet-specific tool factory that reads a
 * rectangular range of cells from a single sheet and returns the values
 * as a 2D row-major string array.
 *
 * Bound to an `AppDb` at session-creation time. The factory pattern
 * mirrors `fileRefReadTool` / `webFetchTool`: the tool is a closure
 * over the per-app SQLite handle, not a free function. Apps create one
 * tool per Sheet session and pass `[cellReadRange, cellReadSheet,
 * cellFormula]` through `createSession({ tools: SHEET_TOOLS })`.
 *
 * Reads target the per-app prefixed table `app_sheet_cells`; missing
 * cells render as the empty string so the model sees a dense rectangle.
 */
import type { AppDb } from '@tytus/host-api';
import type { ToolDef } from '../../types';

export interface CellReadRangeFactoryOpts {
  /** Per-app SQLite handle. Bound at session-creation time. */
  db: AppDb;
}

export interface CellReadRangeArgs {
  sheetId: string;
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
}

export interface CellReadRangeResult {
  sheetId: string;
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  /** 2D row-major. `cells[r - fromRow][c - fromCol]` is the value at
   *  (r, c). Missing cells render as ''. */
  cells: string[][];
}

const TOOL_NAME = 'sheet.cellReadRange';

const TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    sheetId: {
      type: 'string',
      description: 'Sheet id (the row-key of `app_sheet_sheets`).',
    },
    fromRow: { type: 'integer', description: '1-indexed inclusive top row.' },
    fromCol: { type: 'integer', description: '1-indexed inclusive left col.' },
    toRow: { type: 'integer', description: '1-indexed inclusive bottom row.' },
    toCol: { type: 'integer', description: '1-indexed inclusive right col.' },
  },
  required: ['sheetId', 'fromRow', 'fromCol', 'toRow', 'toCol'],
};

interface CellDbRow {
  row: number;
  col: number;
  value: string;
}

/** Coerce + range-check a CellReadRangeArgs payload. Throws on bad shape. */
export function parseCellReadRangeArgs(raw: unknown): CellReadRangeArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('sheet.cellReadRange: args must be an object');
  }
  const a = raw as Record<string, unknown>;
  const sheetId = a.sheetId;
  if (typeof sheetId !== 'string' || sheetId.length === 0) {
    throw new Error('sheet.cellReadRange: missing or invalid sheetId');
  }
  const ints = ['fromRow', 'fromCol', 'toRow', 'toCol'] as const;
  const out: Record<string, number> = {};
  for (const k of ints) {
    const v = a[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw new Error(`sheet.cellReadRange: ${k} must be an integer >= 1`);
    }
    out[k] = v;
  }
  if (out.toRow < out.fromRow) {
    throw new Error('sheet.cellReadRange: toRow must be >= fromRow');
  }
  if (out.toCol < out.fromCol) {
    throw new Error('sheet.cellReadRange: toCol must be >= fromCol');
  }
  return {
    sheetId,
    fromRow: out.fromRow,
    fromCol: out.fromCol,
    toRow: out.toRow,
    toCol: out.toCol,
  };
}

export async function readRange(
  db: AppDb,
  args: CellReadRangeArgs,
): Promise<CellReadRangeResult> {
  const rows = await db.query<CellDbRow>(
    `SELECT row, col, value
       FROM app_sheet_cells
      WHERE sheet_id = ?
        AND row BETWEEN ? AND ?
        AND col BETWEEN ? AND ?
      ORDER BY row ASC, col ASC`,
    [args.sheetId, args.fromRow, args.toRow, args.fromCol, args.toCol],
  );
  const rowCount = args.toRow - args.fromRow + 1;
  const colCount = args.toCol - args.fromCol + 1;
  const grid: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => ''),
  );
  for (const r of rows) {
    const ri = r.row - args.fromRow;
    const ci = r.col - args.fromCol;
    if (ri >= 0 && ri < rowCount && ci >= 0 && ci < colCount) {
      grid[ri][ci] = r.value;
    }
  }
  return {
    sheetId: args.sheetId,
    fromRow: args.fromRow,
    fromCol: args.fromCol,
    toRow: args.toRow,
    toCol: args.toCol,
    cells: grid,
  };
}

/** Build the sheet.cellReadRange ToolDef bound to an AppDb. */
export function cellReadRangeTool(opts: CellReadRangeFactoryOpts): ToolDef {
  return {
    name: TOOL_NAME,
    description:
      'Read a rectangular range of cells from a sheet. Returns a 2D row-major array of strings; missing cells render as the empty string.',
    parameters: TOOL_PARAMETERS,
    requiresApproval: false,
    execute: async (args) => {
      const parsed = parseCellReadRangeArgs(args);
      return readRange(opts.db, parsed);
    },
  };
}

export const CELL_READ_RANGE_TOOL_NAME = TOOL_NAME;
