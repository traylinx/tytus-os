// ============================================================
// Sheet — workspace-package edition (M4.4 engine wiring).
// ============================================================
//
// W6 PR-Sheet-Engine (M4.4) replaces the M4.2 ⌘K stub with a real
// "Add a column for X" pipe:
//
//   1. ⌘K opens an input modal asking the user for the column descriptor.
//   2. On submit, the engine session runs against the bound HostClient
//      and the three new sheet tools (cellReadRange / cellReadSheet /
//      cellFormula). Token events stream into a banner; staged_patch
//      events surface as an inline Apply/Discard chip; on Apply the
//      patch's writeRange is committed through the existing sheetRepo
//      and the cell map re-hydrates.
//   3. If the loader's `createSession` is the M1 stub (throws on call),
//      the spec's "acceptable degenerate" path runs instead: the modal
//      submit calls `cellReadRangeTool.execute` directly to read the
//      header column, synthesises a placeholder column at the next
//      empty col, and stages a local SheetWriteRangePatch. The Apply/
//      Discard UI is the same — only the upstream changes. This keeps
//      the W6 deliverable testable today without depending on the loader
//      createSession wiring (which lands in a separate M2 follow-up).
//
// Style + a11y still match the legacy Spreadsheet.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Upload, Plus, FileSpreadsheet, Sparkles, Check, X } from 'lucide-react';
import type {
  AppCreateSession,
  AppDb,
  HostClient,
  Session,
  ToolDef,
  TransactionOutcome,
} from '@tytus/host-api';
import {
  makeSheetTools,
  CELL_READ_RANGE_TOOL_NAME,
  type SheetWriteRangePatch,
} from '@tytus/ai-engine';
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

// ---- Engine pipe types ---------------------------------------------

/** Local representation of a staged patch awaiting Apply / Discard. */
interface StagedSheetPatch {
  txId: string;
  patch: SheetWriteRangePatch;
  /** Pretty summary for the inline UI. */
  summary: string;
  /** When set, points at the engine session that created the patch
   *  so we can recordOutcome on Apply / Discard. The degenerate path
   *  leaves it null. */
  session: Session | null;
}

/** Banner state — null when nothing to show. */
type BannerState =
  | { kind: 'idle'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'applied'; text: string }
  | { kind: 'error'; text: string };

// ---- Props ---------------------------------------------------------

export interface SheetProps {
  db: AppDb;
  host: HostClient;
  /** Engine session factory — pre-bound by the shell loader. Optional
   *  because the M1 stub throws on call; we treat that as "engine not
   *  wired yet" and fall back to the direct-tool-call path. */
  createSession?: AppCreateSession;
}

