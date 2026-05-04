import { describe, expect, it } from 'vitest';
import { createToolRegistry } from './registry';
import type { ToolDef } from '../types';

const tool = (name: string): ToolDef => ({
  name,
  description: `${name} tool`,
  parameters: { type: 'object', properties: {} },
  requiresApproval: false,
  execute: async () => ({ ok: true }),
});

describe('createToolRegistry', () => {
  it('returns a registry exposing every registered tool', () => {
    const reg = createToolRegistry([tool('a'), tool('b'), tool('c')]);
    expect(reg.names().sort()).toEqual(['a', 'b', 'c']);
    expect(reg.all()).toHaveLength(3);
    expect(reg.get('b')?.name).toBe('b');
  });

  it('returns undefined for unknown names', () => {
    const reg = createToolRegistry([tool('x')]);
    expect(reg.get('unknown')).toBeUndefined();
  });

  it('throws on duplicate tool names', () => {
    expect(() => createToolRegistry([tool('a'), tool('a')])).toThrow(
      /duplicate tool name/,
    );
  });

  it('throws on tools missing a name', () => {
    const bad = { ...tool('ok'), name: '' };
    expect(() => createToolRegistry([bad])).toThrow(/non-empty name/);
  });

  it('all() returns a fresh slice (caller can mutate without affecting state)', () => {
    const reg = createToolRegistry([tool('a')]);
    const out = reg.all();
    out.push(tool('mutated'));
    expect(reg.names()).toEqual(['a']);
  });
});
