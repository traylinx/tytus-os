import { describe, expect, it } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import { ensureForgeSchema } from './index';

class SchemaDb implements AppDb {
  migrated = false;
  hasWorkspaceTable = false;
  runSql: string[] = [];

  async run(sql: string): Promise<RunResult> {
    this.runSql.push(sql);
    if (/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app_forge_workspaces/i.test(sql)) {
      this.hasWorkspaceTable = true;
    }
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string): Promise<T[]> {
    if (/sqlite_master/i.test(sql)) {
      return (this.hasWorkspaceTable ? [{ name: 'app_forge_workspaces' }] : []) as T[];
    }
    return [];
  }

  async migrate(): Promise<void> {
    this.migrated = true;
  }

  async listOwnedTables(): Promise<string[]> {
    return this.hasWorkspaceTable ? ['app_forge_workspaces'] : [];
  }
}

describe('ensureForgeSchema', () => {
  it('runs normal migrations and self-heals missing Forge tables', async () => {
    const db = new SchemaDb();
    await ensureForgeSchema(db);

    expect(db.migrated).toBe(true);
    expect(db.hasWorkspaceTable).toBe(true);
    expect(db.runSql.some((sql) => /app_forge_cards/i.test(sql))).toBe(true);
    expect(db.runSql.some((sql) => /idx_app_forge_outputs_workspace_created/i.test(sql))).toBe(true);
  });

  it('does not replay fallback schema when workspace table exists', async () => {
    const db = new SchemaDb();
    db.hasWorkspaceTable = true;
    await ensureForgeSchema(db);

    expect(db.migrated).toBe(true);
    expect(db.runSql).toEqual([]);
  });
});
