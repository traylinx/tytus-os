// Custom wallpaper repo — single-row SQLite table holding the user's
// uploaded background image. Mirrors the `music_creator_tracks` shape:
// the bytes live as a base64 data URL in TEXT, OPFS-backed so multi-MB
// images survive reload without touching localStorage's 5 MB ceiling.

import { getDb } from '@/lib/db';

const CURRENT_ID = 'current';

export const MAX_CUSTOM_WALLPAPER_BYTES = 15 * 1024 * 1024; // 15 MB raw — fits 4K JPGs comfortably
export const ACCEPTED_WALLPAPER_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export interface CustomWallpaperRow {
  dataUrl: string;
  mime: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: number;
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });

export const loadCustomWallpaper = async (): Promise<CustomWallpaperRow | null> => {
  const db = getDb();
  if (!db) return null;
  const rows = await db.query<{
    data_url: string;
    mime: string;
    filename: string;
    size_bytes: number;
    uploaded_at: number;
  }>('SELECT data_url, mime, filename, size_bytes, uploaded_at FROM wallpaper_custom WHERE id = ?', [CURRENT_ID]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    dataUrl: r.data_url,
    mime: r.mime,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    uploadedAt: r.uploaded_at,
  };
};

export const saveCustomWallpaper = async (file: File): Promise<CustomWallpaperRow> => {
  if (!ACCEPTED_WALLPAPER_MIME.includes(file.type)) {
    throw new Error(`unsupported image type: ${file.type || 'unknown'} — use JPEG, PNG, or WebP`);
  }
  if (file.size > MAX_CUSTOM_WALLPAPER_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`image is ${mb} MB — keep it under 15 MB`);
  }
  const db = getDb();
  if (!db) throw new Error('database not initialized');

  const dataUrl = await fileToDataUrl(file);
  const row: CustomWallpaperRow = {
    dataUrl,
    mime: file.type,
    filename: file.name,
    sizeBytes: file.size,
    uploadedAt: Date.now(),
  };

  await db.run(
    `INSERT INTO wallpaper_custom (id, data_url, mime, filename, size_bytes, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data_url    = excluded.data_url,
       mime        = excluded.mime,
       filename    = excluded.filename,
       size_bytes  = excluded.size_bytes,
       uploaded_at = excluded.uploaded_at`,
    [CURRENT_ID, row.dataUrl, row.mime, row.filename, row.sizeBytes, row.uploadedAt],
  );
  return row;
};

export const clearCustomWallpaper = async (): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.run('DELETE FROM wallpaper_custom WHERE id = ?', [CURRENT_ID]);
};