export function Sheet({ db, host, createSession }: SheetProps) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [cellMap, setCellMap] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Engine pipe state.
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [staged, setStaged] = useState<StagedSheetPatch | null>(null);

  // Per-session toolkit. We rebuild when the AppDb identity changes so
  // tools always close over the current handle.
  const sheetTools = useMemo<ToolDef[]>(
    () => makeSheetTools({ db }),
    [db],
  );

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

  // ---- ⌘K shell-menu (M4.4 wires onClick to the modal) -----------
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
                setAiInput('');
                setAiModalOpen(true);
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

  // ---- Engine pipe -----------------------------------------------

  // The degenerate path: the M2 loader hasn't wired the real
  // createSession yet, so we run the AI engine's tools directly
  // against the bound DB to prove the registry works end-to-end.
  // Reads column 1 (the canonical "header" column) via the
  // sheet.cellReadRange tool, then synthesises a placeholder column
  // tagged with the user's prompt at the next empty column.
  const runDegenerateAddColumn = useCallback(
    async (sheetId: string, userInput: string) => {
      const tool = sheetTools.find((t) => t.name === CELL_READ_RANGE_TOOL_NAME);
      if (!tool) throw new Error('cellReadRange tool not registered');
      // Read the first 12 rows of column 1 — enough to seed a label.
      const result = (await tool.execute(
        {
          sheetId,
          fromRow: 1,
          fromCol: 1,
          toRow: VIEWPORT_ROWS,
          toCol: 1,
        },
        { sessionId: 'degenerate', appId: 'sheet', approvalAlreadyGranted: false },
      )) as { cells: string[][] };
      const headers = result.cells.map((row) => row[0] ?? '');
      // Fresh read from the DB so we don't race the in-memory cellMap.
      // Walks every cell in the active sheet and picks the next empty col.
      const allCells = await getCells(db, sheetId);
      let maxCol = 0;
      for (const c of allCells) {
        if (c.col > maxCol) maxCol = c.col;
      }
      const targetCol = maxCol + 1;
      // Header row is row 1 — use the user's prompt as the column header.
      // Subsequent rows get a stable placeholder so the user sees the
      // shape; the real engine round-trip replaces this with a model-
      // synthesised value when M2 loader wiring lands.
      const values: (string | number | null)[][] = [];
      values.push([userInput.trim() || 'AI column']);
      for (let i = 1; i < headers.length; i++) {
        const headerCell = headers[i].trim();
        values.push([headerCell ? `(${userInput || 'X'} for ${headerCell})` : '']);
      }
      const fromColLetter = colLabel(targetCol - 1);
      const patch: SheetWriteRangePatch = {
        kind: 'sheet.writeRange',
        sheetId,
        range: `${fromColLetter}1:${fromColLetter}${values.length}`,
        values,
      };
      return patch;
    },
    [db, sheetTools],
  );

  // Apply a SheetWriteRangePatch by writing every cell through the
  // existing sheetRepo. Mirrors the legacy Spreadsheet's behaviour
  // (one INSERT per non-empty cell + DELETE-on-empty).
  const applySheetWriteRangePatch = useCallback(
    async (patch: SheetWriteRangePatch) => {
      // Parse the A1 range — narrow to the leading column for the M4.4
      // single-column wedge. Format is `<colLetters><startRow>:<colLetters><endRow>`.
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(patch.range);
      if (!m) {
        throw new Error(`unsupported range "${patch.range}" (expected A1 column form)`);
      }
      const startColLetters = m[1];
      const startRow = Number(m[2]);
      const endColLetters = m[3];
      // Convert col letters → 1-indexed col number.
      const colFromLetters = (letters: string): number => {
        let n = 0;
        for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n;
      };
      const startCol = colFromLetters(startColLetters);
      const endCol = colFromLetters(endColLetters);
      const cols = endCol - startCol + 1;
      for (let ri = 0; ri < patch.values.length; ri++) {
        const row = patch.values[ri];
        for (let ci = 0; ci < cols; ci++) {
          const v = row[ci];
          const stringValue =
            v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v);
          await setCell(db, patch.sheetId, startRow + ri, startCol + ci, stringValue);
        }
      }
      // Re-hydrate the in-memory cell map so the grid reflects the patch.
      const cells = await getCells(db, patch.sheetId);
      const next = new Map<string, string>();
      for (const c of cells) next.set(cellKey(c.row, c.col), c.value);
      setCellMap(next);
    },
    [db],
  );

  const submitAiModal = useCallback(async () => {
    if (!activeSheetId) return;
    const userInput = aiInput;
    setAiModalOpen(false);
    setBanner({ kind: 'thinking', text: 'Engine: thinking…' });

    // Try the real engine session first. If `createSession` is the M1
    // stub (throws synchronously on call), or the session degrades
    // mid-stream, fall back to the degenerate path.
    let session: Session | null = null;
    if (createSession) {
      try {
        session = createSession({
          app: 'sheet',
          mode: 'default',
          documentId: activeSheetId,
          documentRevision: 0,
          tools: sheetTools,
        });
      } catch {
        session = null;
      }
    }

    let patch: SheetWriteRangePatch | null = null;
    let txId = `tx_${Math.random().toString(36).slice(2, 10)}`;
    if (session) {
      try {
        const stream = session.send({
          intent: 'edit',
          prompt: `Add a column to sheet ${activeSheetId} for: ${userInput}`,
        });
        for await (const evRaw of stream) {
          const ev = evRaw as { kind: string } & Record<string, unknown>;
          if (ev.kind === 'token') {
            const text = (ev as { text?: string }).text ?? '';
            setBanner({ kind: 'thinking', text: `Engine: ${text.slice(0, 60)}` });
            continue;
          }
          if (ev.kind === 'staged_patch') {
            const stagedPatch = (ev as unknown as { patch: { kind: string } }).patch;
            if (stagedPatch && stagedPatch.kind === 'sheet.writeRange') {
              patch = stagedPatch as SheetWriteRangePatch;
              txId = (ev as { txId?: string }).txId ?? txId;
            }
            continue;
          }
          if (ev.kind === 'done') {
            txId = (ev as { txId?: string }).txId ?? txId;
            break;
          }
          if (ev.kind === 'error') {
            // Engine failed mid-stream — fall back to degenerate.
            session = null;
            patch = null;
            break;
          }
        }
      } catch {
        session = null;
        patch = null;
      }
    }

    if (!patch) {
      // Degenerate path — direct tool call.
      try {
        patch = await runDegenerateAddColumn(activeSheetId, userInput);
      } catch (e) {
        setBanner({
          kind: 'error',
          text: `Engine: ${(e as Error).message}`,
        });
        return;
      }
    }

    setStaged({
      txId,
      patch,
      summary: `Add column at ${patch.range} (${patch.values.length} rows)`,
      session,
    });
    setBanner({
      kind: 'idle',
      text: `Engine: 1 patch ready — Apply or Discard`,
    });
  }, [
    activeSheetId,
    aiInput,
    createSession,
    sheetTools,
    runDegenerateAddColumn,
  ]);

  const acceptStaged = useCallback(async () => {
    if (!staged) return;
    try {
      await applySheetWriteRangePatch(staged.patch);
      const outcome: TransactionOutcome = {
        accepted: true,
        finalState: 'committed',
        hunksApplied: 1,
        hunksTotal: 1,
      };
      try {
        await staged.session?.recordOutcome(staged.txId, outcome);
      } catch {
        /* telemetry must never crash the UI */
      }
      setStaged(null);
      setBanner({ kind: 'applied', text: 'Engine: applied 1 patch' });
    } catch (e) {
      setBanner({
        kind: 'error',
        text: `Engine: apply failed — ${(e as Error).message}`,
      });
    }
  }, [staged, applySheetWriteRangePatch]);

  const discardStaged = useCallback(async () => {
    if (!staged) return;
    const outcome: TransactionOutcome = {
      accepted: false,
      finalState: 'discarded',
    };
    try {
      await staged.session?.recordOutcome(staged.txId, outcome);
    } catch {
      /* swallow */
    }
    setStaged(null);
    setBanner({ kind: 'idle', text: 'Engine: discarded' });
  }, [staged]);

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
          onClick={() => {
            setAiInput('');
            setAiModalOpen(true);
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs"
          title="Add a column for X (⌘K)"
          data-testid="sheet.add-column-button"
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

      {/* Engine banner */}
      {banner && (
        <div
          data-testid="sheet.engine-banner"
          className="flex items-center gap-2 px-3 py-1 border-b shrink-0"
          style={{
            borderColor: 'var(--border-subtle)',
            background:
              banner.kind === 'error'
                ? 'var(--accent-error-bg, rgba(239,68,68,0.08))'
                : 'var(--bg-titlebar)',
            fontSize: 11,
            color:
              banner.kind === 'error'
                ? 'var(--accent-error, #ef4444)'
                : 'var(--text-secondary)',
          }}
        >
          <span>{banner.text}</span>
          {staged && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => void acceptStaged()}
                className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs"
                style={{
                  background: 'var(--accent-primary, #3b82f6)',
                  color: 'white',
                }}
                data-testid="sheet.engine-apply"
              >
                <Check size={10} /> Apply
              </button>
              <button
                onClick={() => void discardStaged()}
                className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs"
                style={{
                  background: 'var(--bg-hover)',
                  color: 'var(--text-secondary)',
                }}
                data-testid="sheet.engine-discard"
              >
                <X size={10} /> Discard
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {aiModalOpen && (
        <div
          data-testid="sheet.ai-modal"
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setAiModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-md shadow-xl p-4 w-96"
            style={{
              background: 'var(--bg-window)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              className="text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Add a column for X
            </div>
            <div
              className="text-xs mb-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              Describe the column you want — e.g. "expected lifespan in years".
            </div>
            <input
              autoFocus
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitAiModal();
                if (e.key === 'Escape') setAiModalOpen(false);
              }}
              placeholder="e.g. expected lifespan in years"
              className="w-full px-2 py-1.5 text-sm outline-none rounded-sm"
              style={{
                background: 'var(--bg-titlebar)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
              data-testid="sheet.ai-input"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setAiModalOpen(false)}
                className="px-3 py-1 rounded-sm text-xs"
                style={{
                  background: 'var(--bg-hover)',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void submitAiModal()}
                className="px-3 py-1 rounded-sm text-xs"
                style={{
                  background: 'var(--accent-primary, #3b82f6)',
                  color: 'white',
                }}
                data-testid="sheet.ai-submit"
              >
                Add column
              </button>
            </div>
          </div>
        </div>
      )}

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
