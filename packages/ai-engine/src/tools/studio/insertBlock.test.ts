import { describe, expect, it } from 'vitest';
import {
  STUDIO_INSERT_BLOCK_TOOL_NAME,
  parseStudioInsertBlockArgs,
  studioInsertBlockTool,
} from './insertBlock';
import { FakeStudioDb } from './testFakeDb';
import type { StudioInsertBlockPatch } from '../../edits/algebra';

const seedDb = (): FakeStudioDb => {
  const db = new FakeStudioDb();
  db.documents.push({
    id: 'd_1',
    title: '',
    created_at: 0,
    updated_at: 0,
  });
  db.blocks.push({
    id: 'b_1',
    document_id: 'd_1',
    kind: 'paragraph',
    text: 'anchor',
    meta_json: '{}',
    position: 1024,
  });
  return db;
};

describe('parseStudioInsertBlockArgs', () => {
  it('accepts a valid afterBlockId arg set', () => {
    const r = parseStudioInsertBlockArgs({
      docId: 'd_1',
      afterBlockId: 'b_1',
      kind: 'paragraph',
      text: 'next',
    });
    expect(r).toEqual({
      docId: 'd_1',
      afterBlockId: 'b_1',
      kind: 'paragraph',
      text: 'next',
    });
  });

  it('accepts a valid beforeBlockId arg set', () => {
    const r = parseStudioInsertBlockArgs({
      docId: 'd_1',
      beforeBlockId: 'b_1',
      kind: 'bullet',
      text: 'outline item',
    });
    expect(r.beforeBlockId).toBe('b_1');
    expect(r.afterBlockId).toBeUndefined();
  });

  it('rejects when neither anchor is set', () => {
    expect(() =>
      parseStudioInsertBlockArgs({
        docId: 'd_1',
        kind: 'paragraph',
        text: 'orphan',
      }),
    ).toThrow(/exactly one of beforeBlockId or afterBlockId/);
  });

  it('rejects when both anchors are set', () => {
    expect(() =>
      parseStudioInsertBlockArgs({
        docId: 'd_1',
        beforeBlockId: 'b_a',
        afterBlockId: 'b_b',
        kind: 'paragraph',
        text: 'ambiguous',
      }),
    ).toThrow(/cannot set both/);
  });

  it('rejects an invalid kind', () => {
    expect(() =>
      parseStudioInsertBlockArgs({
        docId: 'd_1',
        afterBlockId: 'b_1',
        kind: 'pumpkin',
        text: 'x',
      }),
    ).toThrow(/invalid kind/);
  });

  it('rejects missing docId', () => {
    expect(() =>
      parseStudioInsertBlockArgs({
        afterBlockId: 'b_1',
        kind: 'paragraph',
        text: 'x',
      }),
    ).toThrow(/docId/);
  });
});

describe('studioInsertBlockTool', () => {
  it('exposes the spec-defined name', () => {
    const tool = studioInsertBlockTool({ db: new FakeStudioDb() });
    expect(tool.name).toBe(STUDIO_INSERT_BLOCK_TOOL_NAME);
    expect(tool.name).toBe('studioInsertBlock');
    expect(tool.requiresApproval).toBe(false);
  });

  it('happy path: returns a valid studio.insertBlock patch', async () => {
    const db = seedDb();
    const tool = studioInsertBlockTool({ db });
    const out = (await tool.execute(
      {
        docId: 'd_1',
        afterBlockId: 'b_1',
        kind: 'paragraph',
        text: 'continued',
      },
      { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
    )) as { patch: StudioInsertBlockPatch };
    expect(out.patch.kind).toBe('studio.insertBlock');
    expect(out.patch.docId).toBe('d_1');
    expect(out.patch.afterBlockId).toBe('b_1');
    expect(out.patch.beforeBlockId).toBeUndefined();
    expect(out.patch.block).toEqual({ kind: 'paragraph', text: 'continued' });
  });

  it('preserves block.meta when supplied', async () => {
    const db = seedDb();
    const tool = studioInsertBlockTool({ db });
    const out = (await tool.execute(
      {
        docId: 'd_1',
        beforeBlockId: 'b_1',
        kind: 'code',
        text: 'console.log(1)',
        meta: { language: 'ts' },
      },
      { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
    )) as { patch: StudioInsertBlockPatch };
    expect(out.patch.block.meta).toEqual({ language: 'ts' });
  });

  it('throws when the anchor block is missing', async () => {
    const db = new FakeStudioDb();
    db.documents.push({
      id: 'd_1',
      title: '',
      created_at: 0,
      updated_at: 0,
    });
    const tool = studioInsertBlockTool({ db });
    await expect(
      tool.execute(
        {
          docId: 'd_1',
          afterBlockId: 'b_missing',
          kind: 'paragraph',
          text: 'x',
        },
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/anchor block not found/);
  });

  it('throws on invalid args (both anchors set)', async () => {
    const tool = studioInsertBlockTool({ db: new FakeStudioDb() });
    await expect(
      tool.execute(
        {
          docId: 'd_1',
          beforeBlockId: 'b_a',
          afterBlockId: 'b_b',
          kind: 'paragraph',
          text: 'x',
        },
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/cannot set both/);
  });

  it('throws when the anchor block belongs to a different doc', async () => {
    const db = seedDb();
    const tool = studioInsertBlockTool({ db });
    await expect(
      tool.execute(
        {
          docId: 'd_other',
          afterBlockId: 'b_1',
          kind: 'paragraph',
          text: 'x',
        },
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/does not belong to doc/);
  });
});
