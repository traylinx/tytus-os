// ============================================================
// FileRef — backend-aware reference to a single file or folder
// ============================================================
//
// Tytus OS coexists with two file backends today:
//
//   • vfs   — browser localStorage VFS, used by Desktop icons.
//             See `app/src/hooks/useFileSystem.ts`.
//   • daemon — host filesystem reached over the daemon HTTP API.
//             See `app/src/lib/daemon.ts` (`postFiles*`,
//             `getFilesList`, `filesDownloadUrl`). The daemon's own
//             `FileMutationSource.source` is the *backend ID*
//             ("tytus-home" / "shared" / "pod-workspace" / …) and
//             collides naming-wise with the FileRef discriminator,
//             so we keep them on different field names.
//
// Sprint A Phase 0 introduces this discriminated union so every
// drag-and-drop, clipboard, trash, and selection operation knows
// exactly which backend each item lives on. Without it the
// cross-backend semantics (FileManager → Desktop, Desktop → Files)
// either silently corrupt or accumulate ad-hoc conditionals.

import type { FileMutationSource } from "@/types/daemon/FileList";

/**
 * Discriminated union: every file/folder lives on exactly one
 * backend at a time. `source` is the FileRef-level discriminator
 * (`'vfs' | 'daemon'`); for daemon refs, `daemonSource` carries
 * the daemon's own backend identifier.
 */
export type FileRef =
  | VfsFileRef
  | DaemonFileRef;

export interface VfsFileRef {
  source: "vfs";
  /** `FileSystemNode.id` from `useFileSystem.ts`. */
  nodeId: string;
}

export interface DaemonFileRef {
  source: "daemon";
  /** Daemon's own backend id — e.g. "tytus-home", "shared", "pod-workspace". */
  daemonSource: string;
  /** Path within the daemon source. */
  path: string;
  /** Index into the bindings array; only meaningful when daemonSource === "shared". */
  binding?: number;
  /** Pod id; only meaningful when daemonSource === "pod-workspace". */
  pod?: string;
  /**
   * Readonly hint mirrored from `FileListEntry.readonly`. Cached on
   * the ref so consumers don't have to re-fetch the listing to know.
   * Falsy means "writable as far as we currently know"; the daemon is
   * the source of truth on the actual write attempt.
   */
  readonly?: boolean;
}

/**
 * What a consumer can do with this ref *based on currently-known
 * metadata*. The daemon may still reject a write at request time;
 * UIs should treat capabilities as a hint that drives drop-target
 * highlighting and menu enable/disable, not as authorisation.
 */
export interface FileCapabilities {
  readonly: boolean;
  canMove: boolean;
  canCopy: boolean;
  canTrash: boolean;
  canDownload: boolean;
  canRename: boolean;
}

/** Build a vfs-backed ref. */
export function refFromVfsNode(nodeId: string): VfsFileRef {
  if (!nodeId) {
    throw new Error("refFromVfsNode: nodeId is required");
  }
  return { source: "vfs", nodeId };
}

/** Build a daemon-backed ref. `daemonSource` defaults to "tytus-home". */
export function refFromDaemonPath(
  path: string,
  opts: {
    daemonSource?: string;
    binding?: number;
    pod?: string;
    readonly?: boolean;
  } = {},
): DaemonFileRef {
  if (!path) {
    throw new Error("refFromDaemonPath: path is required");
  }
  const ref: DaemonFileRef = {
    source: "daemon",
    daemonSource: opts.daemonSource ?? "tytus-home",
    path,
  };
  if (opts.binding !== undefined) ref.binding = opts.binding;
  if (opts.pod !== undefined) ref.pod = opts.pod;
  if (opts.readonly) ref.readonly = true;
  return ref;
}

/**
 * Capabilities derived from the ref. Conservative by default —
 * unknown daemon sources keep all capabilities except readonly,
 * since the daemon will be the final arbiter.
 */
export function capabilitiesOf(ref: FileRef): FileCapabilities {
  if (ref.source === "vfs") {
    return {
      readonly: false,
      canMove: true,
      canCopy: true,
      canTrash: true,
      canDownload: true,
      canRename: true,
    };
  }
  const ro = ref.readonly === true;
  return {
    readonly: ro,
    canMove: !ro,
    canCopy: true,
    canTrash: !ro,
    canDownload: true,
    canRename: !ro,
  };
}

/**
 * Stable string key suitable for React `key` props and Set/Map
 * deduplication across an entire selection. Same ref → same key;
 * two refs that point to different bytes → different keys.
 */
export function refKey(ref: FileRef): string {
  if (ref.source === "vfs") {
    return `vfs:${ref.nodeId}`;
  }
  const parts = [
    "daemon",
    ref.daemonSource,
    ref.binding !== undefined ? `b${ref.binding}` : "",
    ref.pod ? `p${ref.pod}` : "",
    ref.path,
  ];
  return parts.filter(Boolean).join(":");
}

/** Convert a daemon FileRef to the daemon API's FileMutationSource. */
export function toFileMutationSource(ref: DaemonFileRef): FileMutationSource {
  const out: FileMutationSource = {
    source: ref.daemonSource,
    path: ref.path,
  };
  if (ref.binding !== undefined) out.binding = ref.binding;
  return out;
}

/**
 * MIME type used when stuffing FileRef[] onto a HTML5 DataTransfer.
 * Matches the typed-payload convention from Phase 2's `lib/dnd.ts`.
 */
export const FILE_REF_MIME = "application/x-tytus-file-ref" as const;

/** Serialize a list of refs for DataTransfer.setData(). */
export function serializeRefs(refs: readonly FileRef[]): string {
  return JSON.stringify(refs);
}

/** Parse refs back. Returns null if the payload is malformed. */
export function parseRefs(payload: string | null | undefined): FileRef[] | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) return null;
    const out: FileRef[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") return null;
      const source = (item as { source?: unknown }).source;
      if (source === "vfs") {
        const nodeId = (item as { nodeId?: unknown }).nodeId;
        if (typeof nodeId !== "string" || !nodeId) return null;
        out.push({ source: "vfs", nodeId });
      } else if (source === "daemon") {
        const daemonSource = (item as { daemonSource?: unknown }).daemonSource;
        const path = (item as { path?: unknown }).path;
        if (typeof daemonSource !== "string" || typeof path !== "string") {
          return null;
        }
        const ref: DaemonFileRef = {
          source: "daemon",
          daemonSource,
          path,
        };
        const binding = (item as { binding?: unknown }).binding;
        if (typeof binding === "number") ref.binding = binding;
        const pod = (item as { pod?: unknown }).pod;
        if (typeof pod === "string") ref.pod = pod;
        const ro = (item as { readonly?: unknown }).readonly;
        if (ro === true) ref.readonly = true;
        out.push(ref);
      } else {
        return null;
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Type predicate. */
export function isVfsRef(ref: FileRef): ref is VfsFileRef {
  return ref.source === "vfs";
}

/** Type predicate. */
export function isDaemonRef(ref: FileRef): ref is DaemonFileRef {
  return ref.source === "daemon";
}
