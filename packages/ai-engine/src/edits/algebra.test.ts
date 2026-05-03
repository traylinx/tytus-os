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
