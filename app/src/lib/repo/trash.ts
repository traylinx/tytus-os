// ============================================================
// Trash repo — Sprint A Phase 4.2 backend dispatch façade
// ============================================================
//
// Architecture (from independent review, see SPRINT.md):
//
//   • SQLite holds *metadata*, never bytes (`trash_items` table,
//     SCHEMA_V11). It's the index for restore/empty across both
//     backends.
//   • daemon-backed bytes: server-side move to `~/Tytus/.Trash/`
//     via the daemon endpoints `/api/files/trash`, `/restore`,
//     `/empty-trash`. These DO NOT EXIST as of Sprint A close —
//     the daemon work is deferred to Sprint B / hotfix. For now
//     this repo refuses daemon trashes and returns a `not-found`
//     PerItemResult so callers can fall back to immediate-delete-
//     with-confirm. DONE.md flags the gap.
//   • vfs bytes: routed through useFileSystem's existing
//     localStorage trash. We don't duplicate the byte path here —
//     the caller passes a function that does the vfs move and
//     returns the deleted nodeId, which we index in trash_items.
//
// One module, one façade — no caller decides per-source what to
// do; they call `trashRepo.trash(refs[])` and that's it.

import { getDb } from "@/lib/db";
import type { FileRef } from "@/lib/files/fileRef";
import type { PerItemResult } from "@/lib/files/fileOps";
import { playSound } from "@/lib/sounds";

export interface TrashItemRow {
  id: string;
  source: "daemon" | "vfs";
  daemonSource?: string;
  originalPath?: string;
  restorePath?: string;
  vfsNodeId?: string;
  originalParentId?: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  deletedAt: number;
}

export interface VfsTrashHooks {
  /** Move the vfs node to the trash; return the node's previous parent id
   *  + the filename + size for indexing. Returns null if not found. */
  moveToTrash: (nodeId: string) => {
    originalParentId: string;
    filename: string;
    mime: string;
    sizeBytes: number;
  } | null;
  /** Restore a vfs node to its original parent; respect a renamed
   *  filename if the caller resolved a conflict. Returns true on success. */
  restore: (nodeId: string, originalParentId: string, name: string) => boolean;
  /** Permanently delete the vfs trash row. */
  purge: (nodeId: string) => void;
}

let vfsHooks: VfsTrashHooks | null = null;

/** Wire vfs callbacks (called from useFileSystem on mount). */
export function registerVfsTrashHooks(hooks: VfsTrashHooks): void {
  vfsHooks = hooks;
}

/** Test/cleanup helper. */
export function _resetVfsTrashHooksForTest(): void {
  vfsHooks = null;
}

const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── Public façade ─────────────────────────────────────────

/**
 * Move every ref to the trash. Returns one PerItemResult per input
 * ref. Daemon-source refs surface as `not-found` (with an
 * explanatory message) until the daemon endpoints land.
 */
export async function trash(refs: readonly FileRef[]): Promise<PerItemResult[]> {
  const db = getDb();
  if (!db) {
    return refs.map((ref) => ({
      ok: false,
      ref,
      reason: "unknown",
      message: "SQLite not ready",
    }));
  }
  const out: PerItemResult[] = [];
  for (const ref of refs) {
    if (ref.source === "daemon") {
      out.push({
        ok: false,
        ref,
        reason: "not-found",
        message:
          "Daemon trash endpoints not yet available — falling back to immediate delete with confirmation in caller.",
      });
      continue;
    }
    if (!vfsHooks) {
      out.push({
        ok: false,
        ref,
        reason: "unknown",
        message: "vfs trash hooks not registered",
      });
      continue;
    }
    const moved = vfsHooks.moveToTrash(ref.nodeId);
    if (!moved) {
      out.push({
        ok: false,
        ref,
        reason: "not-found",
        message: `vfs node ${ref.nodeId} not found`,
      });
      continue;
    }
    const id = newId();
    await db.run(
      `INSERT INTO trash_items
        (id, source, vfs_node_id, original_parent_id, filename, mime, size_bytes, deleted_at)
       VALUES (?, 'vfs', ?, ?, ?, ?, ?, ?)`,
      [id, ref.nodeId, moved.originalParentId, moved.filename, moved.mime, moved.sizeBytes, Date.now()],
    );
    out.push({ ok: true, ref, finalRef: ref });
  }
  return out;
}

/**
 * List trash items in deletion-time order (newest first). The TrashManager
 * app reads this to render a single merged list.
 */
export async function list(): Promise<TrashItemRow[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.query<{
    id: string;
    source: string;
    daemon_source: string;
    original_path: string;
    restore_path: string;
    vfs_node_id: string;
    original_parent_id: string;
    filename: string;
    mime: string;
    size_bytes: number;
    deleted_at: number;
  }>(
    `SELECT id, source, daemon_source, original_path, restore_path,
            vfs_node_id, original_parent_id, filename, mime, size_bytes, deleted_at
     FROM trash_items ORDER BY deleted_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    source: r.source as "daemon" | "vfs",
    daemonSource: r.daemon_source || undefined,
    originalPath: r.original_path || undefined,
    restorePath: r.restore_path || undefined,
    vfsNodeId: r.vfs_node_id || undefined,
    originalParentId: r.original_parent_id || undefined,
    filename: r.filename,
    mime: r.mime,
    sizeBytes: r.size_bytes,
    deletedAt: r.deleted_at,
  }));
}

/** Restore an item back to its original location. Vfs-only for now. */
export async function restore(itemIds: readonly string[]): Promise<{
  restored: string[];
  failed: { id: string; reason: string }[];
}> {
  const db = getDb();
  if (!db) return { restored: [], failed: itemIds.map((id) => ({ id, reason: "no db" })) };
  const restored: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of itemIds) {
    const rows = await db.query<{
      source: string;
      vfs_node_id: string;
      original_parent_id: string;
      filename: string;
    }>(
      `SELECT source, vfs_node_id, original_parent_id, filename
       FROM trash_items WHERE id = ?`,
      [id],
    );
    if (rows.length === 0) {
      failed.push({ id, reason: "not-found" });
      continue;
    }
    const r = rows[0];
    if (r.source !== "vfs") {
      failed.push({ id, reason: "daemon-restore-not-supported" });
      continue;
    }
    if (!vfsHooks) {
      failed.push({ id, reason: "vfs-hooks-not-registered" });
      continue;
    }
    const ok = vfsHooks.restore(r.vfs_node_id, r.original_parent_id, r.filename);
    if (ok) {
      await db.run(`DELETE FROM trash_items WHERE id = ?`, [id]);
      restored.push(id);
    } else {
      failed.push({ id, reason: "vfs-restore-failed" });
    }
  }
  return { restored, failed };
}

/** Empty all daemon + vfs trash. */
export async function empty(): Promise<{ purged: number }> {
  const db = getDb();
  if (!db) return { purged: 0 };
  const rows = await db.query<{ source: string; vfs_node_id: string }>(
    `SELECT source, vfs_node_id FROM trash_items`,
  );
  let purged = 0;
  for (const r of rows) {
    if (r.source === "vfs" && vfsHooks) {
      vfsHooks.purge(r.vfs_node_id);
    }
    purged++;
  }
  await db.run(`DELETE FROM trash_items`);
  if (purged > 0) playSound("empty-trash");
  return { purged };
}

/** Count for badge / Empty-confirm dialog. */
export async function count(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const rows = await db.query<{ n: number }>(
    `SELECT COUNT(*) as n FROM trash_items`,
  );
  return rows[0]?.n ?? 0;
}
