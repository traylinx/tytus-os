import { describe, expect, it } from 'vitest';
import {
  STUDIO_REPLACE_BLOCK_TOOL_NAME,
  parseStudioReplaceBlockArgs,
  studioReplaceBlockTool,
} from './replaceBlock';
import { FakeStudioDb } from './testFakeDb';
import type { StudioReplaceBlockPatch } from '../../edits/algebra';

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
    text: 'old text',
    meta_json: '{}',
    position: 1024,
  });
  return db;
};

describe('parseStudioReplaceBlockArgs', () => {
  it('accepts the minimum valid arg set', () => {
    expect(
      parseStudioReplaceBlockArgs({
        docId: 'd_1',
        blockId: 'b_1',
        newText: 'shiny',
      }),
    ).toEqual({ docId: 'd_1', blockId: 'b_1', newText: 'shiny' });
  });

  it('passes newBlockKind through when valid', () => {
    expect(
      parseStudioReplaceBlockArgs({
        docId: 'd_1',
        blockId: 'b_1',
        newText: 'Title',
        newBlockKind: 'heading-1',
      }),
    ).toEqual({
      docId: 'd_1',
      blockId: 'b_1',
      newText: 'Title',
      newBlockKind: 'heading-1',
    });
  });

  it('rejects an invalid newBlockKind', () => {
    expect(() =>
      parseStudioReplaceBlockArgs({
        docId: 'd_1',
        blockId: 'b_1',
        newText: 't',
        newBlockKind: 'banana',
      }),
    ).toThrow(/invalid newBlockKind/);
  });

  it('rejects missing newText', () => {
    expect(() =>
      parseStudioReplaceBlockArgs({ docId: 'd_1', blockId: 'b_1' }),
    ).toThrow(/newText/);
  });
});

describe('studioReplaceBlockTool', () => {
  it('exposes the spec-defined name', () => {
    const tool = studioReplaceBlockTool({ db: new FakeStudioDb() });
    expect(tool.name).toBe(STUDIO_REPLACE_BLOCK_TOOL_NAME);
    expect(tool.name).toBe('studioReplaceBlock');
    expect(tool.requiresApproval).toBe(false);
  });

  it('happy path: returns a valid studio.replaceBlock patch', async () => {
    const db = seedDb();
    const tool = studioReplaceBlockTool({ db });
    const out = (await tool.execute(
      { docId: 'd_1', blockId: 'b_1', newText: 'crisp' },
      { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
    )) as { patch: StudioReplaceBlockPatch };
    expect(out.patch.kind).toBe('studio.replaceBlock');
    expect(out.patch.docId).toBe('d_1');
    expect(out.patch.blockId).toBe('b_1');
    expect(out.patch.newText).toBe('crisp');
    expect(out.patch.newBlockKind).toBeUndefined();
  });

  it('passes newBlockKind through into the patch', async () => {
    const db = seedDb();
    const tool = studioReplaceBlockTool({ db });
    const out = (await tool.execute(
      {
        docId: 'd_1',
        blockId: 'b_1',
        newText: 'New title',
        newBlockKind: 'heading-1',
      },
      { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
    )) as { patch: StudioReplaceBlockPatch };
    expect(out.patch.newBlockKind).toBe('heading-1');
  });

  it('throws when the block is missing', async () => {
    const db = new FakeStudioDb();
    const tool = studioReplaceBlockTool({ db });
    await expect(
      tool.execute(
        { docId: 'd_1', blockId: 'b_missing', newText: '' },
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/block not found/);
  });

  it('throws when the block belongs to a different document', async () => {
    const db = seedDb();
    const tool = studioReplaceBlockTool({ db });
    await expect(
      tool.execute(
        { docId: 'd_other', blockId: 'b_1', newText: '' },
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/does not belong to doc/);
  });

  it('throws on invalid args', async () => {
    const tool = studioReplaceBlockTool({ db: new FakeStudioDb() });
    await expect(
      tool.execute(
        {},
        { sessionId: 's', appId: 'studio', approvalAlreadyGranted: false },
      ),
    ).rejects.toThrow(/docId/);
  });
});
