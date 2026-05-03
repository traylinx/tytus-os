/**
 * Tests for the `sheet.cellReadSheet` tool. Covers happy-path full
 * grid read, missing-sheet error path, dense-padding boundary, and
 * arg-validation errors.
 */
import { describe, expect, it } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  CELL_READ_SHEET_TOOL_NAME,
  cellReadSheetTool,
  parseCellReadSheetArgs,
  readSheet,
} from './cellReadSheet';

interface FakeSheet {
  id: string;
  rows: number;
  cols: number;
}
interface FakeCell {
  sheet_id: string;
  row: number;
  col: number;
  value: string;
}

class MemoryAppDb implements AppDb {
  sheets: FakeSheet[] = [];
  cells: FakeCell[] = [];

  async run(): Promise<RunResult> {
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    if (/FROM\s+app_sheet_sheets/i.test(sql)) {
      const id = args[0] as string;
      return this.sheets
        .filter((s) => s.id === id)
        .map((s) => ({ rows: s.rows, cols: s.cols })) as unknown as T[];
    }
    if (/FROM\s+app_sheet_cells/i.test(sql)) {
      const id = args[0] as string;
      return this.cells
        .filter((c) => c.sheet_id === id)
        .sort((a, b) => a.row - b.row || a.col - b.col) as unknown as T[];
    }
    return [];
  }

  async migrate(): Promise<void> {}
  async listOwnedTables(): Promise<string[]> {
    return ['app_sheet_sheets', 'app_sheet_cells'];
  }
}

describe('sheet.cellReadSheet', () => {
  it('exposes the canonical tool name + parameters', () => {
    expect(CELL_READ_SHEET_TOOL_NAME).toBe('sheet.cellReadSheet');
    const tool = cellReadSheetTool({ db: new MemoryAppDb() });
    expect(tool.name).toBe('sheet.cellReadSheet');
    expect(tool.requiresApproval).toBe(false);
    expect(tool.parameters.required).toEqual(['sheetId']);
  });

  it('happy path: returns dimensions + dense 2D grid sized rows x cols', async () => {
    const db = new MemoryAppDb();
    db.sheets.push({ id: 's1', rows: 3, cols: 3 });
    db.cells.push(
      { sheet_id: 's1', row: 1, col: 1, value: 'A1' },
      { sheet_id: 's1', row: 1, col: 2, value: 'B1' },
      { sheet_id: 's1', row: 2, col: 2, value: 'B2' },
      { sheet_id: 's1', row: 3, col: 3, value: 'C3' },
    );
    const result = await readSheet(db, { sheetId: 's1' });
    expect(result.rows).toBe(3);
    expect(result.cols).toBe(3);
    expect(result.cells).toEqual([
      ['A1', 'B1', ''],
      ['', 'B2', ''],
      ['', '', 'C3'],
    ]);
  });

  it('boundary: empty sheet still yields a dense rows x cols grid of empty strings', async () => {
    const db = new MemoryAppDb();
    db.sheets.push({ id: 'empty', rows: 2, cols: 4 });
    const result = await readSheet(db, { sheetId: 'empty' });
    expect(result.cells).toHaveLength(2);
    expect(result.cells[0]).toHaveLength(4);
    for (const row of result.cells) for (const v of row) expect(v).toBe('');
  });

  it('error: missing sheet throws with a descriptive message', async () => {
    const db = new MemoryAppDb();
    await expect(readSheet(db, { sheetId: 'ghost' })).rejects.toThrow(
      /unknown sheetId/,
    );
  });

  it('error: invalid args (non-string sheetId) throw', () => {
    expect(() => parseCellReadSheetArgs({})).toThrow(/sheetId/);
    expect(() => parseCellReadSheetArgs({ sheetId: 42 })).toThrow(/sheetId/);
    expect(() => parseCellReadSheetArgs(null)).toThrow(/object/);
  });

  it('drops cells outside the declared dimensions (defensive)', async () => {
    // If the per-app DB ever ends up with stale cells beyond the sheet's
    // declared rows/cols, the tool must clip them rather than blow up.
    const db = new MemoryAppDb();
    db.sheets.push({ id: 's1', rows: 1, cols: 1 });
    db.cells.push(
      { sheet_id: 's1', row: 1, col: 1, value: 'inside' },
      { sheet_id: 's1', row: 99, col: 99, value: 'outside' },
    );
    const result = await readSheet(db, { sheetId: 's1' });
    expect(result.cells).toEqual([['inside']]);
  });
});
