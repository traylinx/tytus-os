/**
 * Resolve workspace-app SQL migrations declared in `tytus-app.json`.
 *
 * `host.storage.current().migrate('migrations/')` receives only the
 * app-bound DB handle at runtime. The manifest carries schema paths, but
 * Vite must bundle the raw SQL ahead of time. This module is the bridge:
 * local workspace package migrations are globbed into the shell bundle,
 * then matched by manifest id + schema filename.
 */

import type { Manifest } from '@tytus/host-api';

const WORKSPACE_MIGRATION_SQL = import.meta.glob(
  '../../../packages/app-*/migrations/*.sql',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

export interface ResolvedAppMigration {
  name: string;
  sql: string;
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function migrationKeyFor(appId: string, schemaPath: string): string | null {
  const file = basename(schemaPath);
  const suffix = `/packages/app-${appId}/migrations/${file}`;
  return Object.keys(WORKSPACE_MIGRATION_SQL).find((key) => key.endsWith(suffix)) ?? null;
}

export function resolveManifestMigrations(
  manifest: Manifest,
): ResolvedAppMigration[] {
  const tables = manifest.storage?.tables ?? [];
  const out = new Map<string, ResolvedAppMigration>();

  for (const table of tables) {
    const key = migrationKeyFor(manifest.id, table.schema);
    if (!key) continue;
    const name = basename(table.schema);
    if (!out.has(name)) {
      out.set(name, { name, sql: WORKSPACE_MIGRATION_SQL[key] });
    }
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
