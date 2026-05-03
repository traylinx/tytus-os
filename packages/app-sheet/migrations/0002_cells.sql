-- Sheet — multi-cell grid model. Lifts the legacy in-tree
-- Spreadsheet's per-sheet `Record<string, CellData>` localStorage
-- blob into per-app SQLite, so the engine's `cellReadRange` /
-- `cellReadSheet` tools (PR-M4.4) can read individual cells without
-- decoding a JSON document.
--
-- Two tables:
--   - app_sheet_sheets — one row per sheet (id, name, dimensions).
--   - app_sheet_cells  — one row per (sheet_id, row, col) cell.
--
-- Both physical names use the per-app prefix `app_sheet_*`; the
-- host-api prefix guard rejects any query that drops the prefix.
-- M4.2 only persists raw `value`; `formula` is reserved for the
-- engine wiring in PR-M4.4.

CREATE TABLE IF NOT EXISTS app_sheet_cells (
  sheet_id   TEXT NOT NULL,
  row        INTEGER NOT NULL,
  col        INTEGER NOT NULL,
  value      TEXT NOT NULL DEFAULT '',
  formula    TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sheet_id, row, col)
);

CREATE TABLE IF NOT EXISTS app_sheet_sheets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  rows        INTEGER NOT NULL DEFAULT 50,
  cols        INTEGER NOT NULL DEFAULT 26,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_sheet_cells_sheet
  ON app_sheet_cells(sheet_id);
