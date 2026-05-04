import { describe, expect, it } from 'vitest';
import {
  STUDIO_READ_BLOCK_TOOL_NAME,
  parseStudioReadBlockArgs,
  readBlock,
  studioReadBlockTool,
} from './readBlock';
import { FakeStudioDb } from './testFakeDb';

const seedDb = (): FakeStudioDb => {
  const db = new FakeStudioDb();
  db.documents.push({
    id: 'd_1',
    title: 'Doc',
    created_at: 0,
    updated_at: 0,
  });
  db.blocks.push({
    id: 'b_1',
    document_id: 'd_1',
    kind: 'paragraph',
    text: 'first paragraph',
    meta_json: '{"role":"intro"}',
    position: 1024,
  });
  return db;
};

describe('parseStudioReadBlockArgs', () => {
  it('accepts a valid arg pair', () => {
    expect(
      parseStudioReadBlockArgs({ docId: 'd_1', blockId: 'b_1' }),
    ).toEqual({ docId: 'd_1', blockId: 'b_1' });
  });

  it('rejects missing docId', () => {
    expect(() =>
      parseStudioReadBlockArgs({ blockId: 'b_1' }),
    ).toThrow(/docId/);
  });

  it('rejects missing blockId', () => {
    expect(() =>
      parseStudioReadBlockArgs({ docId: 'd_1' }),
    ).toThrow(/blockId/);
  });
});

describe('readBlock (helper)', () => {
  it('returns block fields + parses meta', async () => {
    const db = seedDb();
    const r = await readBlock(
      { db },
      { docId: 'd_1', blockId: 'b_1' },
    );
    expect(r.id).toBe('b_1');
    expect(r.kind).toBe('paragraph');
    expect(r.text).toBe('first paragraph');
    expect(r.meta).toEqual({ role: 'intro' });
  });

  it('throws when the block does not belong to the doc', async () => {
    const db = seedDb();
    db.documents.push({
      id: 'd_other',
      title: 'Other',
      created_at: 0,
      updated_at: 0,
    });
    await expect(
      readBlock({ db }, { docId: 'd_other', blockId: 'b_1' }),
    ).rejects.toThrow(/does not belong to doc/);
  });
});

describe('studioReadBlockTool', () => {
  it('exposes the spec-defined name', () => {
    const tool = studioReadBlockTool({ db: new FakeStudioDb() });
    expect(tool.name).toBe(STUDIO_READ_BLOCK_TOOL_NAME);
    expect(tool.name).toBe('studioReadBlock');
    expect(tool.requiresApproval).toBe(false);
  });

  it('happy path: returns block via execute', async () => {
    const db = seedDb();
    const tool = studioReadBlockTool({ db });
    const out = (await tool.execute(
      { docId: 'd_1', blockId: 'b_1' },
      { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
    )) as { id: string; text: string };
    expect(out.id).toBe('b_1');
    expect(out.text).toBe('first paragraph');
  });

  it('throws when the block does not exist', async () => {
    const tool = studioReadBlockTool({ db: new FakeStudioDb() });
    await expect(
      tool.execute(
        { docId: 'd_1', blockId: 'b_missing' },
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/block not found/);
  });

  it('throws on invalid args (missing blockId)', async () => {
    const tool = studioReadBlockTool({ db: new FakeStudioDb() });
    await expect(
      tool.execute(
        { docId: 'd_1' },
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/blockId/);
  });

  it('degrades malformed meta_json to empty object', async () => {
    const db = new FakeStudioDb();
    db.documents.push({
      id: 'd_1',
      title: '',
      created_at: 0,
      updated_at: 0,
    });
    db.blocks.push({
      id: 'b_bad',
      document_id: 'd_1',
      kind: 'paragraph',
      text: '',
      meta_json: '{not json',
      position: 0,
    });
    const r = await readBlock(
      { db },
      { docId: 'd_1', blockId: 'b_bad' },
    );
    expect(r.meta).toEqual({});
  });
});
