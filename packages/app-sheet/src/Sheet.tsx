// ============================================================
// Sheet — workspace-package edition (M4.2 lift).
// ============================================================
//
// Lifts the legacy in-tree Spreadsheet (`app/src/apps/Spreadsheet.tsx`)
// onto the apps-platform workspace package. M4.2 narrows scope:
//
//   - Multi-cell grid view (read + edit, debounced persistence to
//     per-app SQLite).
//   - CSV import via file picker → parser → `INSERT INTO app_sheet_cells`.
//   - One ⌘K shell-menu stub: "Add a column for X". The actual engine
//     wiring (createSession + cellReadRange + AI-driven column
//     synthesis) lands in PR-M4.4 — here the menu item just toasts a
//     notification so the user-visible affordance is live.
//
// Style + a11y deliberately match the legacy Spreadsheet (var-driven
// colors, monospace tabular numerics) so the dual-source transition
// looks identical to the user. The legacy file stays in place per
// the W6 cleanup plan.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Upload, Plus, FileSpreadsheet, Sparkles } from 'lucide-react';
import type { AppDb, HostClient } from '@tytus/host-api';
import {
  listSheets,
  createSheet,
  getCells,
  setCell,
  importCsv,
  type SheetRow,
  type CellRow,
} from './repo/sheetRepo';

// ---- Constants -----------------------------------------------------

const DEFAULT_ROWS = 50;
const DEFAULT_COLS = 26;
const VIEWPORT_ROWS = 12;
const VIEWPORT_COLS = 12;
const PERSIST_DEBOUNCE_MS = 300;

// Generate a single column header label ("A", "B", … "Z", "AA"…). The
// legacy Spreadsheet hard-coded 20; we go up to DEFAULT_COLS so the
// workspace edition matches the AI-engine's `cellReadRange` 26-col
// ceiling once that lands in PR-M4.4.
const colLabel = (zeroBased: number): string => {
  let s = '';
  let n = zeroBased;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
};

// Stable cell key for the in-memory edit cache.
const cellKey = (row: number, col: number): string => `${row},${col}`;

// ---- Props ---------------------------------------------------------

export interface SheetProps {
  db: AppDb;
  host: HostClient;
}

