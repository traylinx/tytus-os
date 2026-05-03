import type { FileRef } from './fs';
import { MIME_TRACK, MIME_VOICE_RECORDING } from './mime';

/**
 * Drag-and-drop payloads. The `mime` field is what gets written into
 * `DataTransfer` so cross-app drops can route via the OS's mime-based
 * dispatch (Music Creator → Desktop drop creates a `.tytus-track` file
 * via `host.fs.createFile` with `mimeType: MIME_TRACK` + `refTrackId`).
 */

export interface DraggedTrackPayload {
  mime: typeof MIME_TRACK;
  trackId: string;
  title: string;
  styleTags?: string;
  /** Suggested filename when dropped on a folder. */
  suggestedFileName: string;
}

export interface DraggedVoiceRecordingPayload {
  mime: typeof MIME_VOICE_RECORDING;
  recordingId: string;
  title: string;
  durationMs: number;
  suggestedFileName: string;
}

export interface DraggedFileRefPayload {
  mime: 'application/x-tytus-file-ref';
  fileRef: FileRef;
}

export type DragPayload =
  | DraggedTrackPayload
  | DraggedVoiceRecordingPayload
  | DraggedFileRefPayload;
