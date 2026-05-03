import { describe, expect, it } from 'vitest';
import {
  PROPOSE_PATCHES_MAX,
  SHEET_MOVE_RANGE_MAX_MAPPINGS,
  isPatchUnimplemented,
  patchDocId,
  validatePatch,
  type Patch,
} from './algebra';

describe('Patch algebra — static validation', () => {
  it('accepts a well-formed text.replace patch', () => {
    const p: Patch = {
      kind: 'text.replace',
      docId: 'doc-1',
      range: { start: { offset: 0 }, end: { offset: 5 } },
      text: 'Hello',
    };
    expect(validatePatch(p)).toEqual([]);
  });

  it('rejects a text.replace with end before start', () => {
    const p: Patch = {
      kind: 'text.replace',
      docId: 'doc-1',
      range: { start: { offset: 10 }, end: { offset: 5 } },
      text: 'oops',
    };
    expect(validatePatch(p)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('invalid text range') }),
    ]);
  });

  it('rejects a text.insert with negative offset', () => {
    const p: Patch = {
      kind: 'text.insert',
      docId: 'doc-1',
      at: { offset: -1 },
      text: 'oops',
    };
    expect(validatePatch(p)[0].message).toMatch(/invalid insert offset/);
  });

  it('caps sheet.moveRange at 200 mappings', () => {
    expect(SHEET_MOVE_RANGE_MAX_MAPPINGS).toBe(200);
    const p: Patch = {
      kind: 'sheet.moveRange',
      sheetId: 'sheet-1',
      mappings: Array.from({ length: 201 }, (_, i) => ({
        from: `A${i + 1}:A${i + 1}`,
        to: `B${i + 1}`,
      })),
    };
    expect(validatePatch(p)[0].message).toMatch(/capped at 200/);
  });

  it('rejects sheet.moveRange with zero mappings', () => {
    const p: Patch = {
      kind: 'sheet.moveRange',
      sheetId: 'sheet-1',
      mappings: [],
    };
    expect(validatePatch(p)[0].message).toMatch(/at least 1/);
  });

  it('rejects file.create with reserved Windows name', () => {
    const p: Patch = {
      kind: 'file.create',
      parentId: 'folder-1',
      name: 'CON',
      content: '',
      existsPolicy: 'fail',
    };
    expect(validatePatch(p)[0].message).toMatch(/reserved file name/);
  });

  it('rejects file.create with empty/dot/dotdot name', () => {
    for (const bad of ['', '.', '..']) {
      const p: Patch = {
        kind: 'file.create',
        parentId: 'folder-1',
        name: bad,
        content: '',
        existsPolicy: 'fail',
      };
      const issues = validatePatch(p);
      expect(issues.some((i) => i.message.includes('invalid file name'))).toBe(
        true,
      );
    }
  });

  it('rejects hidden file.create unless existsPolicy is rename', () => {
    const p: Patch = {
      kind: 'file.create',
      parentId: 'folder-1',
      name: '.hidden',
      content: '',
      existsPolicy: 'fail',
    };
    expect(validatePatch(p)[0].message).toMatch(/hidden names/);

    const ok: Patch = { ...p, existsPolicy: 'rename' };
    expect(validatePatch(ok)).toEqual([]);
  });

  it('rejects brain.append without aiSource', () => {
    const p: Patch = {
      kind: 'brain.append',
      target: 'today',
      block: '- Did stuff',
      aiSource: '',
    };
    expect(validatePatch(p)[0].message).toMatch(/non-empty aiSource/);
  });

  it('rejects memo.create without title', () => {
    const p: Patch = {
      kind: 'memo.create',
      folder: 'Memos',
      title: '',
      body: 'body',
    };
    expect(validatePatch(p)[0].message).toMatch(/requires a title/);
  });

  it('PROPOSE_PATCHES_MAX is the spec-defined cap', () => {
    expect(PROPOSE_PATCHES_MAX).toBe(100);
  });

  // ── W6 PR-Studio-Engine — studio.* patch variants ──────────────
  it('accepts a well-formed studio.replaceBlock patch', () => {
    const p: Patch = {
      kind: 'studio.replaceBlock',
      docId: 'd_1',
      blockId: 'b_1',
      newText: 'Concise new prose',
    };
    expect(validatePatch(p)).toEqual([]);
  });

  it('accepts a studio.replaceBlock with newBlockKind override', () => {
    const p: Patch = {
      kind: 'studio.replaceBlock',
      docId: 'd_1',
      blockId: 'b_1',
      newText: 'Title',
      newBlockKind: 'heading-1',
    };
    expect(validatePatch(p)).toEqual([]);
  });

  it('rejects studio.replaceBlock with empty docId / blockId', () => {
    const p: Patch = {
      kind: 'studio.replaceBlock',
      docId: '',
      blockId: '',
      newText: 'x',
    };
    const issues = validatePatch(p);
    expect(issues.some((i) => i.path === '/docId')).toBe(true);
    expect(issues.some((i) => i.path === '/blockId')).toBe(true);
  });

  it('rejects studio.replaceBlock with non-string newText', () => {
    const p = {
      kind: 'studio.replaceBlock',
      docId: 'd_1',
      blockId: 'b_1',
      newText: 42 as unknown as string,
    } as Patch;
    expect(validatePatch(p)[0].path).toBe('/newText');
  });

  it('accepts studio.insertBlock with afterBlockId', () => {
    const p: Patch = {
      kind: 'studio.insertBlock',
      docId: 'd_1',
      afterBlockId: 'b_1',
      block: { kind: 'paragraph', text: 'next paragraph' },
    };
    expect(validatePatch(p)).toEqual([]);
  });

  it('accepts studio.insertBlock with beforeBlockId', () => {
    const p: Patch = {
      kind: 'studio.insertBlock',
      docId: 'd_1',
      beforeBlockId: 'b_1',
      block: { kind: 'bullet', text: 'an outline bullet' },
    };
    expect(validatePatch(p)).toEqual([]);
  });

  it('rejects studio.insertBlock with neither beforeBlockId nor afterBlockId', () => {
    const p: Patch = {
      kind: 'studio.insertBlock',
      docId: 'd_1',
      block: { kind: 'paragraph', text: 'orphan' },
    };
    expect(validatePatch(p)[0].message).toMatch(
      /requires exactly one of beforeBlockId or afterBlockId/,
    );
  });

  it('rejects studio.insertBlock with both anchors set', () => {
    const p: Patch = {
      kind: 'studio.insertBlock',
      docId: 'd_1',
      beforeBlockId: 'b_1',
      afterBlockId: 'b_2',
      block: { kind: 'paragraph', text: 'ambiguous' },
    };
    expect(validatePatch(p)[0].message).toMatch(/cannot set both/);
  });

  it('rejects studio.insertBlock with missing block.text', () => {
    const p = {
      kind: 'studio.insertBlock',
      docId: 'd_1',
      afterBlockId: 'b_1',
      block: { kind: 'paragraph' },
    } as unknown as Patch;
    expect(
      validatePatch(p).some((i) => i.path === '/block/text'),
    ).toBe(true);
  });

  it('accepts a well-formed studio.deleteBlock patch', () => {
    const p: Patch = {
      kind: 'studio.deleteBlock',
      docId: 'd_1',
      blockId: 'b_1',
    };
    expect(validatePatch(p)).toEqual([]);
  });

  it('rejects studio.deleteBlock with empty docId / blockId', () => {
    const p: Patch = {
      kind: 'studio.deleteBlock',
      docId: '',
      blockId: '',
    };
    const issues = validatePatch(p);
    expect(issues.some((i) => i.path === '/docId')).toBe(true);
    expect(issues.some((i) => i.path === '/blockId')).toBe(true);
  });

  it('patchDocId returns docId for the studio.* patches', () => {
    expect(
      patchDocId({
        kind: 'studio.replaceBlock',
        docId: 'd_x',
        blockId: 'b_x',
        newText: '',
      }),
    ).toBe('d_x');
    expect(
      patchDocId({
        kind: 'studio.insertBlock',
        docId: 'd_y',
        afterBlockId: 'b_a',
        block: { kind: 'paragraph', text: '' },
      }),
    ).toBe('d_y');
    expect(
      patchDocId({
        kind: 'studio.deleteBlock',
        docId: 'd_z',
        blockId: 'b_z',
      }),
    ).toBe('d_z');
  });
});

