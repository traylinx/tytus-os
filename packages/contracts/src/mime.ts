/**
 * MIME types used across the Tytus apps platform.
 *
 * Custom application/x-tytus-* types identify Tytus-native document
 * formats so the OS can route them to the right app via manifest
 * `contributes.fileAssociations`.
 */

export const MIME_SHEET = 'application/x-tytus-sheet';
export const MIME_MEMO = 'application/x-tytus-memo';
export const MIME_TRACK = 'application/x-tytus-track';
export const MIME_VOICE_RECORDING = 'application/x-tytus-voice-recording';

/** Plain extensions that Tytus apps also handle. */
export const MIME_CSV = 'text/csv';
export const MIME_MARKDOWN = 'text/markdown';
export const MIME_JSON = 'application/json';
export const MIME_PLAIN = 'text/plain';

export const TYTUS_MIME_TYPES = [
  MIME_SHEET,
  MIME_MEMO,
  MIME_TRACK,
  MIME_VOICE_RECORDING,
] as const;

export type TytusMimeType = (typeof TYTUS_MIME_TYPES)[number];
