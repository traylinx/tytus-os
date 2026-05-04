/**
 * File system shapes shared between host and apps.
 *
 * `FileNode` is what `host.fs.list` and friends return; the `refTrackId`
 * extension is the optional pointer that maps a saved file back to the
 * Music Creator track that produced it. Adding more app-specific fields
 * here is fine — keep them optional so unrelated apps can ignore them.
 */

export interface FileNode {
  id: string;
  parentId: string | null;
  name: string;
  isDirectory: boolean;
  mimeType?: string;
  mtimeMs: number;
  sizeBytes?: number;
  /** Music Creator: track id that produced this file. */
  refTrackId?: string;
  /** Voice Recorder: recording id that produced this file. */
  refVoiceRecordingId?: string;
}

/**
 * Lightweight reference to a file by FileNode id. Apps pass FileRefs
 * around (drag-and-drop payloads, ⌘K context, AI tool args) instead of
 * raw paths so renames + moves stay correct.
 */
export interface FileRef {
  fileNodeId: string;
  /** Hint only; resolve via `host.fs.getNodeById` for the authoritative name. */
  name?: string;
  mimeType?: string;
  refTrackId?: string;
  refVoiceRecordingId?: string;
}