describe('Patch algebra — helpers', () => {
  it('patchDocId returns the docId for text patches', () => {
    expect(
      patchDocId({
        kind: 'text.insert',
        docId: 'd1',
        at: { offset: 0 },
        text: '',
      }),
    ).toBe('d1');
    expect(
      patchDocId({
        kind: 'text.delete',
        docId: 'd2',
        range: { start: { offset: 0 }, end: { offset: 1 } },
      }),
    ).toBe('d2');
    expect(
      patchDocId({
        kind: 'memo.replace',
        memoId: 'm1',
        body: '',
      }),
    ).toBe('m1');
  });

  it('patchDocId returns null for non-buffer patches', () => {
    expect(
      patchDocId({
        kind: 'file.create',
        parentId: 'p',
        name: 'a.txt',
        content: '',
        existsPolicy: 'fail',
      }),
    ).toBeNull();
    expect(
      patchDocId({
        kind: 'sheet.writeRange',
        sheetId: 's',
        range: 'A1:A1',
        values: [['x']],
      }),
    ).toBeNull();
    expect(
      patchDocId({
        kind: 'brain.append',
        target: 'today',
        block: '-',
        aiSource: 'tytus-os/memo:v1',
      }),
    ).toBeNull();
  });

  it('isPatchUnimplemented flags brain.append in M2', () => {
    expect(
      isPatchUnimplemented({
        kind: 'brain.append',
        target: 'today',
        block: '-',
        aiSource: 'tytus-os/memo:v1',
      }),
    ).toBe(true);
    expect(
      isPatchUnimplemented({
        kind: 'text.insert',
        docId: 'd1',
        at: { offset: 0 },
        text: '',
      }),
    ).toBe(false);
  });
});
