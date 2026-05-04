/**
 * Daemon-backed host.fs implementation.
 *
 * This is the real-files bridge for standalone apps. It maps the typed
 * host.fs user folders to the tray daemon's `/api/files/*` endpoints so app
 * writes land in the user's OS-visible folders instead of browser
 * localStorage. A localStorage FsApi can be supplied as fallback for pure
 * browser/test sessions where the daemon is not serving `/api/files/list`.
 */

import type { FileNode } from '@tytus/contracts';
import type { FsApi, FsChangeEvent, UserFolderName } from '@tytus/host-api';

interface DaemonFileEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size: number;
  modified_at: number | null;
  readonly: boolean;
}

interface DaemonFileList {
  source: string;
  path: string;
  root_label: string;
  root_path: string;
  entries: DaemonFileEntry[];
  readonly: boolean;
}

export interface DaemonFsOptions {
  /** Defaults to same-origin. Tests can point at a fake origin. */
  baseUrl?: string;
  /** Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Optional fallback for daemon-offline browser-only sessions. */
  fallback?: FsApi;
  /** Mutation event sink; host-impl bridges this into host.events. */
  onChange?: (event: FsChangeEvent) => void;
}

const USER_FOLDER_SOURCE: Record<UserFolderName, string> = {
  documents: 'user-documents',
  desktop: 'user-desktop',
  downloads: 'user-downloads',
  music: 'user-music',
  pictures: 'user-pictures',
};

const USER_FOLDER_LABEL: Record<UserFolderName, string> = {
  documents: 'Documents',
  desktop: 'Desktop',
  downloads: 'Downloads',
  music: 'Music',
  pictures: 'Pictures',
};

const TEXT_EXTS = new Set([
  '.md',
  '.txt',
  '.json',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.html',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.sql',
]);

const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

const ICON_BY_EXT: Record<string, string> = {
  '.md': 'FileText',
  '.txt': 'FileText',
  '.csv': 'Sheet',
  '.json': 'Braces',
  '.tytus-sheet.json': 'Sheet',
  '.tytus-memo.json': 'StickyNote',
  '.mp3': 'Music',
  '.wav': 'Music',
  '.m4a': 'Music',
  '.png': 'Image',
  '.jpg': 'Image',
  '.jpeg': 'Image',
  '.webp': 'Image',
};

interface DaemonNodeId {
  source: string;
  path: string;
}

const ID_PREFIX = 'daemonfs:';

function extOf(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of Object.keys(MIME_BY_EXT).sort((a, b) => b.length - a.length)) {
    if (lower.endsWith(ext)) return ext;
  }
  const idx = lower.lastIndexOf('.');
  return idx >= 0 ? lower.slice(idx) : '';
}

function iconForFileName(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of Object.keys(ICON_BY_EXT).sort((a, b) => b.length - a.length)) {
    if (lower.endsWith(ext)) return ICON_BY_EXT[ext];
  }
  return 'File';
}

function nodeId(source: string, path: string): string {
  return `${ID_PREFIX}${source}:${encodeURIComponent(path)}`;
}

function parseNodeId(id: string): DaemonNodeId | null {
  if (!id.startsWith(ID_PREFIX)) return null;
  const rest = id.slice(ID_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx < 0) return null;
  return {
    source: rest.slice(0, idx),
    path: decodeURIComponent(rest.slice(idx + 1)),
  };
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '' : path.slice(0, idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    out += String.fromCharCode(...chunk);
  }
  return btoa(out);
}

function stringToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

function entryToNode(entry: DaemonFileEntry, source: string, parentPath: string): FileNode {
  const id = nodeId(source, entry.path);
  const ext = extOf(entry.name);
  return {
    id,
    parentId: nodeId(source, parentPath),
    name: entry.name,
    isDirectory: entry.kind === 'dir',
    mimeType: entry.kind === 'file' ? MIME_BY_EXT[ext] : undefined,
    mtimeMs: entry.modified_at ?? 0,
    sizeBytes: entry.size,
  };
}

