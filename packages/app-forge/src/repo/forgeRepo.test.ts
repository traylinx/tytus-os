import { describe, expect, it } from 'vitest';
import type { AppDb, RunResult } from '@tytus/host-api';
import {
  clearOutputs,
  createCard,
  createOutput,
  createWorkspace,
  deleteCard,
  listCards,
  listOutputs,
  listWorkspaces,
  updateCard,
} from './forgeRepo';

interface WorkspaceStored {
  id: string;
  title: string;
  goal: string;
  mode: string;
  status: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

interface CardStored {
  id: string;
  workspace_id: string;
  kind: string;
  title: string;
  content: string;
  metadata_json: string;
  source_card_ids_json: string;
  position: number;
  created_at: number;
  updated_at: number;
}

interface OutputStored {
  id: string;
  workspace_id: string;
  card_id: string | null;
  kind: string;
  title: string;
  content: string;
  metadata_json: string;
  source_card_ids_json: string;
  created_at: number;
}

class MemoryForgeDb implements AppDb {
  workspaces: WorkspaceStored[] = [];
  cards: CardStored[] = [];
  outputs: OutputStored[] = [];

  async run(sql: string, args: readonly unknown[] = []): Promise<RunResult> {
    const normalized = sql.trim();
    if (/^INSERT\s+INTO\s+app_forge_workspaces/i.test(normalized)) {
      const [id, title, goal, mode, status, metadata_json, created_at, updated_at] =
        args as [string, string, string, string, string, string, number, number];
      this.workspaces.push({ id, title, goal, mode, status, metadata_json, created_at, updated_at });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/^INSERT\s+INTO\s+app_forge_cards/i.test(normalized)) {
      const [id, workspace_id, kind, title, content, metadata_json, source_card_ids_json, position, created_at, updated_at] =
        args as [string, string, string, string, string, string, string, number, number, number];
      this.cards.push({ id, workspace_id, kind, title, content, metadata_json, source_card_ids_json, position, created_at, updated_at });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/^INSERT\s+INTO\s+app_forge_outputs/i.test(normalized)) {
      const [id, workspace_id, card_id, kind, title, content, metadata_json, source_card_ids_json, created_at] =
        args as [string, string, string | null, string, string, string, string, string, number];
      this.outputs.push({ id, workspace_id, card_id, kind, title, content, metadata_json, source_card_ids_json, created_at });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/^UPDATE\s+app_forge_cards\s+SET/i.test(normalized)) {
      const id = args[args.length - 1] as string;
      const card = this.cards.find((c) => c.id === id);
      if (!card) return { lastInsertRowid: 0, changes: 0 };
      const setClause = normalized.match(/SET\s+(.+)\s+WHERE/i)?.[1] ?? '';
      const cols = setClause.split(',').map((s) => s.trim().split('=')[0].trim());
      cols.forEach((col, idx) => {
        const value = args[idx];
        if (col === 'updated_at') card.updated_at = value as number;
        if (col === 'title') card.title = value as string;
        if (col === 'content') card.content = value as string;
        if (col === 'kind') card.kind = value as string;
        if (col === 'metadata_json') card.metadata_json = value as string;
        if (col === 'position') card.position = value as number;
      });
      return { lastInsertRowid: 0, changes: 1 };
    }
    if (/^UPDATE\s+app_forge_workspaces\s+SET\s+updated_at/i.test(normalized)) {
      const [updatedAt, id] = args as [number, string];
      const workspace = this.workspaces.find((w) => w.id === id);
      if (workspace) workspace.updated_at = updatedAt;
      return { lastInsertRowid: 0, changes: workspace ? 1 : 0 };
    }
    if (/^DELETE\s+FROM\s+app_forge_cards\s+WHERE\s+id/i.test(normalized)) {
      const [id] = args as [string];
      const before = this.cards.length;
      this.cards = this.cards.filter((c) => c.id !== id);
      return { lastInsertRowid: 0, changes: before - this.cards.length };
    }
    if (/^DELETE\s+FROM\s+app_forge_outputs\s+WHERE\s+workspace_id/i.test(normalized)) {
      const [workspaceId] = args as [string];
      const before = this.outputs.length;
      this.outputs = this.outputs.filter((o) => o.workspace_id !== workspaceId);
      return { lastInsertRowid: 0, changes: before - this.outputs.length };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    const normalized = sql.trim();
    if (/FROM\s+app_forge_workspaces/i.test(normalized)) {
      return [...this.workspaces].sort((a, b) => b.updated_at - a.updated_at) as T[];
    }
    if (/FROM\s+app_forge_cards\s+WHERE\s+workspace_id/i.test(normalized)) {
      const [workspaceId] = args as [string];
      return this.cards
        .filter((c) => c.workspace_id === workspaceId)
        .sort((a, b) => a.position - b.position || a.created_at - b.created_at) as T[];
    }
    if (/SELECT\s+workspace_id\s+FROM\s+app_forge_cards\s+WHERE\s+id/i.test(normalized)) {
      const [id] = args as [string];
      const card = this.cards.find((c) => c.id === id);
      return (card ? [{ workspace_id: card.workspace_id }] : []) as T[];
    }
    if (/FROM\s+app_forge_outputs\s+WHERE\s+workspace_id/i.test(normalized)) {
      const [workspaceId] = args as [string];
      return this.outputs
        .filter((o) => o.workspace_id === workspaceId)
        .sort((a, b) => b.created_at - a.created_at) as T[];
    }
    throw new Error(`Unhandled query SQL: ${sql}`);
  }

  async migrate(): Promise<void> {}
  async listOwnedTables(): Promise<string[]> { return []; }
}

describe('forgeRepo', () => {
  it('creates and lists workspaces newest first', async () => {
    const db = new MemoryForgeDb();
    await createWorkspace(db, { id: 'w1', title: 'First', goal: 'A', mode: 'study', now: 100 });
    await createWorkspace(db, { id: 'w2', title: 'Second', goal: 'B', mode: 'work', now: 200 });

    const rows = await listWorkspaces(db);
    expect(rows.map((w) => w.id)).toEqual(['w2', 'w1']);
    expect(rows[0].metadata).toEqual({});
  });

  it('creates, updates, orders, and deletes cards', async () => {
    const db = new MemoryForgeDb();
    await createWorkspace(db, { id: 'w1', title: 'Sprint', goal: 'Ship', mode: 'dev', now: 100 });
    await createCard(db, { id: 'c2', workspaceId: 'w1', kind: 'text', title: 'Later', content: 'B', position: 20, now: 120 });
    await createCard(db, { id: 'c1', workspaceId: 'w1', kind: 'markdown', title: 'Earlier', content: 'A', position: 10, now: 110 });

    expect((await listCards(db, 'w1')).map((c) => c.id)).toEqual(['c1', 'c2']);
    await updateCard(db, 'c1', { title: 'Updated', content: 'AA', now: 150 });
    expect((await listCards(db, 'w1'))[0]).toMatchObject({ id: 'c1', title: 'Updated', content: 'AA' });

    await deleteCard(db, 'c2');
    expect((await listCards(db, 'w1')).map((c) => c.id)).toEqual(['c1']);
  });

  it('creates and clears outputs linked to source cards', async () => {
    const db = new MemoryForgeDb();
    await createWorkspace(db, { id: 'w1', title: 'Study', goal: 'Learn', mode: 'study', now: 100 });
    await createOutput(db, {
      id: 'o1',
      workspaceId: 'w1',
      cardId: null,
      kind: 'summary',
      title: 'Summary',
      content: 'Done',
      sourceCardIds: ['c1'],
      now: 200,
    });

    const outputs = await listOutputs(db, 'w1');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].sourceCardIds).toEqual(['c1']);
    await clearOutputs(db, 'w1');
    expect(await listOutputs(db, 'w1')).toEqual([]);
  });
});
