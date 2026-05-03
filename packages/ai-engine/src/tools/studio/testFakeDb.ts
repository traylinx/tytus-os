/**
 * Tiny in-memory AppDb fake for the Studio tool tests. Mirrors the
 * subset of `app_studio_documents` / `app_studio_blocks` queries the
 * tools issue. Not a full SQL engine — just a switch on the SQL
 * shapes the tools emit.
 *
 * Intentionally tiny: keep the test surface narrow so a tool's SQL
 * change has to be reflected here too.
 */
import type { AppDb, RunResult } from '@tytus/host-api';

export interface FakeDocRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface FakeBlockRow {
  id: string;
  document_id: string;
  kind: string;
  text: string;
  meta_json: string;
  position: number;
}

export class FakeStudioDb implements AppDb {
  documents: FakeDocRow[] = [];
  blocks: FakeBlockRow[] = [];

  async run(_sql: string, _args: readonly unknown[] = []): Promise<RunResult> {
    return { lastInsertRowid: 0, changes: 0 };
  }

  async query<T>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    if (
      /SELECT\s+id,\s*title\s+FROM\s+app_studio_documents\s+WHERE\s+id/i.test(
        sql,
      )
    ) {
      const [id] = args as [string];
      const doc = this.documents.find((d) => d.id === id);
      return (doc ? [{ id: doc.id, title: doc.title }] : []) as unknown as T[];
    }
    if (
      /SELECT\s+id,\s*kind,\s*text,\s*position\s+FROM\s+app_studio_blocks\s+WHERE\s+document_id/i.test(
        sql,
      )
    ) {
      const [docId] = args as [string];
      const rows = this.blocks
        .filter((b) => b.document_id === docId)
        .sort((a, b) => a.position - b.position)
        .map((b) => ({
          id: b.id,
          kind: b.kind,
          text: b.text,
          position: b.position,
        }));
      return rows as unknown as T[];
    }
    if (
      /SELECT\s+id,\s*document_id,\s*kind,\s*text,\s*meta_json\s+FROM\s+app_studio_blocks\s+WHERE\s+id/i.test(
        sql,
      )
    ) {
      const [id] = args as [string];
      const block = this.blocks.find((b) => b.id === id);
      return (block ? [block] : []) as unknown as T[];
    }
    if (
      /SELECT\s+document_id\s+FROM\s+app_studio_blocks\s+WHERE\s+id/i.test(sql)
    ) {
      const [id] = args as [string];
      const block = this.blocks.find((b) => b.id === id);
      return (block ? [{ document_id: block.document_id }] : []) as unknown as T[];
    }
    return [];
  }

  async migrate(): Promise<void> {}

  async listOwnedTables(): Promise<string[]> {
    return ['app_studio_documents', 'app_studio_blocks'];
  }
}