function rootNode(id: DaemonNodeId): FileNode {
  const label = Object.entries(USER_FOLDER_SOURCE).find(([, source]) => source === id.source)?.[0] as UserFolderName | undefined;
  return {
    id: nodeId(id.source, ''),
    parentId: null,
    name: label ? USER_FOLDER_LABEL[label] : id.source,
    isDirectory: true,
    mtimeMs: 0,
  };
}

function isTextPath(path: string): boolean {
  return TEXT_EXTS.has(extOf(path));
}

/** Create a daemon-backed FsApi with optional local fallback. */
export function createDaemonFs(opts: DaemonFsOptions = {}): FsApi {
  const baseUrl = (opts.baseUrl ?? '').replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const fallback = opts.fallback;
  const onChange = opts.onChange ?? (() => {});

  const url = (path: string): string => `${baseUrl}${path}`;

  const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetchImpl(url(path), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const message =
        typeof (body as { error?: unknown } | null)?.error === 'string'
          ? ((body as { error: string }).error)
          : `daemon fs http ${res.status}`;
      throw new Error(message);
    }
    return body as T;
  };

  const listDaemon = async (id: DaemonNodeId): Promise<DaemonFileList> => {
    const q = new URLSearchParams({ source: id.source });
    if (id.path) q.set('path', id.path);
    return requestJson<DaemonFileList>(`/api/files/list?${q.toString()}`);
  };

  const postJson = async (path: string, body: unknown): Promise<void> => {
    await requestJson(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  const emit = (event: FsChangeEvent) => {
    try {
      onChange(event);
    } catch (err) {
      console.error('[host.fs.daemon] onChange listener threw', err);
    }
  };

  const requireDaemon = (id: string): DaemonNodeId => {
    const parsed = parseNodeId(id);
    if (!parsed) throw new Error(`host.fs.daemon: not a daemon node id: ${id}`);
    return parsed;
  };

  const getNodeDaemon = async (id: DaemonNodeId): Promise<FileNode | null> => {
    if (!id.path) return rootNode(id);
    const parentPath = dirname(id.path);
    const listing = await listDaemon({ source: id.source, path: parentPath });
    const name = basename(id.path);
    const found = listing.entries.find((entry) => entry.name === name || entry.path === id.path);
    return found ? entryToNode(found, id.source, parentPath) : null;
  };

  return {
    async ensureUserFolder(name) {
      const id = nodeId(USER_FOLDER_SOURCE[name], '');
      if (!fallback) return id;
      try {
        await listDaemon({ source: USER_FOLDER_SOURCE[name], path: '' });
        return id;
      } catch {
        return fallback.ensureUserFolder(name);
      }
    },

    async read(fileNodeId) {
      const parsed = parseNodeId(fileNodeId);
      if (!parsed) {
        if (!fallback) throw new Error(`host.fs.read: unknown node id ${fileNodeId}`);
        return fallback.read(fileNodeId);
      }
      if (!parsed.path) throw new Error(`host.fs.read: ${fileNodeId} is a directory`);
      const q = new URLSearchParams({ source: parsed.source, path: parsed.path });
      const res = await fetchImpl(url(`/api/files/download?${q.toString()}`), {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`host.fs.read: daemon download failed (${res.status})`);
      if (isTextPath(parsed.path)) return res.text();
      return new Uint8Array(await res.arrayBuffer());
    },

    async write(fileNodeId, content) {
      const parsed = parseNodeId(fileNodeId);
      if (!parsed) {
        if (!fallback) throw new Error(`host.fs.write: unknown node id ${fileNodeId}`);
        return fallback.write(fileNodeId, content);
      }
      if (!parsed.path) throw new Error(`host.fs.write: ${fileNodeId} is a directory`);
      // Upload endpoint is intentionally create-only. For host.fs.write semantics,
      // replace the file atomically enough for app-level docs: delete old file if
      // present, then upload the new bytes. Delete failure for a missing file is
      // ignored so write can create too.
      try {
        await postJson('/api/files/delete', { source: parsed.source, path: parsed.path });
      } catch {
        // ignore not-found; upload below is source of truth
      }
      const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content);
      await postJson('/api/files/upload', {
        source: parsed.source,
        path: dirname(parsed.path),
        name: basename(parsed.path),
        content_base64: bytesToBase64(bytes),
      });
      emit({
        kind: 'modified',
        fileNodeId,
        parentId: nodeId(parsed.source, dirname(parsed.path)),
        name: basename(parsed.path),
        isDirectory: false,
        mtimeMs: Date.now(),
      });
    },

    async createFile(parentId, name, content, options) {
      const parsed = parseNodeId(parentId);
      if (!parsed) {
        if (!fallback) throw new Error(`host.fs.createFile: unknown parent id ${parentId}`);
        return fallback.createFile(parentId, name, content, options);
      }
      const isBytes = content instanceof Uint8Array;
      await postJson('/api/files/upload', {
        source: parsed.source,
        path: parsed.path,
        name,
        content_base64: isBytes ? bytesToBase64(content) : stringToBase64(content),
      });
      const id = nodeId(parsed.source, joinPath(parsed.path, name));
      emit({
        kind: 'created',
        fileNodeId: id,
        parentId,
        name,
        isDirectory: false,
        mtimeMs: Date.now(),
      });
      return id;
    },

    async createFolder(parentId, name) {
      const parsed = parseNodeId(parentId);
      if (!parsed) {
        if (!fallback) throw new Error(`host.fs.createFolder: unknown parent id ${parentId}`);
        return fallback.createFolder(parentId, name);
      }
      await postJson('/api/files/mkdir', { source: parsed.source, path: parsed.path, name });
      const id = nodeId(parsed.source, joinPath(parsed.path, name));
      emit({
        kind: 'created',
        fileNodeId: id,
        parentId,
        name,
        isDirectory: true,
        mtimeMs: Date.now(),
      });
      return id;
    },

    async rename(fileNodeId, newName) {
      const parsed = parseNodeId(fileNodeId);
      if (!parsed) {
        if (!fallback) throw new Error(`host.fs.rename: unknown node id ${fileNodeId}`);
        return fallback.rename(fileNodeId, newName);
      }
      const oldName = basename(parsed.path);
      await postJson('/api/files/rename', {
        source: parsed.source,
        path: parsed.path,
        new_name: newName,
      });
      emit({
        kind: 'renamed',
        fileNodeId: nodeId(parsed.source, joinPath(dirname(parsed.path), newName)),
        parentId: nodeId(parsed.source, dirname(parsed.path)),
        name: newName,
        oldName,
        isDirectory: false,
        mtimeMs: Date.now(),
      });
    },

    async list(parentId) {
      const parsed = parseNodeId(parentId);
      if (!parsed) {
        if (!fallback) throw new Error(`host.fs.list: unknown node id ${parentId}`);
        return fallback.list(parentId);
      }
      const listing = await listDaemon(parsed);
      return listing.entries.map((entry) => entryToNode(entry, parsed.source, parsed.path));
    },

    async findChildByName(parentId, name) {
      const rows = await this.list(parentId);
      return rows.find((row) => row.name === name) ?? null;
    },

    async getNodeById(id) {
      const parsed = parseNodeId(id);
      if (!parsed) {
        if (!fallback) return null;
        return fallback.getNodeById(id);
      }
      return getNodeDaemon(parsed);
    },

    getIconForFileName: iconForFileName,

    watch(parentId, onChange, opts) {
      const parsed = parseNodeId(parentId);
      if (!parsed && fallback) return fallback.watch(parentId, onChange, opts);
      // Daemon file events are polling-only today; callers can refresh after
      // their own writes. Keep disposer shape stable.
      return () => {};
    },
  };
}

export const __daemonFsInternalsForTest = {
  nodeId,
  parseNodeId,
};
