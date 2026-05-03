/**
 * @tytus/app-sheet — Sheet smoke + engine pipe tests.
 *
 * Mounts the lifted grid against an in-memory AppDb fake and pins both
 * the M4.2 hydration / shell-menu invariants and the M4.4 engine pipe:
 *
 *   1. First-run hydrate: zero sheets in storage → one auto-seeded sheet.
 *   2. The ⌘K shell-menu registers exactly one menu item with the
 *      canonical "Add a column for X…" label + ⌘K shortcut.
 *   3. Clicking the toolbar's Add column button opens the AI modal.
 *   4. Submitting the AI modal with a prompt invokes the bound
 *      `createSession` factory so the loader-supplied engine session
 *      actually drives the request.
 *   5. Even when `createSession` is the M1 stub (throws on call), the
 *      degenerate path runs `cellReadRange` against the bound DB and
 *      stages a sheet.writeRange patch the user can Apply.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type {
  AppBootEnv,
  AppDb,
  HostClient,
  RunResult,
  Session,
  ShellMenuSpec,
} from '@tytus/host-api';
import bootSheet from './index';

// ── Fakes ────────────────────────────────────────────────────────────

class MemoryAppDb implements AppDb {
  sheets: Array<{
    id: string; name: string; rows: number; cols: number;
    created_at: number; updated_at: number;
  }> = [];
  cells: Array<{
    sheet_id: string; row: number; col: number;
    value: string; formula: string | null; updated_at: number;
  }> = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
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
      const stored = { sheet_id, row, col, value, formula: null, updated_at };
      if (idx >= 0) this.cells[idx] = stored;
      else this.cells.push(stored);
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/DELETE\s+FROM\s+app_sheet_cells/i.test(sql)) {
      const [sheet_id, row, col] = args as [string, number, number];
      const idx = this.cells.findIndex(
        (c) => c.sheet_id === sheet_id && c.row === row && c.col === col,
      );
      if (idx >= 0) this.cells.splice(idx, 1);
      return { lastInsertRowid: 0, changes: 1 };
    }
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    if (/FROM\s+app_sheet_sheets/i.test(sql)) {
      // dimension lookup form: `WHERE id = ?`
      if (/WHERE\s+id\s*=\s*\?/i.test(sql)) {
        const id = args[0] as string;
        return this.sheets.filter((s) => s.id === id) as unknown as T[];
      }
      return [...this.sheets].sort((a, b) => a.created_at - b.created_at) as unknown as T[];
    }
    if (/FROM\s+app_sheet_cells/i.test(sql)) {
      // Range form: sheetId, rowFrom, rowTo, colFrom, colTo
      if (/row\s+BETWEEN/i.test(sql)) {
        const [sheetId, rowFrom, rowTo, colFrom, colTo] = args as [
          string, number, number, number, number,
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
      const sheetId = args[0] as string;
      return this.cells
        .filter((c) => c.sheet_id === sheetId)
        .sort((a, b) => a.row - b.row || a.col - b.col) as unknown as T[];
    }
    return [];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_sheet_sheets', 'app_sheet_cells'];
  }
}

function makeFakeHost(opts: {
  db: AppDb;
  registerSpy?: (spec: ShellMenuSpec) => void;
  notifySpy?: () => void;
}): HostClient {
  const explode = (label: string) => () => {
    throw new Error(`fake host: ${label} not implemented`);
  };
  const proxy = new Proxy(
    {} as Record<string, unknown>,
    { get: (_t, prop: string) => explode(prop) },
  );
  return {
    appId: 'sheet',
    fs: proxy as unknown as HostClient['fs'],
    daemon: proxy as unknown as HostClient['daemon'],
    windows: {
      current: { id: 'win-test', appId: 'sheet' },
      open: () => 'open',
      openOrFocus: () => 'open',
      close: () => {},
      addDesktopIcon: () => {},
    },
    notifications: { notify: () => opts.notifySpy?.() },
    shellMenu: {
      register: (spec) => {
        opts.registerSpy?.(spec);
        return () => {};
      },
    },
    i18n: {
      locale: 'en',
      t: (k: string) => k,
      onLocaleChange: () => () => {},
    },
    storage: {
      current: () => opts.db,
      forApp: () => { throw new Error('not used'); },
      forSharedKey: () => null,
    },
    events: proxy as unknown as HostClient['events'],
    media: proxy as unknown as HostClient['media'],
    assets: proxy as unknown as HostClient['assets'],
  };
}

function makeBootEnv(opts: {
  db: AppDb;
  registerSpy?: (spec: ShellMenuSpec) => void;
  notifySpy?: () => void;
  createSession?: AppBootEnv['createSession'];
}): AppBootEnv {
  return {
    host: makeFakeHost(opts),
    createSession:
      opts.createSession ??
      ((() => {
        throw new Error('createSession is not available — wired in M2');
      }) as unknown as AppBootEnv['createSession']),
  };
}

async function flushAsync() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('bootSheet (M4.2 lift)', () => {
  it('first-run seeds one sheet and renders its tab', async () => {
    const db = new MemoryAppDb();
    const env = makeBootEnv({ db });
    const App = bootSheet(env);

    render(<App />);
    await flushAsync();

    // The seed code path inserts exactly one sheet at first hydrate.
    expect(db.sheets).toHaveLength(1);
    expect(db.sheets[0].name).toBe('Sheet1');

    // And the tab strip surfaces that sheet.
    expect(screen.getByText('Sheet1')).toBeTruthy();
  });

  it('registers the ⌘K "Add a column for X…" menu item exactly once', async () => {
    const db = new MemoryAppDb();
    const registerSpy = vi.fn();
    const env = makeBootEnv({ db, registerSpy });
    const App = bootSheet(env);

    render(<App />);
    await flushAsync();

    expect(registerSpy).toHaveBeenCalledTimes(1);
    const spec = registerSpy.mock.calls[0][0] as ShellMenuSpec;
    expect(spec.appId).toBe('sheet');

    // Walk every group → item, find the canonical M4.2 stub.
    const allItems = spec.groups.flatMap((g) => g.items);
    const stub = allItems.find((it) => it.id === 'sheet.add-column-for-x');
    expect(stub).toBeTruthy();
    expect(stub?.label).toBe('Add a column for X…');
    expect(stub?.shortcut).toBe('⌘K');
  });
});

describe('bootSheet (M4.4 engine pipe)', () => {
  it('clicking the Add column button opens the AI modal', async () => {
    const db = new MemoryAppDb();
    const env = makeBootEnv({ db });
    const App = bootSheet(env);

    render(<App />);
    await flushAsync();

    // Modal not present by default.
    expect(screen.queryByTestId('sheet.ai-modal')).toBeNull();

    // Click the toolbar Add column button.
    const button = screen.getByTestId('sheet.add-column-button');
    fireEvent.click(button);
    await flushAsync();

    expect(screen.getByTestId('sheet.ai-modal')).toBeTruthy();
    expect(screen.getByTestId('sheet.ai-input')).toBeTruthy();
  });

  it('the menu-registered onClick also opens the modal', async () => {
    const db = new MemoryAppDb();
    const registerSpy = vi.fn();
    const env = makeBootEnv({ db, registerSpy });
    const App = bootSheet(env);

    render(<App />);
    await flushAsync();

    const spec = registerSpy.mock.calls[0][0] as ShellMenuSpec;
    const item = spec.groups[0].items[0];
    expect(item.id).toBe('sheet.add-column-for-x');

    act(() => {
      item.onClick?.();
    });
    await flushAsync();

    expect(screen.getByTestId('sheet.ai-modal')).toBeTruthy();
  });

  it('modal submit invokes the bound createSession with the user prompt', async () => {
    const db = new MemoryAppDb();
    const sendCalls: Array<{ intent: string; prompt: string }> = [];
    const factoryCalls: Array<{
      app: string;
      mode: string;
      tools: Array<{ name: string }>;
    }> = [];
    const sendImpl = (req: { intent: string; prompt: string }) => {
      sendCalls.push(req);
      return (async function* () {
        yield {
          kind: 'error' as const,
          message: 'no model',
          retryable: false,
          errorKind: 'unknown' as const,
        };
      })();
    };
    const fakeSession: Session = {
      send: sendImpl as unknown as Session['send'],
      ghostRequest: () => (async function* () {})(),
      abort: () => {},
      recordOutcome: async () => {},
      status: 'ready',
      cost: { promptTokens: 0, completionTokens: 0, totalCost: 0 },
    };
    const createSessionSpy = vi.fn((opts: {
      app: string;
      mode: string;
      tools: Array<{ name: string }>;
    }) => {
      factoryCalls.push(opts);
      return fakeSession;
    });
    const env = makeBootEnv({
      db,
      createSession: createSessionSpy as unknown as AppBootEnv['createSession'],
    });
    const App = bootSheet(env);

    render(<App />);
    await flushAsync();

    fireEvent.click(screen.getByTestId('sheet.add-column-button'));
    await flushAsync();

    fireEvent.change(screen.getByTestId('sheet.ai-input'), {
      target: { value: 'expected lifespan in years' },
    });
    fireEvent.click(screen.getByTestId('sheet.ai-submit'));
    await flushAsync();

    expect(createSessionSpy).toHaveBeenCalledTimes(1);
    expect(factoryCalls).toHaveLength(1);
    const call = factoryCalls[0];
    expect(call.app).toBe('sheet');
    expect(call.mode).toBe('default');
    expect(call.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'sheet.cellReadRange',
        'sheet.cellReadSheet',
        'sheet.cellFormula',
      ]),
    );

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].intent).toBe('edit');
    expect(sendCalls[0].prompt).toContain('expected lifespan in years');
  });

  it('degenerate path stages a sheet.writeRange patch when createSession is the M1 stub', async () => {
    const db = new MemoryAppDb();
    // Seed Sheet1 with header values in column 1 so cellReadRange has
    // something to surface to the synthesised column.
    const env = makeBootEnv({ db });
    const App = bootSheet(env);

    render(<App />);
    await flushAsync();

    // Drop a couple of header rows directly into the fake DB so the
    // degenerate column-synthesiser has data to work with.
    const sheetId = db.sheets[0].id;
    db.cells.push(
      { sheet_id: sheetId, row: 1, col: 1, value: 'animal', formula: null, updated_at: 0 },
      { sheet_id: sheetId, row: 2, col: 1, value: 'cat', formula: null, updated_at: 0 },
      { sheet_id: sheetId, row: 3, col: 1, value: 'dog', formula: null, updated_at: 0 },
    );

    fireEvent.click(screen.getByTestId('sheet.add-column-button'));
    await flushAsync();
    fireEvent.change(screen.getByTestId('sheet.ai-input'), {
      target: { value: 'lifespan' },
    });
    fireEvent.click(screen.getByTestId('sheet.ai-submit'));
    await flushAsync();

    // Banner says "1 patch ready", Apply button visible.
    const banner = screen.getByTestId('sheet.engine-banner');
    expect(banner.textContent).toMatch(/1 patch ready/);
    const applyBtn = screen.getByTestId('sheet.engine-apply');

    fireEvent.click(applyBtn);
    await flushAsync();

    // After Apply, the new column was written. Header row carries the
    // user prompt; data rows carry the placeholder template.
    const writtenHeader = db.cells.find(
      (c) => c.sheet_id === sheetId && c.row === 1 && c.col === 2,
    );
    expect(writtenHeader?.value).toBe('lifespan');
    const writtenCat = db.cells.find(
      (c) => c.sheet_id === sheetId && c.row === 2 && c.col === 2,
    );
    expect(writtenCat?.value).toMatch(/cat/);
  });
});
