import { describe, expect, it, vi } from 'vitest';
import {
  classifyScope,
  fileRefReadTool,
  presetAutoApproves,
  type ConsentScope,
} from './fileRefRead';
import type { HostClient } from '@tytus/host-api';

function makeHost(nodes: Record<string, { name: string; parentId: string | null; isDirectory: boolean; content: string }>): HostClient {
  return {
    appId: 'sheet',
    fs: {
      ensureUserFolder: async () => 'docs',
      read: async (id) => nodes[id]?.content ?? '',
      write: async () => {},
      createFile: async () => 'new',
      createFolder: async () => 'newfolder',
      rename: async () => {},
      list: async () => [],
      findChildByName: async () => null,
      getNodeById: async (id) => {
        const n = nodes[id];
        if (!n) return null;
        return {
          id,
          parentId: n.parentId,
          name: n.name,
          isDirectory: n.isDirectory,
          mtimeMs: 0,
        };
      },
      getIconForFileName: () => 'File',
      watch: () => () => {},
    },
    daemon: {} as never,
    windows: {} as never,
    notifications: {} as never,
    shellMenu: {} as never,
    i18n: {} as never,
    storage: {} as never,
    events: {} as never,
    media: {} as never,
    assets: {} as never,
  };
}

describe('classifyScope', () => {
  it('returns active when the read targets the active doc', () => {
    expect(
      classifyScope('A', { activeDocumentId: 'A' }),
    ).toBe('active');
  });

  it('returns tab-neighbor when the read is in tabNeighborIds', () => {
    expect(
      classifyScope('B', {
        activeDocumentId: 'A',
        tabNeighborIds: ['B'],
      }),
    ).toBe('tab-neighbor');
  });

  it('returns sibling when same parent as active doc', () => {
    expect(
      classifyScope('C', {
        activeDocumentId: 'A',
        activeDocumentParentId: 'p1',
        candidateParentId: 'p1',
      }),
    ).toBe('sibling');
  });

  it('returns other when no other relationship matches', () => {
    expect(
      classifyScope('D', {
        activeDocumentId: 'A',
        activeDocumentParentId: 'p1',
        candidateParentId: 'p2',
      }),
    ).toBe('other');
  });
});

describe('presetAutoApproves', () => {
  it('doc-only-strict only auto-approves active', () => {
    const scopes: ConsentScope[] = ['active', 'tab-neighbor', 'sibling', 'other'];
    expect(scopes.map((s) => presetAutoApproves('doc-only-strict', s))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('doc-only auto-approves active + tab-neighbor', () => {
    const scopes: ConsentScope[] = ['active', 'tab-neighbor', 'sibling', 'other'];
    expect(scopes.map((s) => presetAutoApproves('doc-only', s))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('doc-and-siblings auto-approves active + tab-neighbor + sibling', () => {
    const scopes: ConsentScope[] = ['active', 'tab-neighbor', 'sibling', 'other'];
    expect(scopes.map((s) => presetAutoApproves('doc-and-siblings', s))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('fileRefReadTool', () => {
  const baseNodes = {
    A: { name: 'active.md', parentId: 'p1', isDirectory: false, content: 'active body' },
    B: { name: 'sibling.md', parentId: 'p1', isDirectory: false, content: 'sibling body' },
    C: { name: 'far.md', parentId: 'p2', isDirectory: false, content: 'far body' },
    p1: { name: 'folder1', parentId: null, isDirectory: true, content: '' },
    p2: { name: 'folder2', parentId: null, isDirectory: true, content: '' },
  };

  it('reads the active document without approval (doc-only)', async () => {
    const tool = fileRefReadTool(makeHost(baseNodes), {
      activeDocumentId: 'A',
      scope: 'doc-only',
    });
    const result = (await tool.execute({ fileNodeId: 'A' }, {
      sessionId: 's',
      appId: 'sheet',
      approvalAlreadyGranted: false,
    })) as { text: string; scope: string };
    expect(result.text).toBe('active body');
    expect(result.scope).toBe('active');
  });

  it('requires approval for sibling reads under doc-only', async () => {
    const requestApproval = vi.fn(async () => false);
    const tool = fileRefReadTool(makeHost(baseNodes), {
      activeDocumentId: 'A',
      scope: 'doc-only',
      requestApproval,
    });
    await expect(
      tool.execute({ fileNodeId: 'B' }, {
        sessionId: 's',
        appId: 'sheet',
        approvalAlreadyGranted: false,
      }),
    ).rejects.toThrow(/declined/);
    expect(requestApproval).toHaveBeenCalled();
    expect(
      (requestApproval.mock.calls.at(0) as unknown[] | undefined)?.[0],
    ).toBe('sibling');
  });

  it('auto-approves sibling reads under doc-and-siblings', async () => {
    const requestApproval = vi.fn(async () => true);
    const tool = fileRefReadTool(makeHost(baseNodes), {
      activeDocumentId: 'A',
      scope: 'doc-and-siblings',
      requestApproval,
    });
    const r = (await tool.execute({ fileNodeId: 'B' }, {
      sessionId: 's',
      appId: 'sheet',
      approvalAlreadyGranted: false,
    })) as { text: string; scope: string };
    expect(r.text).toBe('sibling body');
    expect(r.scope).toBe('sibling');
    expect(requestApproval).not.toHaveBeenCalled(); // sibling auto-approved
  });

  it('always requires approval for "other" scope (anywhere else)', async () => {
    const requestApproval = vi.fn(async () => true);
    const tool = fileRefReadTool(makeHost(baseNodes), {
      activeDocumentId: 'A',
      scope: 'doc-and-siblings',
      requestApproval,
    });
    await tool.execute({ fileNodeId: 'C' }, {
      sessionId: 's',
      appId: 'sheet',
      approvalAlreadyGranted: false,
    });
    expect(requestApproval).toHaveBeenCalled();
    expect(
      (requestApproval.mock.calls.at(0) as unknown[] | undefined)?.[0],
    ).toBe('other');
  });

  it('respects approvalAlreadyGranted to skip the chip', async () => {
    const requestApproval = vi.fn(async () => true);
    const tool = fileRefReadTool(makeHost(baseNodes), {
      activeDocumentId: 'A',
      scope: 'doc-only',
      requestApproval,
    });
    await tool.execute({ fileNodeId: 'B' }, {
      sessionId: 's',
      appId: 'sheet',
      approvalAlreadyGranted: true,
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('throws on directory ids', async () => {
    const tool = fileRefReadTool(makeHost(baseNodes), {
      activeDocumentId: 'A',
    });
    await expect(
      tool.execute({ fileNodeId: 'p1' }, {
        sessionId: 's',
        appId: 'sheet',
        approvalAlreadyGranted: true,
      }),
    ).rejects.toThrow(/is a directory/);
  });

  it('logs reads through onRead', async () => {
    const onRead = vi.fn();
    const tool = fileRefReadTool(makeHost(baseNodes), {
      activeDocumentId: 'A',
      scope: 'doc-only',
      onRead,
    });
    await tool.execute({ fileNodeId: 'A' }, {
      sessionId: 's',
      appId: 'sheet',
      approvalAlreadyGranted: false,
    });
    expect(onRead).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'active', fileNodeId: 'A' }),
    );
  });
});
