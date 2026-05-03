// Sheet repo tests — exercise the CRUD against an in-memory AppDb fake.
// Mirrors the Voice Recorder pattern (no real SQLite, just a deterministic
// row store keyed off SQL string-shape).
//
// Three things this guards:
//   1. Behaviour parity (createSheet/listSheets/setCell/getCells/importCsv).
//   2. Every SQL string actually targets the per-app prefixed
//      `app_sheet_*` tables — if a future edit drops the prefix the
//      host-api prefix guard would reject the query at runtime, but
//      here we catch it at test time.
//   3. importCsv parses simple CSV correctly into individual cells.

import { describe, it, expect } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  listSheets,
  createSheet,
  getCells,
  setCell,
  importCsv,
} from './sheetRepo';

interface SqlCall {
  sql: string;
  args: readonly unknown[];
}

interface StoredSheet {
  id: string;
  name: string;
  rows: number;
  cols: number;
  created_at: number;
  updated_at: number;
}

interface StoredCell {
  sheet_id: string;
  row: number;
  col: number;
  value: string;
  formula: string | null;
  updated_at: number;
}

class MemoryAppDb implements AppDb {
  sheets: StoredSheet[] = [];
  cells: StoredCell[] = [];
  runCalls: SqlCall[] = [];
  queryCalls: SqlCall[] = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    this.runCalls.push({ sql, args });

    if (/INSERT\s+INTO\s+app_sheet_sheets/i.test(sql)) {
      const [id, name, rows, cols, created_at, updated_at] = args as [
        string, string, number, number, number, number,
      ];
      this.sheets.push({ id, name, rows, cols, created_at, updated_at });
      return { lastInsertRowid: 0, changes: 1 };
    }

    if (/INSERT\s+INTO\s+app_sheet_cells/i.test(sql)) {
      const [sheet_id, row, col, value, updated_at] = args as [
        string, number, number, string, number,
      ];
      const idx = this.cells.findIndex(
        (c) => c.sheet_id === sheet_id && c.row === row && c.col === col,
      );
      const stored: StoredCell = {
        sheet_id, row, col, value,
        formula: null,
        updated_at,
      };
      if (idx >= 0) this.cells[idx] = stored;
      else this.cells.push(stored);
      return { lastInsertRowid: 0, changes: 1 };
    }

    if (/DELETE\s+FROM\s+app_sheet_cells/i.test(sql)) {
      const [sheet_id, row, col] = args as [string, number, number];
      const before = this.cells.length;
      this.cells = this.cells.filter(
        (c) => !(c.sheet_id === sheet_id && c.row === row && c.col === col),
      );
      return { lastInsertRowid: 0, changes: before - this.cells.length };
    }

    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    this.queryCalls.push({ sql, args });

    if (/FROM\s+app_sheet_sheets/i.test(sql)) {
      return [...this.sheets].sort((a, b) => a.created_at - b.created_at) as unknown as T[];
    }

    if (/FROM\s+app_sheet_cells/i.test(sql)) {
      const sheetId = args[0] as string;
      let rows = this.cells.filter((c) => c.sheet_id === sheetId);
      if (args.length === 5) {
        const [, rowStart, rowEnd, colStart, colEnd] = args as [
          string, number, number, number, number,
        ];
        rows = rows.filter(
          (c) =>
            c.row >= rowStart && c.row <= rowEnd &&
            c.col >= colStart && c.col <= colEnd,
        );
      }
      rows = rows.sort((a, b) => a.row - b.row || a.col - b.col);
      return rows as unknown as T[];
    }

    return [];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_sheet_sheets', 'app_sheet_cells'];
  }
}

