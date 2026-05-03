/**
 * @tytus/app-sheet — Sheet smoke test.
 *
 * Mounts the lifted grid against an in-memory AppDb fake and pins the
 * two end-to-end behaviours the M4.2 lift must keep:
 *
 *   1. First-run hydrates: zero sheets in storage → one auto-seeded
 *      sheet appears in the tab strip.
 *   2. The ⌘K shell-menu stub registers exactly one menu item with
 *      the canonical `Add a column for X…` label + `⌘K` shortcut.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type {
  AppBootEnv,
  AppDb,
  HostClient,
  RunResult,
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
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    if (/FROM\s+app_sheet_sheets/i.test(sql)) {
      return [...this.sheets].sort((a, b) => a.created_at - b.created_at) as unknown as T[];
    }
    if (/FROM\s+app_sheet_cells/i.test(sql)) {
      const sheetId = args[0] as string;
      return this.cells.filter((c) => c.sheet_id === sheetId) as unknown as T[];
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
}): AppBootEnv {
  return {
    host: makeFakeHost(opts),
    createSession: undefined as unknown as AppBootEnv['createSession'],
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
