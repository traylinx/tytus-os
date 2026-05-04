/**
 * Minimal localStorage-backed `host.fs` implementation for M1.
 *
 * Purpose: prove the @tytus/host-api file-system surface works end to
 * end before the FileRef-backed tree (M3) lands. Notes' M1 proof + any
 * other early consumer can read/write/list/create through this without
 * touching the existing useFileSystem context.
 *
 * Tree shape: a flat record keyed by node id, persisted as JSON under
 * `tytus.host.fs.tree.v1`. Roots are pre-seeded for the four user
 * folders (documents, desktop, downloads, music) so apps can call
 * `ensureUserFolder('documents')` without creating one. Bytes for
 * non-text writes are base64-encoded (localStorage stores strings only;
 * 5–10 MB browser quota is the operational ceiling — Memo's M7 OPFS
 * implementation lifts this).
 *
 * Limitations (intentional for M1):
 * - watch() is a no-op disposer — change events get a real bus in M3.
 * - rename() updates the name; descendants don't move (flat parentId).
 * - No quota enforcement; localStorage's QuotaExceededError surfaces.
 *
 * M3 replaces this entirely with the FileRef-backed implementation
 * wired to the existing app/src/lib/file-system context.
 */

import type { FileNode } from '@tytus/contracts';
import type { FsApi, FsChangeEvent } from '@tytus/host-api';

const STORAGE_KEY = 'tytus.host.fs.tree.v1';

interface FsRecord {
  id: string;
  parentId: string | null;
  name: string;
  isDirectory: boolean;
  /** UTF-8 string content for text files; base64 for byte writes. */
  content?: string;
  /** When `isDirectory && false`: 'text' | 'bytes'. Tells `read` how to decode. */
  encoding?: 'text' | 'bytes';
  mimeType?: string;
  mtimeMs: number;
  refTrackId?: string;
}

interface FsTree {
  version: 1;
  nodes: Record<string, FsRecord>;
}

const USER_FOLDERS = ['documents', 'desktop', 'downloads', 'music'] as const;

function freshTree(): FsTree {
  const now = Date.now();
  const tree: FsTree = { version: 1, nodes: {} };
  for (const f of USER_FOLDERS) {
    const id = `user:${f}`;
    tree.nodes[id] = {
      id,
      parentId: null,
      name: f.charAt(0).toUpperCase() + f.slice(1),
      isDirectory: true,
      mtimeMs: now,
    };
  }
  return tree;
}

function readTree(storage: Storage): FsTree {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return freshTree();
  try {
    const parsed = JSON.parse(raw) as FsTree;
    if (parsed && parsed.version === 1 && parsed.nodes) {
      // Patch in any missing user folders (idempotent across schema bumps).
      const tree = { ...parsed, nodes: { ...parsed.nodes } };
      const now = Date.now();
      for (const f of USER_FOLDERS) {
        const id = `user:${f}`;
        if (!tree.nodes[id]) {
          tree.nodes[id] = {
            id,
            parentId: null,
            name: f.charAt(0).toUpperCase() + f.slice(1),
            isDirectory: true,
            mtimeMs: now,
          };
        }
      }
      return tree;
    }
  } catch {
    // Fall through — corrupted state gets reset.
  }
  return freshTree();
}

function writeTree(storage: Storage, tree: FsTree): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