describe('sheetRepo', () => {
  it('createSheet inserts a row and listSheets returns it', async () => {
    const db = new MemoryAppDb();
    const sheet = await createSheet(db, { name: 'Sheet1', now: 1000 });
    expect(sheet.name).toBe('Sheet1');
    expect(sheet.rows).toBe(50);
    expect(sheet.cols).toBe(26);

    const all = await listSheets(db);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(sheet.id);
    expect(all[0].name).toBe('Sheet1');
  });

  it('listSheets orders by created_at ASC', async () => {
    const db = new MemoryAppDb();
    await createSheet(db, { id: 'a', name: 'A', now: 100 });
    await createSheet(db, { id: 'b', name: 'B', now: 300 });
    await createSheet(db, { id: 'c', name: 'C', now: 200 });
    const all = await listSheets(db);
    expect(all.map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('setCell + getCells round-trip a single cell', async () => {
    const db = new MemoryAppDb();
    await setCell(db, 'sheet1', 2, 3, 'hello', 5000);
    const cells = await getCells(db, 'sheet1');
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({
      sheetId: 'sheet1',
      row: 2,
      col: 3,
      value: 'hello',
      formula: null,
      updatedAt: 5000,
    });
  });

  it('setCell with empty value deletes the cell row', async () => {
    const db = new MemoryAppDb();
    await setCell(db, 'sheet1', 1, 1, 'a', 1000);
    await setCell(db, 'sheet1', 1, 2, 'b', 1000);
    expect(await getCells(db, 'sheet1')).toHaveLength(2);
    await setCell(db, 'sheet1', 1, 1, '', 2000);
    const remaining = await getCells(db, 'sheet1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].col).toBe(2);
  });

  it('getCells with a range filters to the bounding box', async () => {
    const db = new MemoryAppDb();
    await setCell(db, 'sheet1', 1, 1, 'a');
    await setCell(db, 'sheet1', 1, 5, 'b');
    await setCell(db, 'sheet1', 3, 1, 'c');
    await setCell(db, 'sheet1', 5, 5, 'd');
    const inside = await getCells(db, 'sheet1', {
      rowStart: 1, rowEnd: 3, colStart: 1, colEnd: 4,
    });
    const values = inside.map((c) => c.value).sort();
    expect(values).toEqual(['a', 'c']);
  });

  it('importCsv parses "a,b\\n1,2" into 4 cells at the default 1-indexed offset', async () => {
    const db = new MemoryAppDb();
    const result = await importCsv(db, 'sheet1', 'a,b\n1,2', { now: 9999 });
    expect(result).toEqual({ rowsImported: 2, colsImported: 2 });

    const cells = await getCells(db, 'sheet1');
    expect(cells).toHaveLength(4);

    const map = new Map<string, string>();
    for (const c of cells) map.set(`${c.row},${c.col}`, c.value);
    expect(map.get('1,1')).toBe('a');
    expect(map.get('1,2')).toBe('b');
    expect(map.get('2,1')).toBe('1');
    expect(map.get('2,2')).toBe('2');
  });

  it('importCsv skips empty fields and preserves quoted commas', async () => {
    const db = new MemoryAppDb();
    await importCsv(db, 'sheet1', 'a,,c\n"d,e",f,g', { now: 1 });
    const cells = await getCells(db, 'sheet1');
    const map = new Map<string, string>();
    for (const c of cells) map.set(`${c.row},${c.col}`, c.value);
    // Row 1: a,_,c — middle column is empty, must NOT be persisted.
    expect(map.get('1,1')).toBe('a');
    expect(map.has('1,2')).toBe(false);
    expect(map.get('1,3')).toBe('c');
    // Row 2: "d,e",f,g — first cell has the quoted comma preserved.
    expect(map.get('2,1')).toBe('d,e');
    expect(map.get('2,2')).toBe('f');
    expect(map.get('2,3')).toBe('g');
  });

  it('every SQL verb targets only the prefixed app_sheet_* tables', async () => {
    const db = new MemoryAppDb();
    const sheet = await createSheet(db, { name: 'pin', now: 1 });
    await setCell(db, sheet.id, 1, 1, 'x');
    await setCell(db, sheet.id, 1, 1, '');
    await listSheets(db);
    await getCells(db, sheet.id);
    await getCells(db, sheet.id, {
      rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2,
    });
    await importCsv(db, sheet.id, 'a,b');

    const allSql = [
      ...db.runCalls.map((c) => c.sql),
      ...db.queryCalls.map((c) => c.sql),
    ];
    for (const sql of allSql) {
      expect(sql).toMatch(/app_sheet_(sheets|cells)/);
      // Legacy in-tree localStorage key was `tytus_spreadsheet`; if it
      // ever leaks into a SQL string, the test catches it.
      expect(sql).not.toMatch(/tytus_spreadsheet/);
    }
  });
});
