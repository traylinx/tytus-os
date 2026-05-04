/**
 * Tests for the `sheet.cellReadRange` tool. Uses an in-memory AppDb
 * fake mirroring the per-app `app_sheet_cells` table so the SQL the
 * tool emits is exercised end-to-end without sqlite-wasm.
 */
import { describe, expect, it } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  CELL_READ_RANGE_TOOL_NAME,
  cellReadRangeTool,
  parseCellReadRangeArgs,
  readRange,
} from './cellReadRange';

interface FakeCell {
  sheet_id: string;
  row: number;
  col: number;
  value: string;
  formula: string | null;
  updated_at: number;
}

class MemoryAppDb implements AppDb {
  cells: FakeCell[] = [];

  async run(_sql: string, _args: readonly unknown[] = []): Promise<RunResult> {
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    if (/FROM\s+app_sheet_cells/i.test(sql)) {
      // args: sheetId, rowFrom, rowTo, colFrom, colTo
      const [sheetId, rowFrom, rowTo, colFrom, colTo] = args as [
        string,
        number,
        number,
        number,
        number,
      ];
      return this.cells
        .filter(
          (c) =>
            c.sheet_id === sheetId &&
            c.row >= rowFrom &&
            c.row <= rowTo &&
            c.col >= colFrom &&
            c.col <= colTo,
        )
        .sort((a, b) => a.row - b.row || a.col - b.col) as unknown as T[];
    }
    return [];
  }

  async migrate(): Promise<void> {}
  async listOwnedTables(): Promise<string[]> {
    return ['app_sheet_cells'];
  }
}

function seed(db: MemoryAppDb, sheetId: string, rows: Array<[number, number, string]>) {
  for (const [row, col, value] of rows) {
    db.cells.push({
      sheet_id: sheetId,
      row,
      col,
      value,
      formula: null,
      updated_at: 0,
    });
  }
}

describe('sheet.cellReadRange', () => {
  it('exposes the canonical tool name + parameters', () => {
    expect(CELL_READ_RANGE_TOOL_NAME).toBe('sheet.cellReadRange');
    const tool = cellReadRangeTool({ db: new MemoryAppDb() });
    expect(tool.name).toBe('sheet.cellReadRange');
    expect(tool.requiresApproval).toBe(false);
    expect(tool.parameters.required).toEqual([
      'sheetId',
      'fromRow',
      'fromCol',
      'toRow',
      'toCol',
    ]);
  });

  it('happy path: returns a 2D row-major dense rectangle', async () => {
    const db = new MemoryAppDb();
    seed(db, 's1', [
      [1, 1, 'A1'],
      [1, 2, 'B1'],
      [2, 1, 'A2'],
      [2, 2, 'B2'],
    ]);
    const tool = cellReadRangeTool({ db });
    const result = (await tool.execute(
      { sheetId: 's1', fromRow: 1, fromCol: 1, toRow: 2, toCol: 2 },
      { sessionId: 's', appId: 'sheet', approvalAlreadyGranted: false },
    )) as { cells: string[][] };
    expect(result.cells).toEqual([
      ['A1', 'B1'],
      ['A2', 'B2'],
    ]);
  });

  it('boundary: empty range returns dense empty strings', async () => {
    const db = new MemoryAppDb();
    // Sheet has nothing in (5..6, 5..6).
    seed(db, 's1', [[1, 1, 'NW']]);
    const result = await readRange(db, {
      sheetId: 's1',
      fromRow: 5,
      fromCol: 5,
      toRow: 6,
      toCol: 6,
    });
    expect(result.cells).toEqual([
      ['', ''],
      ['', ''],
    ]);
  });

  it('boundary: single-cell range still yields a 1x1 grid', async () => {
    const db = new MemoryAppDb();
    seed(db, 's1', [[3, 4, 'lonely']]);
    const result = await readRange(db, {
      sheetId: 's1',
      fromRow: 3,
      fromCol: 4,
      toRow: 3,
      toCol: 4,
    });
    expect(result.cells).toEqual([['lonely']]);
  });

  it('error: invalid args (missing sheetId, non-int rows) throw', () => {
    expect(() => parseCellReadRangeArgs({})).toThrow(/sheetId/);
    expect(() =>
      parseCellReadRangeArgs({
        sheetId: 's',
        fromRow: 1,
        fromCol: 1,
        toRow: 1,
        toCol: 'x',
      }),
    ).toThrow(/toCol/);
    expect(() =>
      parseCellReadRangeArgs({
        sheetId: 's',
        fromRow: 5,
        fromCol: 1,
        toRow: 1,
        toCol: 1,
      }),
    ).toThrow(/toRow.*fromRow/);
  });

  it('skips cells from other sheets even when row/col overlap', async () => {
    const db = new MemoryAppDb();
    seed(db, 's1', [[1, 1, 'mine']]);
    seed(db, 's2', [[1, 1, 'theirs']]);
    const result = await readRange(db, {
      sheetId: 's1',
      fromRow: 1,
      fromCol: 1,
      toRow: 1,
      toCol: 1,
    });
    expect(result.cells).toEqual([['mine']]);
  });
});
