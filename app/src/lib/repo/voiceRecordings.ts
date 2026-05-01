// Voice Recorder repo — SQLite-backed list + one-shot localStorage drain.
//
// Replaces the localStorage-backed `tytus.voice-recorder.recordings` array
// which hit the 5-10 MB browser quota after a few clips (each recording
// is a base64 data URL — ~10 MB per minute of webm/opus). Mirrors the
// `music_creator_tracks` repo pattern: independent rows, no whole-list
// re-serialization on every save.

import { getDb } from '@/lib/db';

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

export const listRecordings = async (): Promise<VoiceRecordingRow[]> => {
  const db = getDb();
  if (!db) return [];
  const rows = await db.query<DBRow>(
    `SELECT id, name, duration_ms, created_at, mime_type, audio_data_url
       FROM voice_recordings
      ORDER BY created_at DESC`,
  );
  return rows.map(fromDb);
};

export const insertRecording = async (rec: VoiceRecordingRow): Promise<void> => {
  const db = getDb();
  if (!db) throw new Error('Database not ready');
  await db.run(
    `INSERT OR REPLACE INTO voice_recordings
       (id, name, duration_ms, created_at, mime_type, audio_data_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rec.id, rec.name, rec.durationMs, rec.createdAt, rec.mimeType, rec.audioDataUrl],
  );
};

export const updateRecordingName = async (id: string, name: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('UPDATE voice_recordings SET name = ? WHERE id = ?', [name, id]);
};

export const deleteRecording = async (id: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('DELETE FROM voice_recordings WHERE id = ?', [id]);
};

// One-shot drain of the legacy localStorage array. Idempotent — once we
// successfully migrate, the key is removed and subsequent calls no-op.
const LEGACY_LS_KEY = 'tytus.voice-recorder.recordings';

export const migrateLegacyRecordingsToSqlite = async (): Promise<void> => {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(LEGACY_LS_KEY);
      return;
    }
    for (const r of parsed as Array<Partial<VoiceRecordingRow>>) {
      if (!r?.id || typeof r.audioDataUrl !== 'string') continue;
      try {
        await insertRecording({
          id: r.id,
          name: r.name ?? 'Untitled recording',
          durationMs: r.durationMs ?? 0,
          createdAt: r.createdAt ?? Date.now(),
          mimeType: r.mimeType ?? 'audio/webm',
          audioDataUrl: r.audioDataUrl,
        });
      } catch {
        // Skip individual bad rows — keep migration moving.
      }
    }
    localStorage.removeItem(LEGACY_LS_KEY);
  } catch (e) {
    console.warn('Voice recordings legacy migration failed:', e);
  }
};
