import { describe, expect, it } from 'vitest';
import { trimContext, type ContextTurn, type SummaryFn } from './context';

const turn = (
  id: string,
  approxTokens: number,
  pinned = false,
): ContextTurn => ({
  id,
  role: 'user',
  approxTokens,
  pinned,
  content: id,
});

describe('trimContext — within budget', () => {
  it('returns all turns when total is under budget', async () => {
    const turns = [turn('a', 10), turn('b', 10), turn('c', 10)];
    const result = await trimContext(turns, 100);
    expect(result.kept).toEqual(turns);
    expect(result.dropped).toEqual([]);
  });
});

describe('trimContext — over budget, no summary', () => {
  it('drops oldest non-pinned turns until within budget', async () => {
    const turns = [
      turn('sys', 10, true), // pinned
      turn('a', 10),
      turn('b', 10),
      turn('c', 10),
      turn('d', 10),
    ];
    const result = await trimContext(turns, 30);
    // Pinned + as many recent non-pinned as fit (budget=30, sys=10, leaves
    // 20 for 2 newest).
    expect(result.kept.map((t) => t.id)).toEqual(['sys', 'c', 'd']);
    expect(result.dropped.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('keeps all pinned turns even when they exceed budget alone', async () => {
    const turns = [
      turn('p1', 10, true),
      turn('p2', 10, true),
      turn('a', 10),
    ];
    const result = await trimContext(turns, 15);
    expect(result.kept.map((t) => t.id)).toEqual(['p1', 'p2']);
    expect(result.dropped.map((t) => t.id)).toEqual(['a']);
  });
});

describe('trimContext — summary fallback', () => {
  it('calls summary fn when dropping turns and includes block in result', async () => {
    let called = false;
    const summary: SummaryFn = async (dropped) => {
      called = true;
      return `<context_summary>${dropped.map((t) => t.id).join(',')}</context_summary>`;
    };
    const turns = [
      turn('a', 10),
      turn('b', 10),
      turn('c', 10),
      turn('d', 10),
    ];
    const result = await trimContext(turns, 20, { summary });
    expect(called).toBe(true);
    expect(result.summaryBlock).toContain('a,b');
  });

  it('records summaryError but still returns kept/dropped on failure', async () => {
    const summary: SummaryFn = async () => {
      throw new Error('rate limited');
    };
    const turns = [turn('a', 10), turn('b', 10), turn('c', 10)];
    const result = await trimContext(turns, 15, { summary });
    expect(result.summaryBlock).toBeUndefined();
    expect(result.summaryError).toContain('rate limited');
    expect(result.kept.length).toBeGreaterThan(0);
  });

  it('skips summary when disableSummary is set (Settings opt-out)', async () => {
    let called = false;
    const summary: SummaryFn = async () => {
      called = true;
      return 's';
    };
    const turns = [turn('a', 10), turn('b', 10)];
    await trimContext(turns, 5, { summary, disableSummary: true });
    expect(called).toBe(false);
  });

  it('skips summary when parent was rate-limited (avoid stacking)', async () => {
    let called = false;
    const summary: SummaryFn = async () => {
      called = true;
      return 's';
    };
    const turns = [turn('a', 10), turn('b', 10)];
    await trimContext(turns, 5, { summary, parentRateLimited: true });
    expect(called).toBe(false);
  });
});
