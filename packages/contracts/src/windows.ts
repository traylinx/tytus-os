import type { FileRef } from './fs';

/**
 * Per-app window argument shapes. The shell's `host.windows.open(appId, args)`
 * dispatches to the right shape based on `appId`. Apps narrow `args` against
 * `WindowArgs.<id>` to read their own params. Adding a new app means adding
 * its key here; everything else is structural.
 */
export interface WindowArgsByApp {
  sheet: SheetWindowArgs;
  studio: StudioWindowArgs;
  memo: MemoWindowArgs;
  'music-creator': MusicCreatorWindowArgs;
  'music-player': MusicPlayerWindowArgs;
  'voice-recorder': VoiceRecorderWindowArgs;
}

export type WindowArgs<K extends keyof WindowArgsByApp = keyof WindowArgsByApp> =
  WindowArgsByApp[K];

export interface SheetWindowArgs {
  fileRef?: FileRef;
  /** Open in read-only mode (e.g. workbook preview from File Manager). */
  readOnly?: boolean;
}

export interface StudioWindowArgs {
  fileRef?: FileRef;
  /** Initial mode; if absent, Studio infers from the file extension. */
  mode?: 'code' | 'text' | 'markdown' | 'json';
  readOnly?: boolean;
}

export interface MemoWindowArgs {
  fileRef?: FileRef;
  /** Open the editor focused on a specific line (deep-link from Brain). */
  focusLine?: number;
  readOnly?: boolean;
}

export interface MusicCreatorWindowArgs {
  /** Pre-fill style tags / lyrics from a quick action. */
  draft?: { styleTags?: string; lyrics?: string };
}

export interface MusicPlayerWindowArgs {
  /** Start playing this track. */
  trackId?: string;
  /** Autoplay on open (default false — respects browser autoplay policy). */
  autoplay?: boolean;
}

export interface VoiceRecorderWindowArgs {
  /** Start recording immediately (consent must already be granted). */
  startImmediately?: boolean;
}
