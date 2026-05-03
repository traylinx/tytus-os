// CSV parser — RFC 4180 minimal coverage. The cases we ACTUALLY need
// to get right for M4.2 import: simple grids, quoted fields with
// embedded commas and newlines, escaped double-quote pairs.

import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a 2x2 grid with no quoting', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('parses a 2x2 grid with a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsv('a,"hello, world",b')).toEqual([
      ['a', 'hello, world', 'b'],
    ]);
  });

  it('handles escaped double quotes inside a quoted field', () => {
    expect(parseCsv('"she said ""hi""",end')).toEqual([
      ['she said "hi"', 'end'],
    ]);
  });

  it('handles embedded newlines inside a quoted field', () => {
    expect(parseCsv('a,"line1\nline2",b\n1,2,3')).toEqual([
      ['a', 'line1\nline2', 'b'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('preserves empty fields between commas', () => {
    expect(parseCsv('a,,b')).toEqual([['a', '', 'b']]);
  });
});
