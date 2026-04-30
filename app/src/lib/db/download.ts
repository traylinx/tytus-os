// Browser helper — saves the live SQLite database as a real .sqlite
// file in the user's Downloads folder. The bytes returned by
// `db.exportBytes()` are a standard SQLite file image; the resulting
// download opens directly in `sqlite3 tytusos.db`, the SQLite Browser,
// or any other tool that speaks the format.
//
// Used by:
//   - Settings → About → "Export database…" button
//   - Dev console:  await window.tytusDb.download()

import { getDb } from './index';

const stamp = (d = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
};

export const downloadDb = async (filename = `tytusos-${stamp()}.sqlite`): Promise<void> => {
  const db = getDb();
  if (!db || !db.exportBytes) {
    throw new Error('SQLite db not initialised');
  }
  const bytes = await db.exportBytes();
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const blob = new Blob([arrayBuffer], { type: 'application/vnd.sqlite3' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revocation so the browser has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
};
