import type { AppDb } from '@tytus/host-api';

export type ForgeMode = 'study' | 'work' | 'life' | 'creative' | 'dev' | 'custom';
export type ForgeCardKind =
  | 'markdown'
  | 'text'
  | 'code'
  | 'json'
  | 'table'
  | 'voice'
  | 'agent_result'
  | 'output';
export type ForgeOutputKind =
  | 'summary'
  | 'tasks'
  | 'quiz'
  | 'proposal'
  | 'study_plan'
  | 'memory_hook'
  | 'storyboard'
  | 'api_collection'
  | 'custom';

export interface ForgeWorkspace {
  id: string;
  title: string;
  goal: string;
  mode: ForgeMode;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ForgeCard {
  id: string;
  workspaceId: string;
  kind: ForgeCardKind;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  sourceCardIds: string[];
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface ForgeOutput {
  id: string;
  workspaceId: string;
  cardId: string | null;
  kind: ForgeOutputKind;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  sourceCardIds: string[];
  createdAt: number;
}

interface WorkspaceRow {
  id: string;
  title: string;
  goal: string;
  mode: ForgeMode;
  status: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

interface CardRow {
  id: string;
  workspace_id: string;
  kind: ForgeCardKind;
  title: string;
  content: string;
  metadata_json: string;
  source_card_ids_json: string;
  position: number;
  created_at: number;
  updated_at: number;
}

interface OutputRow {
  id: string;
  workspace_id: string;
  card_id: string | null;
  kind: ForgeOutputKind;
  title: string;
  content: string;
  metadata_json: string;
  source_card_ids_json: string;
  created_at: number;
}

const id = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const safeObject = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const safeStringArray = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const workspaceFromRow = (row: WorkspaceRow): ForgeWorkspace => ({
  id: row.id,
  title: row.title,
  goal: row.goal,
  mode: row.mode,
  status: row.status,
  metadata: safeObject(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const cardFromRow = (row: CardRow): ForgeCard => ({
  id: row.id,
  workspaceId: row.workspace_id,
  kind: row.kind,
  title: row.title,
  content: row.content,
  metadata: safeObject(row.metadata_json),
  sourceCardIds: safeStringArray(row.source_card_ids_json),
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const outputFromRow = (row: OutputRow): ForgeOutput => ({
  id: row.id,
  workspaceId: row.workspace_id,
  cardId: row.card_id,
  kind: row.kind,
  title: row.title,
  content: row.content,
  metadata: safeObject(row.metadata_json),
  sourceCardIds: safeStringArray(row.source_card_ids_json),
  createdAt: row.created_at,
});

export async function listWorkspaces(db: AppDb): Promise<ForgeWorkspace[]> {
  const rows = await db.query<WorkspaceRow>(
    `SELECT id, title, goal, mode, status, metadata_json, created_at, updated_at
       FROM app_forge_workspaces
      ORDER BY updated_at DESC`,
  );
  return rows.map(workspaceFromRow);
}

export async function createWorkspace(
  db: AppDb,
  opts: { title: string; goal: string; mode: ForgeMode; metadata?: Record<string, unknown>; now?: number; id?: string },
): Promise<ForgeWorkspace> {
  const now = opts.now ?? Date.now();
  const workspace: ForgeWorkspace = {
    id: opts.id ?? id('fw'),
    title: opts.title,
    goal: opts.goal,
    mode: opts.mode,
    status: 'active',
    metadata: opts.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
  await db.run(
    `INSERT INTO app_forge_workspaces
      (id, title, goal, mode, status, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [workspace.id, workspace.title, workspace.goal, workspace.mode, workspace.status, JSON.stringify(workspace.metadata), now, now],
  );
  return workspace;
}

export async function listCards(db: AppDb, workspaceId: string): Promise<ForgeCard[]> {
  const rows = await db.query<CardRow>(
    `SELECT id, workspace_id, kind, title, content, metadata_json, source_card_ids_json, position, created_at, updated_at
       FROM app_forge_cards
      WHERE workspace_id = ?
      ORDER BY position ASC, created_at ASC`,
    [workspaceId],
  );
  return rows.map(cardFromRow);
}

export async function createCard(
  db: AppDb,
  opts: {
    workspaceId: string;
    kind: ForgeCardKind;
    title?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    sourceCardIds?: string[];
    position?: number;
    now?: number;
    id?: string;
  },
): Promise<ForgeCard> {
  const now = opts.now ?? Date.now();
  const card: ForgeCard = {
    id: opts.id ?? id('fc'),
    workspaceId: opts.workspaceId,
    kind: opts.kind,
    title: opts.title ?? '',
    content: opts.content ?? '',
    metadata: opts.metadata ?? {},
    sourceCardIds: opts.sourceCardIds ?? [],
    position: opts.position ?? now,
    createdAt: now,
    updatedAt: now,
  };
  await db.run(
    `INSERT INTO app_forge_cards
      (id, workspace_id, kind, title, content, metadata_json, source_card_ids_json, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      card.id,
      card.workspaceId,
      card.kind,
      card.title,
      card.content,
      JSON.stringify(card.metadata),
      JSON.stringify(card.sourceCardIds),
      card.position,
      now,
      now,
    ],
  );
  await touchWorkspace(db, card.workspaceId, now);
  return card;
}

export async function updateCard(
  db: AppDb,
  cardId: string,
  patch: Partial<Pick<ForgeCard, 'title' | 'content' | 'kind' | 'metadata' | 'position'>> & { now?: number },
): Promise<void> {
  const now = patch.now ?? Date.now();
  const sets: string[] = ['updated_at = ?'];
  const args: unknown[] = [now];
  if (patch.title !== undefined) { sets.push('title = ?'); args.push(patch.title); }
  if (patch.content !== undefined) { sets.push('content = ?'); args.push(patch.content); }
  if (patch.kind !== undefined) { sets.push('kind = ?'); args.push(patch.kind); }
  if (patch.metadata !== undefined) { sets.push('metadata_json = ?'); args.push(JSON.stringify(patch.metadata)); }
  if (patch.position !== undefined) { sets.push('position = ?'); args.push(patch.position); }
  args.push(cardId);
  await db.run(`UPDATE app_forge_cards SET ${sets.join(', ')} WHERE id = ?`, args);
  const rows = await db.query<{ workspace_id: string }>('SELECT workspace_id FROM app_forge_cards WHERE id = ?', [cardId]);
  if (rows[0]) await touchWorkspace(db, rows[0].workspace_id, now);
}

export async function deleteCard(db: AppDb, cardId: string): Promise<void> {
  const rows = await db.query<{ workspace_id: string }>('SELECT workspace_id FROM app_forge_cards WHERE id = ?', [cardId]);
  await db.run('DELETE FROM app_forge_cards WHERE id = ?', [cardId]);
  if (rows[0]) await touchWorkspace(db, rows[0].workspace_id, Date.now());
}

export async function listOutputs(db: AppDb, workspaceId: string): Promise<ForgeOutput[]> {
  const rows = await db.query<OutputRow>(
    `SELECT id, workspace_id, card_id, kind, title, content, metadata_json, source_card_ids_json, created_at
       FROM app_forge_outputs
      WHERE workspace_id = ?
      ORDER BY created_at DESC`,
    [workspaceId],
  );
  return rows.map(outputFromRow);
}

export async function createOutput(
  db: AppDb,
  opts: {
    workspaceId: string;
    cardId?: string | null;
    kind: ForgeOutputKind;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
    sourceCardIds?: string[];
    now?: number;
    id?: string;
  },
): Promise<ForgeOutput> {
  const now = opts.now ?? Date.now();
  const output: ForgeOutput = {
    id: opts.id ?? id('fo'),
    workspaceId: opts.workspaceId,
    cardId: opts.cardId ?? null,
    kind: opts.kind,
    title: opts.title,
    content: opts.content,
    metadata: opts.metadata ?? {},
    sourceCardIds: opts.sourceCardIds ?? [],
    createdAt: now,
  };
  await db.run(
    `INSERT INTO app_forge_outputs
      (id, workspace_id, card_id, kind, title, content, metadata_json, source_card_ids_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [output.id, output.workspaceId, output.cardId, output.kind, output.title, output.content, JSON.stringify(output.metadata), JSON.stringify(output.sourceCardIds), now],
  );
  await touchWorkspace(db, output.workspaceId, now);
  return output;
}

export async function clearOutputs(db: AppDb, workspaceId: string): Promise<void> {
  await db.run('DELETE FROM app_forge_outputs WHERE workspace_id = ?', [workspaceId]);
  await touchWorkspace(db, workspaceId, Date.now());
}

async function touchWorkspace(db: AppDb, workspaceId: string, now: number): Promise<void> {
  await db.run('UPDATE app_forge_workspaces SET updated_at = ? WHERE id = ?', [now, workspaceId]);
}
