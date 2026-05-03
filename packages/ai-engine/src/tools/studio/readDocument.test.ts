import { describe, expect, it } from 'vitest';
import {
  STUDIO_READ_DOCUMENT_TOOL_NAME,
  parseStudioReadDocumentArgs,
  readDocument,
  studioReadDocumentTool,
} from './readDocument';
import { FakeStudioDb } from './testFakeDb';

const seedDb = (): FakeStudioDb => {
  const db = new FakeStudioDb();
  db.documents.push({
    id: 'd_1',
    title: 'Doc One',
    created_at: 100,
    updated_at: 200,
  });
  db.blocks.push(
    {
      id: 'b_1',
      document_id: 'd_1',
      kind: 'paragraph',
      text: 'hello',
      meta_json: '{}',
      position: 1024,
    },
    {
      id: 'b_2',
      document_id: 'd_1',
      kind: 'heading-1',
      text: 'Title',
      meta_json: '{}',
      position: 512, // out-of-order to assert ordering
    },
  );
  return db;
};

describe('parseStudioReadDocumentArgs', () => {
  it('accepts a valid docId', () => {
    expect(parseStudioReadDocumentArgs({ docId: 'd_1' })).toEqual({
      docId: 'd_1',
    });
  });

  it('rejects missing docId', () => {
    expect(() => parseStudioReadDocumentArgs({})).toThrow(/missing or invalid docId/);
  });

  it('rejects non-object args', () => {
    expect(() => parseStudioReadDocumentArgs(null)).toThrow(/must be an object/);
    expect(() => parseStudioReadDocumentArgs('d_1')).toThrow(/must be an object/);
  });
});

describe('readDocument (helper)', () => {
  it('returns doc + blocks ordered by position', async () => {
    const db = seedDb();
    const r = await readDocument({ db }, { docId: 'd_1' });
    expect(r.doc).toEqual({ id: 'd_1', title: 'Doc One' });
    expect(r.blocks.map((b) => b.id)).toEqual(['b_2', 'b_1']);
    expect(r.blocks[0].kind).toBe('heading-1');
    expect(r.blocks[1].text).toBe('hello');
  });

  it('falls back to paragraph for unknown kind values', async () => {
    const db = new FakeStudioDb();
    db.documents.push({
      id: 'd_x',
      title: 'X',
      created_at: 0,
      updated_at: 0,
    });
    db.blocks.push({
      id: 'b_x',
      document_id: 'd_x',
      kind: 'wackadoo' as string,
      text: '',
      meta_json: '{}',
      position: 100,
    });
    const r = await readDocument({ db }, { docId: 'd_x' });
    expect(r.blocks[0].kind).toBe('paragraph');
  });
});

describe('studioReadDocumentTool', () => {
  it('exposes the spec-defined name', () => {
    const tool = studioReadDocumentTool({ db: new FakeStudioDb() });
    expect(tool.name).toBe(STUDIO_READ_DOCUMENT_TOOL_NAME);
    expect(tool.name).toBe('studioReadDocument');
    expect(tool.requiresApproval).toBe(false);
  });

  it('happy path: returns doc + blocks via execute', async () => {
    const db = seedDb();
    const tool = studioReadDocumentTool({ db });
    const out = (await tool.execute(
      { docId: 'd_1' },
      { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
    )) as { doc: { id: string }; blocks: Array<{ id: string }> };
    expect(out.doc.id).toBe('d_1');
    expect(out.blocks).toHaveLength(2);
  });

  it('throws when the document is missing', async () => {
    const db = new FakeStudioDb();
    const tool = studioReadDocumentTool({ db });
    await expect(
      tool.execute(
        { docId: 'd_missing' },
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/document not found/);
  });

  it('throws on invalid args (missing docId)', async () => {
    const tool = studioReadDocumentTool({ db: new FakeStudioDb() });
    await expect(
      tool.execute(
        {},
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/missing or invalid docId/);
  });
});
