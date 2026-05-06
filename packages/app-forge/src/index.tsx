import { useEffect, useState } from 'react';
import type { AppBootEnv } from '@tytus/host-api';
import { Forge } from './Forge';

type MigrationState = { ready: boolean; error: string | null };

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const FORGE_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS app_forge_workspaces (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_forge_cards (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    source_card_ids_json TEXT NOT NULL DEFAULT '[]',
    position REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES app_forge_workspaces(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS app_forge_outputs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    card_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    source_card_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES app_forge_workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES app_forge_cards(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_forge_workspaces_updated
    ON app_forge_workspaces(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_app_forge_cards_workspace_position
    ON app_forge_cards(workspace_id, position ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_app_forge_outputs_workspace_created
    ON app_forge_outputs(workspace_id, created_at DESC)`,
];

export async function ensureForgeSchema(db: ReturnType<AppBootEnv['host']['storage']['current']>): Promise<void> {
  await db.migrate('migrations/');
  const rows = await db.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = 'app_forge_workspaces'`,
  );
  if (rows.length > 0) return;
  for (const sql of FORGE_SCHEMA) {
    await db.run(sql);
  }
}

export default function bootForge(env: AppBootEnv) {
  const db = env.host.storage.current();
  return function ForgeApp() {
    const [state, setState] = useState<MigrationState>({ ready: false, error: null });

    useEffect(() => {
      let alive = true;
      void ensureForgeSchema(db)
        .then(() => {
          if (alive) setState({ ready: true, error: null });
        })
        .catch((err: unknown) => {
          if (alive) setState({ ready: false, error: errorMessage(err) });
        });
      return () => {
        alive = false;
      };
    }, [db]);

    if (state.error) {
      return <div role="alert" style={{ padding: 24, color: '#ff8a80' }}>Forge failed to initialize: {state.error}</div>;
    }
    if (!state.ready) return <div style={{ padding: 24, color: '#c9b8ff' }}>Preparing Forge…</div>;
    return <Forge db={db} host={env.host} />;
  };
}
