// Voice Recorder repo — workspace-package edition.
//
// Lifted from app/src/lib/repo/voiceRecordings.ts as part of W3 of the
// apps-platform sprint. Two structural changes vs the legacy in-tree
// version:
//
//   1. Physical table name is the per-app prefixed `app_voice_recorder_recordings`
//      (was `voice_recordings`). The host-api prefix guard rejects any
//      query that touches a table outside the bound app's prefix, so the
//      previous global table name would have failed on first call.
//
//   2. The `Db` handle is passed in instead of pulled from a global
//      `getDb()`. Apps in the workspace world don't reach into the
//      shell's singleton — they get an `AppDb` from
//      `host.storage.current()` at boot and pass it through.
//
// Legacy localStorage migration is not run here: workspace packages
// can't read the un-prefixed `voice_recordings` table (the prefix guard
// rejects it) and the legacy localStorage drain runs in the shell shim
// before this package boots. `tryImportLegacyRows` stays as an internal
// no-op shim so future shell-side imports have a place to land.

import type { AppDb } from '@tytus/host-api';

export interface VoiceRecordingRow {
  id: string;
  name: string;
  durationMs: number;
  createdAt: number;
  mimeType: string;
  audioDataUrl: string;
}

interface DBRow {
  id: string;
  name: string;
  duration_ms: number;
  created_at: number;
  mime_type: string;
  audio_data_url: string;
}

const fromDb = (r: DBRow): VoiceRecordingRow => ({
  id: r.id,
  name: r.name,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
  mimeType: r.mime_type,
  audioDataUrl: r.audio_data_url,
});

export const listRecordings = async (
  db: AppDb,
): Promise<VoiceRecordingRow[]> => {
  const rows = await db.query<DBRow>(
    `SELECT id, name, duration_ms, created_at, mime_type, audio_data_url
       FROM app_voice_recorder_recordings
      ORDER BY created_at DESC`,
  );
  return rows.map(fromDb);
};

export const insertRecording = async (
  db: AppDb,
  rec: VoiceRecordingRow,
): Promise<void> => {
  await db.run(
    `INSERT OR REPLACE INTO app_voice_recorder_recordings
       (id, name, duration_ms, created_at, mime_type, audio_data_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rec.id, rec.name, rec.durationMs, rec.createdAt, rec.mimeType, rec.audioDataUrl],
  );
};

export const updateRecordingName = async (
  db: AppDb,
  id: string,
  name: string,
): Promise<void> => {
  await db.run(
    `UPDATE app_voice_recorder_recordings SET name = ? WHERE id = ?`,
    [name, id],
  );
};

export const deleteRecording = async (
  db: AppDb,
  id: string,
): Promise<void> => {
  await db.run(
    `DELETE FROM app_voice_recorder_recordings WHERE id = ?`,
    [id],
  );
};

// Internal no-op shim. Workspace-package apps cannot read the legacy
// un-prefixed `voice_recordings` table (the prefix guard rejects it),
// so the actual legacy-data migration runs in the shell shim before
// this package boots. Kept exported so the shim's call site stays
// stable: the shim can be a no-op call here today and grow into a
// real adapter without changing the boot wiring.
export const tryImportLegacyRows = async (db: AppDb): Promise<void> => {
  // Reference the parameter so erasableSyntaxOnly + noUnusedParameters
  // (when enabled) don't complain. The actual import happens shell-side.
  void db;
};
