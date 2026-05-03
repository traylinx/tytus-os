import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStorageFs, resetLocalStorageFs } from './host-fs-localstorage';
import type { FsChangeEvent } from '@tytus/host-api';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

afterEach(() => {
  resetLocalStorageFs(storage);
});

describe('host-fs-localstorage — user folders pre-seeded', () => {
  it('exposes the four user folders without explicit creation', async () => {
    const fs = createLocalStorageFs({ storage });
    for (const name of [
      'documents',
      'desktop',
      'downloads',
      'music',
    ] as const) {
      const id = await fs.ensureUserFolder(name);
      expect(id).toBe(`user:${name}`);
      const node = await fs.getNodeById(id);
      expect(node?.isDirectory).toBe(true);
    }
  });
});

describe('host-fs-localstorage — text round-trip', () => {
  it('createFile then read returns the same string', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    const id = await fs.createFile(docs, 'hello.txt', 'hello world');
    const text = await fs.read(id);
    expect(text).toBe('hello world');
  });

  it('write replaces existing content + bumps mtime', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    const id = await fs.createFile(docs, 'note.md', 'v1');
    const before = (await fs.getNodeById(id))!.mtimeMs;
    await new Promise((r) => setTimeout(r, 5));
    await fs.write(id, 'v2');
    const after = (await fs.getNodeById(id))!.mtimeMs;
    expect(await fs.read(id)).toBe('v2');
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe('host-fs-localstorage — bytes round-trip', () => {
  it('preserves arbitrary byte sequences via base64 encoding', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    const original = new Uint8Array([0, 1, 2, 254, 255, 128, 7]);
    const id = await fs.createFile(docs, 'blob.bin', original);
    const back = await fs.read(id);
    expect(back).toBeInstanceOf(Uint8Array);
    expect(Array.from(back as Uint8Array)).toEqual(Array.from(original));
  });
});

describe('host-fs-localstorage — directory ops', () => {
  it('createFolder + list returns folders first then files alpha-sorted', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    await fs.createFile(docs, 'b.txt', 'b');
    await fs.createFile(docs, 'a.txt', 'a');
    await fs.createFolder(docs, 'subfolder');
    const list = await fs.list(docs);
    expect(list.map((n) => n.name)).toEqual(['subfolder', 'a.txt', 'b.txt']);
    expect(list[0].isDirectory).toBe(true);
  });

  it('findChildByName returns the matching node or null', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    await fs.createFile(docs, 'unique.txt', 'data');
    const found = await fs.findChildByName(docs, 'unique.txt');
    expect(found?.name).toBe('unique.txt');
    expect(await fs.findChildByName(docs, 'missing.txt')).toBeNull();
  });

  it('rename updates the name and emits a renamed change event', async () => {
    const events: FsChangeEvent[] = [];
    const fs = createLocalStorageFs({
      storage,
      onChange: (e) => events.push(e),
    });
    const docs = await fs.ensureUserFolder('documents');
    const id = await fs.createFile(docs, 'old.txt', 'data');
    await fs.rename(id, 'new.txt');
    const node = await fs.getNodeById(id);
    expect(node?.name).toBe('new.txt');
    const renameEvent = events.find((e) => e.kind === 'renamed');
    expect(renameEvent).toBeDefined();
    expect(renameEvent?.oldName).toBe('old.txt');
    expect(renameEvent?.name).toBe('new.txt');
  });
});

describe('host-fs-localstorage — onChange notifications', () => {
  it('fires created on createFile + createFolder', async () => {
    const events: FsChangeEvent[] = [];
    const fs = createLocalStorageFs({
      storage,
      onChange: (e) => events.push(e),
    });
    const docs = await fs.ensureUserFolder('documents');
    await fs.createFile(docs, 'a.txt', 'a');
    await fs.createFolder(docs, 'sub');
    const created = events.filter((e) => e.kind === 'created');
    expect(created).toHaveLength(2);
  });

  it('fires modified on write', async () => {
    const events: FsChangeEvent[] = [];
    const fs = createLocalStorageFs({
      storage,
      onChange: (e) => events.push(e),
    });
    const docs = await fs.ensureUserFolder('documents');
    const id = await fs.createFile(docs, 'a.txt', 'v1');
    events.length = 0;
    await fs.write(id, 'v2');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('modified');
    expect(events[0].fileNodeId).toBe(id);
  });
});

describe('host-fs-localstorage — error paths', () => {
  it('read throws on a directory id', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    await expect(fs.read(docs)).rejects.toThrow(/is a directory/);
  });

  it('createFile throws when parent is not a folder', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    const file = await fs.createFile(docs, 'a.txt', 'a');
    await expect(
      fs.createFile(file, 'nested.txt', 'x'),
    ).rejects.toThrow(/parent not a folder/);
  });

  it('write throws on a directory id', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    await expect(fs.write(docs, 'x')).rejects.toThrow(/is a directory/);
  });
});

describe('host-fs-localstorage — Notes-style proof of round-trip through the API', () => {
  it('mimics the M1 Notes flow: create → read → edit → list', async () => {
    const fs = createLocalStorageFs({ storage });
    const docs = await fs.ensureUserFolder('documents');
    const memos = await fs.createFolder(docs, 'Memos');

    // Create three notes.
    const a = await fs.createFile(memos, 'meeting-notes.md', '# Agenda\n');
    const b = await fs.createFile(memos, 'todo.md', '- ship M1\n');
    const c = await fs.createFile(memos, 'idea.md', 'a bright idea');
    expect([a, b, c].every(Boolean)).toBe(true);

    // Edit one.
    await fs.write(b, '- ship M1\n- ship M2\n');
    expect(await fs.read(b)).toBe('- ship M1\n- ship M2\n');

    // Listing returns all three under the Memos folder.
    const listed = await fs.list(memos);
    expect(listed.map((n) => n.name).sort()).toEqual([
      'idea.md',
      'meeting-notes.md',
      'todo.md',
    ]);

    // Each carries a sane icon hint.
    expect(fs.getIconForFileName('todo.md')).toBe('FileText');
    expect(fs.getIconForFileName('blob.csv')).toBe('Sheet');
    expect(fs.getIconForFileName('weird.unknown')).toBe('File');
  });

  it('persists across factory rebuilds (state survives reload)', async () => {
    const fs1 = createLocalStorageFs({ storage });
    const docs = await fs1.ensureUserFolder('documents');
    const id = await fs1.createFile(docs, 'persists.md', 'still here');

    // Simulate a page reload by building a fresh instance over the same storage.
    const fs2 = createLocalStorageFs({ storage });
    const back = await fs2.read(id);
    expect(back).toBe('still here');
  });
});
