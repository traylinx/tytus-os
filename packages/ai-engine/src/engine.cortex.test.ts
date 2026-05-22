// M6 — sprint 2026-05-21-chat-with-pods-local-cortex-parity.
//
// Cortex memory recall integration tests. Verifies the helper that
// formats memory hits into a system prompt block. The runRequest-level
// integration (does the engine actually call host.ai.cortexSearch?) is
// covered by tsc — `loadCortexMemoryBlock` lives in engine.ts and only
// fires when `opts.useCortex` is set.

import { describe, expect, it } from 'vitest';
import { formatCortexMemoryBlock } from './engine';

describe('formatCortexMemoryBlock', () => {
  it('returns null for an empty hit list', () => {
    expect(formatCortexMemoryBlock([])).toBeNull();
  });

  it('emits numbered items with two-decimal similarity scores', () => {
    const block = formatCortexMemoryBlock([
      { content: 'User prefers concise email tone.', similarity: 0.842 },
      { content: 'User is drafting the Q3 proposal.', similarity: 0.751 },
    ]);
    expect(block).toContain('1. (similarity 0.84) User prefers concise email tone.');
    expect(block).toContain('2. (similarity 0.75) User is drafting the Q3 proposal.');
  });

  it('wraps the block with stable tags downstream tooling can match', () => {
    const block = formatCortexMemoryBlock([
      { content: 'anything', similarity: 0.5 },
    ]);
    // Pin the tag shape — switching these breaks prompt-eval scripts.
    expect(block).toMatch(/^<cortex_memory>\n/);
    expect(block).toMatch(/\n<\/cortex_memory>$/);
  });

  it("collapses internal whitespace so a hit can't smuggle in structure", () => {
    // A memory with embedded newlines or repeated whitespace could
    // otherwise inject `</cortex_memory>` mid-line or break the numbered
    // list. We collapse to single spaces and trim.
    const block = formatCortexMemoryBlock([
      {
        content: '  Multi\n  line\nmemory\t\twith    weird   spacing  ',
        similarity: 0.9,
      },
    ]);
    expect(block).toContain('1. (similarity 0.90) Multi line memory with weird spacing');
    // No raw newlines inside the content portion of the line.
    const lines = block!.split('\n');
    const itemLine = lines.find((l) => l.startsWith('1.'));
    expect(itemLine).toBeDefined();
    expect(itemLine!.includes('\n')).toBe(false);
  });

  it('preserves order — top hits first', () => {
    const block = formatCortexMemoryBlock([
      { content: 'most relevant', similarity: 0.95 },
      { content: 'second', similarity: 0.7 },
      { content: 'third', similarity: 0.5 },
    ]);
    const idxFirst = block!.indexOf('most relevant');
    const idxSecond = block!.indexOf('second');
    const idxThird = block!.indexOf('third');
    expect(idxFirst).toBeLessThan(idxSecond);
    expect(idxSecond).toBeLessThan(idxThird);
  });
});
