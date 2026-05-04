import { describe, expect, it, vi } from 'vitest';
import type { FsApi } from '@tytus/host-api';
import { createDaemonFs, __daemonFsInternalsForTest } from './host-fs-daemon';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('host-fs-daemon', () => {
  it('maps user documents to daemon user-documents root', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/files/list?source=user-documents');
      return json(200, {
        source: 'user-documents',
        path: '',
        root_label: 'Documents',
        root_path: '/Users/test/Documents',
        entries: [],
        readonly: false,
      });
    });
    const fs = createDaemonFs({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const id = await fs.ensureUserFolder('documents');
    expect(id).toBe('daemonfs:user-documents:');
  });

  it('lists daemon directory entries as FileNode ids', async () => {
    const fetchImpl = vi.fn(async () => json(200, {
      source: 'user-documents',
      path: 'Tytus/Memo',
      root_label: 'Documents',
      root_path: '/Users/test/Documents',
      readonly: false,
      entries: [
        { name: 'a.md', path: 'Tytus/Memo/a.md', kind: 'file', size: 12, modified_at: 42, readonly: false },
      ],
    }));
    const fs = createDaemonFs({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const rows = await fs.list(__daemonFsInternalsForTest.nodeId('user-documents', 'Tytus/Memo'));
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'daemonfs:user-documents:Tytus%2FMemo%2Fa.md',
        parentId: 'daemonfs:user-documents:Tytus%2FMemo',
        name: 'a.md',
        isDirectory: false,
        mimeType: 'text/markdown',
        sizeBytes: 12,
      }),
    ]);
  });

  it('writes by delete-then-upload for daemon ids', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)} ${init?.body ?? ''}`);
      return json(200, { ok: true });
    });
    const fs = createDaemonFs({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await fs.write('daemonfs:user-documents:Tytus%2FMemo%2Fnote.md', '# Note');
    expect(calls[0]).toContain('POST /api/files/delete');
    expect(calls[0]).toContain('"path":"Tytus/Memo/note.md"');
    expect(calls[1]).toContain('POST /api/files/upload');
    expect(calls[1]).toContain('"path":"Tytus/Memo"');
    expect(calls[1]).toContain('"name":"note.md"');
  });

  it('falls back when daemon root probe fails', async () => {
    const fetchImpl = vi.fn(async () => json(404, { error: 'not found' }));
    const fallback = {
      ensureUserFolder: vi.fn(async () => 'user:documents'),
    } as unknown as FsApi;
    const fs = createDaemonFs({ fetchImpl: fetchImpl as unknown as typeof fetch, fallback });
    await expect(fs.ensureUserFolder('documents')).resolves.toBe('user:documents');
    expect(fallback?.ensureUserFolder).toHaveBeenCalledWith('documents');
  });
});