function nextId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `node_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function recordToNode(rec: FsRecord): FileNode {
  return {
    id: rec.id,
    parentId: rec.parentId,
    name: rec.name,
    isDirectory: rec.isDirectory,
    mimeType: rec.mimeType,
    mtimeMs: rec.mtimeMs,
    refTrackId: rec.refTrackId,
    sizeBytes: rec.content ? rec.content.length : 0,
  };
}

const DEFAULT_ICON_BY_EXT: Record<string, string> = {
  '.md': 'FileText',
  '.txt': 'FileText',
  '.csv': 'Sheet',
  '.json': 'Braces',
  '.tytus-sheet.json': 'Sheet',
  '.tytus-memo.json': 'StickyNote',
};

function iconForFileName(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of Object.keys(DEFAULT_ICON_BY_EXT)) {
    if (lower.endsWith(ext)) return DEFAULT_ICON_BY_EXT[ext];
  }
  return 'File';
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export interface LocalStorageFsOptions {
  /** Defaults to `globalThis.localStorage`. Tests inject an in-memory shim. */
  storage?: Storage;
  /** Optional event bus to dispatch FsChangeEvent on every mutation. The
   *  shell's `host.events` bus passes through if supplied; tests can
   *  observe changes by passing a sink. */
  onChange?: (event: FsChangeEvent) => void;
}

/**
 * Build a real-but-minimal `FsApi` backed by localStorage. Suitable for
 * the M1 Notes proof and any other early host.fs consumer until M3's
 * FileRef wiring lands.
 */
export function createLocalStorageFs(opts: LocalStorageFsOptions = {}): FsApi {
  const storage = opts.storage ?? globalThis.localStorage;
  if (!storage) {
    throw new Error(
      'createLocalStorageFs: no localStorage available. Inject opts.storage in this environment.',
    );
  }
  const onChange = opts.onChange ?? (() => {});

  const requireRecord = (id: string): FsRecord => {
    const tree = readTree(storage);
    const rec = tree.nodes[id];
    if (!rec) throw new Error(`host.fs: node not found: ${id}`);
    return rec;
  };

  const fireChange = (event: FsChangeEvent) => {
    try {
      onChange(event);
    } catch (err) {
      console.error('[host.fs] onChange listener threw', err);
    }
  };

  return {
    async ensureUserFolder(name) {
      // Names are normalized at the type boundary (UserFolderName); the
      // tree pre-seeds them on read, so we just return the id.
      const id = `user:${name}`;
      const tree = readTree(storage);
      if (!tree.nodes[id]) {
        // Defensive — readTree should have patched this, but if a custom
        // storage shim returned a fixed payload, repair here.
        tree.nodes[id] = {
          id,
          parentId: null,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          isDirectory: true,
          mtimeMs: Date.now(),
        };
        writeTree(storage, tree);
      }
      return id;
    },

    async read(fileNodeId) {
      const rec = requireRecord(fileNodeId);
      if (rec.isDirectory) {
        throw new Error(`host.fs.read: ${fileNodeId} is a directory`);
      }
      if (rec.encoding === 'bytes') {
        return base64ToBytes(rec.content ?? '');
      }
      return rec.content ?? '';
    },

    async write(fileNodeId, content) {
      const tree = readTree(storage);
      const rec = tree.nodes[fileNodeId];
      if (!rec) throw new Error(`host.fs.write: node not found: ${fileNodeId}`);
      if (rec.isDirectory) {
        throw new Error(`host.fs.write: ${fileNodeId} is a directory`);
      }
      const isBytes = content instanceof Uint8Array;
      tree.nodes[fileNodeId] = {
        ...rec,
        content: isBytes ? bytesToBase64(content) : (content as string),
        encoding: isBytes ? 'bytes' : 'text',
        mtimeMs: Date.now(),
      };
      writeTree(storage, tree);
      fireChange({
        kind: 'modified',
        fileNodeId,
        parentId: rec.parentId ?? '',
        name: rec.name,
        isDirectory: false,
        mtimeMs: tree.nodes[fileNodeId].mtimeMs,
      });
    },

    async createFile(parentId, name, content, options) {
      const tree = readTree(storage);
      const parent = tree.nodes[parentId];
      if (!parent || !parent.isDirectory) {
        throw new Error(
          `host.fs.createFile: parent not a folder: ${parentId}`,
        );
      }
      const isBytes = content instanceof Uint8Array;
      const id = nextId();
      const now = Date.now();
      tree.nodes[id] = {
        id,
        parentId,
        name,
        isDirectory: false,
        content: isBytes ? bytesToBase64(content) : (content as string),
        encoding: isBytes ? 'bytes' : 'text',
        mimeType: options?.mimeType,
        refTrackId: options?.refTrackId,
        mtimeMs: now,
      };
      writeTree(storage, tree);
      fireChange({
        kind: 'created',
        fileNodeId: id,
        parentId,
        name,
        isDirectory: false,
        mtimeMs: now,
      });
      return id;
    },

    async createFolder(parentId, name) {
      const tree = readTree(storage);
      const parent = tree.nodes[parentId];
      if (!parent || !parent.isDirectory) {
        throw new Error(
          `host.fs.createFolder: parent not a folder: ${parentId}`,
        );
      }
      const id = nextId();
      const now = Date.now();
      tree.nodes[id] = {
        id,
        parentId,
        name,
        isDirectory: true,
        mtimeMs: now,
      };
      writeTree(storage, tree);
      fireChange({
        kind: 'created',
        fileNodeId: id,
        parentId,
        name,
        isDirectory: true,
        mtimeMs: now,
      });
      return id;
    },

    async rename(fileNodeId, newName) {
      const tree = readTree(storage);
      const rec = tree.nodes[fileNodeId];
      if (!rec) {
        throw new Error(`host.fs.rename: node not found: ${fileNodeId}`);
      }
      const oldName = rec.name;
      tree.nodes[fileNodeId] = {
        ...rec,
        name: newName,
        mtimeMs: Date.now(),
      };
      writeTree(storage, tree);
      fireChange({
        kind: 'renamed',
        fileNodeId,
        parentId: rec.parentId ?? '',
        name: newName,
        oldName,
        isDirectory: rec.isDirectory,
        mtimeMs: tree.nodes[fileNodeId].mtimeMs,
      });
    },

    async list(parentId) {
      const tree = readTree(storage);
      return Object.values(tree.nodes)
        .filter((rec) => rec.parentId === parentId)
        .sort(
          (a, b) =>
            // Folders first, then alphabetical.
            Number(b.isDirectory) - Number(a.isDirectory) ||
            a.name.localeCompare(b.name),
        )
        .map(recordToNode);
    },

    async findChildByName(parentId, name) {
      const tree = readTree(storage);
      const found = Object.values(tree.nodes).find(
        (rec) => rec.parentId === parentId && rec.name === name,
      );
      return found ? recordToNode(found) : null;
    },

    async getNodeById(id) {
      const tree = readTree(storage);
      const rec = tree.nodes[id];
      return rec ? recordToNode(rec) : null;
    },

    getIconForFileName: iconForFileName,

    watch() {
      // M1: no real change subscription; M3 wires through the shell event bus.
      return () => {};
    },
  };
}

/** Test helper: wipe the persisted tree from the given storage. */
export function resetLocalStorageFs(storage: Storage): void {
  storage.removeItem(STORAGE_KEY);
}