export function Sheet({ db, host }: SheetProps) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [cellMap, setCellMap] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Debounced persistence queue. We coalesce rapid keystrokes per cell
  // into one DB write per PERSIST_DEBOUNCE_MS window.
  const pendingRef = useRef<Map<string, { row: number; col: number; value: string }>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Initial hydrate (sheets + cells of first sheet) -----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let all = await listSheets(db);
        if (all.length === 0) {
          // First-run: seed one empty sheet so the grid is mountable.
          const seeded = await createSheet(db, {
            name: 'Sheet1',
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
          });
          all = [seeded];
        }
        if (cancelled) return;
        setSheets(all);
        setActiveSheetId(all[0].id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Could not load sheets.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  // ---- Hydrate cells whenever the active sheet changes ------------
  useEffect(() => {
    if (!activeSheetId) return;
    let cancelled = false;
    (async () => {
      try {
        const cells = await getCells(db, activeSheetId);
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const c of cells) next.set(cellKey(c.row, c.col), c.value);
        setCellMap(next);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Could not load cells.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, activeSheetId]);

  // ---- ⌘K shell-menu stub ----------------------------------------
  // M4.2: register a single Edit group with the "Add a column for X"
  // affordance. Engine wiring lands in PR-M4.4; today the action just
  // posts a notification so the menu is end-to-end mountable.
  useEffect(() => {
    const dispose = host.shellMenu.register({
      appId: host.appId,
      groups: [
        {
          label: 'Edit',
          items: [
            {
              id: 'sheet.add-column-for-x',
              label: 'Add a column for X…',
              shortcut: '⌘K',
              onClick: () => {
                host.notifications.notify({
                  title: 'Add column',
                  body: 'AI integration ships in PR-M4.4',
                  level: 'info',
                });
              },
            },
          ],
        },
      ],
    });
    return dispose;
  }, [host]);

  // ---- Debounced persistence flush -------------------------------
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      void flushPending();
    }, PERSIST_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushPending = useCallback(async () => {
    if (!activeSheetId) return;
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    const drained = Array.from(pending.values());
    pending.clear();
    for (const item of drained) {
      try {
        await setCell(db, activeSheetId, item.row, item.col, item.value);
      } catch (e) {
        setError(`Could not save cell: ${(e as Error).message}`);
      }
    }
  }, [db, activeSheetId]);

  // Flush on unmount so the last keystroke isn't lost.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      void flushPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Cell edit -------------------------------------------------
  const beginEdit = (row: number, col: number) => {
    const key = cellKey(row, col);
    setEditingKey(key);
    setEditValue(cellMap.get(key) ?? '');
  };

  const commitEdit = () => {
    if (!editingKey) return;
    const [rowStr, colStr] = editingKey.split(',');
    const row = Number(rowStr);
    const col = Number(colStr);
    setCellMap((prev) => {
      const next = new Map(prev);
      if (editValue === '') next.delete(editingKey);
      else next.set(editingKey, editValue);
      return next;
    });
    pendingRef.current.set(editingKey, { row, col, value: editValue });
    scheduleFlush();
    setEditingKey(null);
    setEditValue('');
  };

  // ---- CSV import ------------------------------------------------
  const handleCsvFile = async (file: File) => {
    if (!activeSheetId) return;
    try {
      const text = await file.text();
      const result = await importCsv(db, activeSheetId, text);
      // Re-hydrate cells from DB so the grid reflects the new state.
      const cells = await getCells(db, activeSheetId);
      const next = new Map<string, string>();
      for (const c of cells) next.set(cellKey(c.row, c.col), c.value);
      setCellMap(next);
      host.notifications.notify({
        title: 'CSV imported',
        body: `${result.rowsImported} rows × ${result.colsImported} cols`,
        level: 'success',
      });
    } catch (e) {
      setError(`Could not import CSV: ${(e as Error).message}`);
    }
  };

  const onCsvInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleCsvFile(file);
    // Reset so the same filename can be picked again.
    e.target.value = '';
  };

  // ---- Add sheet -------------------------------------------------
  const handleAddSheet = async () => {
    try {
      const sheet = await createSheet(db, {
        name: `Sheet${sheets.length + 1}`,
        rows: DEFAULT_ROWS,
        cols: DEFAULT_COLS,
      });
      setSheets((prev) => [...prev, sheet]);
      setActiveSheetId(sheet.id);
    } catch (e) {
      setError(`Could not create sheet: ${(e as Error).message}`);
    }
  };

  // ---- Render ----------------------------------------------------
  const headerCols = useMemo(
    () => Array.from({ length: VIEWPORT_COLS }, (_, i) => colLabel(i)),
    [],
  );
  const headerRows = useMemo(
    () => Array.from({ length: VIEWPORT_ROWS }, (_, i) => i + 1),
    [],
  );

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-window)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'var(--bg-titlebar)',
        }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs"
          title="Import CSV"
        >
          <Upload size={12} /> Import CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onCsvInputChange}
          style={{ display: 'none' }}
        />
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-subtle)' }} />
        <button
          onClick={() =>
            host.notifications.notify({
              title: 'Add column',
              body: 'AI integration ships in PR-M4.4',
              level: 'info',
            })
          }
          className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs"
          title="Add a column for X (⌘K)"
        >
          <Sparkles size={12} /> Add column
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-disabled)',
              marginLeft: 4,
            }}
          >
            ⌘K
          </span>
        </button>
        {error && (
          <span
            style={{ fontSize: 11, color: 'var(--accent-error, #ef4444)', marginLeft: 'auto' }}
          >
            {error}
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <div className="inline-block min-w-full">
          {/* Column headers */}
          <div
            className="flex sticky top-0 z-10"
            style={{ background: 'var(--bg-titlebar)' }}
          >
            <div
              className="w-10 h-7 shrink-0 border-r border-b"
              style={{ borderColor: 'var(--border-subtle)' }}
            />
            {headerCols.map((label) => (
              <div
                key={label}
                className="w-20 h-7 shrink-0 border-r border-b flex items-center justify-center text-[10px] text-[var(--text-secondary)] font-medium"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Rows */}
          {headerRows.map((rowNum) => (
            <div key={rowNum} className="flex">
              <div
                className="w-10 h-6 shrink-0 border-r border-b flex items-center justify-center text-[10px] text-[var(--text-secondary)] sticky left-0"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background: 'var(--bg-titlebar)',
                }}
              >
                {rowNum}
              </div>
              {headerCols.map((_label, colIdx) => {
                const col = colIdx + 1;
                const key = cellKey(rowNum, col);
                const value = cellMap.get(key) ?? '';
                const isEditing = editingKey === key;
                return (
                  <div
                    key={key}
                    onDoubleClick={() => beginEdit(rowNum, col)}
                    className="w-20 h-6 shrink-0 border-r border-b relative"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                          if (e.key === 'Escape') {
                            setEditingKey(null);
                            setEditValue('');
                          }
                        }}
                        className="absolute inset-0 w-full h-full px-1 text-xs outline-none text-[var(--text-primary)]"
                        style={{
                          background: 'var(--bg-window)',
                          border: '2px solid var(--accent-primary)',
                        }}
                      />
                    ) : (
                      <div
                        className="w-full h-full px-1 text-xs truncate flex items-center"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {value}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Sheet tabs */}
      <div
        className="flex items-center gap-1 px-2 py-1 border-t shrink-0"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'var(--bg-titlebar)',
        }}
      >
        {sheets.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSheetId(s.id)}
            className="flex items-center gap-1 px-3 py-1 rounded-t text-xs transition-colors"
            style={{
              background: activeSheetId === s.id ? 'var(--bg-window)' : 'transparent',
              color:
                activeSheetId === s.id
                  ? 'var(--accent-primary)'
                  : 'var(--text-secondary)',
              borderBottom:
                activeSheetId === s.id
                  ? '2px solid var(--accent-primary)'
                  : '2px solid transparent',
            }}
          >
            <FileSpreadsheet size={12} />
            {s.name}
          </button>
        ))}
        <button
          onClick={handleAddSheet}
          className="p-1 rounded-sm hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          title="Add sheet"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

// `CellRow` is exported for potential consumers (e.g. PR-M4.4 engine
// wiring). Re-exported here so the lone import surface stays small.
export type { CellRow };

export default Sheet;
