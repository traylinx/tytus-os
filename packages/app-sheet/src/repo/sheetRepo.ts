// Sheet repo — workspace-package edition.
//
// All SQL targets the per-app prefixed tables `app_sheet_sheets` /
// `app_sheet_cells`. The host-api prefix guard rejects any query
// that drops the `app_sheet_` prefix at runtime; the repo tests
// pin this at unit time too.
//
// M4.2 stores raw `value` only — the `formula` column is reserved
// for the engine wiring in PR-M4.4. Keep the column populated as
// NULL for now so a schema migration isn't required when the
// engine starts writing it.

import type { AppDb } from '@tytus/host-api';
import { parseCsv } from '../lib/csv';

export interface SheetRow {
  id: string;
  name: string;
  rows: number;
  cols: number;
  createdAt: number;
  updatedAt: number;
}

export interface CellRow {
  sheetId: string;
  row: number;
  col: number;
  value: string;
  formula: string | null;
  updatedAt: number;
}

export interface CellRange {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

interface SheetDbRow {
  id: string;
  name: string;
  rows: number;
  cols: number;
  created_at: number;
  updated_at: number;
}

interface CellDbRow {
  sheet_id: string;
  row: number;
  col: number;
  value: string;
  formula: string | null;
  updated_at: number;
}

const fromSheetDb = (r: SheetDbRow): SheetRow => ({
  id: r.id,
  name: r.name,
  rows: r.rows,
  cols: r.cols,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const fromCellDb = (r: CellDbRow): CellRow => ({
  sheetId: r.sheet_id,
  row: r.row,
  col: r.col,
  value: r.value,
  formula: r.formula,
  updatedAt: r.updated_at,
});

export const listSheets = async (db: AppDb): Promise<SheetRow[]> => {
  const rows = await db.query<SheetDbRow>(
    `SELECT id, name, rows, cols, created_at, updated_at
       FROM app_sheet_sheets
      ORDER BY created_at ASC`,
  );
  return rows.map(fromSheetDb);
};

export const createSheet = async (
  db: AppDb,
  opts: {
    id?: string;
    name: string;
    rows?: number;
    cols?: number;
    now?: number;
  },
): Promise<SheetRow> => {
  const now = opts.now ?? Date.now();
  const id =
    opts.id ?? `s_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const rows = opts.rows ?? 50;
  const cols = opts.cols ?? 26;
  await db.run(
    `INSERT INTO app_sheet_sheets
       (id, name, rows, cols, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, opts.name, rows, cols, now, now],
  );
  return {
    id,
    name: opts.name,
    rows,
    cols,
    createdAt: now,
    updatedAt: now,
  };
};

export const getCells = async (
  db: AppDb,
  sheetId: string,
  range?: CellRange,
): Promise<CellRow[]> => {
  if (range) {
    const rows = await db.query<CellDbRow>(
      `SELECT sheet_id, row, col, value, formula, updated_at
         FROM app_sheet_cells
        WHERE sheet_id = ?
          AND row BETWEEN ? AND ?
          AND col BETWEEN ? AND ?
        ORDER BY row ASC, col ASC`,
      [sheetId, range.rowStart, range.rowEnd, range.colStart, range.colEnd],
    );
    return rows.map(fromCellDb);
  }
  const rows = await db.query<CellDbRow>(
    `SELECT sheet_id, row, col, value, formula, updated_at
       FROM app_sheet_cells
      WHERE sheet_id = ?
      ORDER BY row ASC, col ASC`,
    [sheetId],
  );
  return rows.map(fromCellDb);
};

export const setCell = async (
  db: AppDb,
  sheetId: string,
  row: number,
  col: number,
  value: string,
  now?: number,
): Promise<void> => {
  const updatedAt = now ?? Date.now();
  // Empty values prune the row — keeps the table from accumulating
  // empty cells when the user hits Delete on a never-edited cell.
  if (value === '') {
    await db.run(
      `DELETE FROM app_sheet_cells
        WHERE sheet_id = ? AND row = ? AND col = ?`,
      [sheetId, row, col],
    );
    return;
  }
  await db.run(
    `INSERT INTO app_sheet_cells
       (sheet_id, row, col, value, formula, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?)
     ON CONFLICT(sheet_id, row, col) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [sheetId, row, col, value, updatedAt],
  );
};

export const importCsv = async (
  db: AppDb,
  sheetId: string,
  csvText: string,
  opts?: { rowOffset?: number; colOffset?: number; now?: number },
): Promise<{ rowsImported: number; colsImported: number }> => {
  const grid = parseCsv(csvText);
  if (grid.length === 0) return { rowsImported: 0, colsImported: 0 };

  const rowOffset = opts?.rowOffset ?? 1; // M4.2: rows are 1-indexed.
  const colOffset = opts?.colOffset ?? 1;
  const now = opts?.now ?? Date.now();

  let maxCols = 0;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (row.length > maxCols) maxCols = row.length;
    for (let c = 0; c < row.length; c++) {
      const value = row[c];
      // Skip empty cells — same pruning rule as setCell. Mirrors the
      // legacy spreadsheet's "only render cells with a value".
      if (value === '') continue;
      await db.run(
        `INSERT INTO app_sheet_cells
           (sheet_id, row, col, value, formula, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT(sheet_id, row, col) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [sheetId, r + rowOffset, c + colOffset, value, now],
      );
    }
  }

  return { rowsImported: grid.length, colsImported: maxCols };
};
