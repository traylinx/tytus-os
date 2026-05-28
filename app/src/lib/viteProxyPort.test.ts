import { describe, expect, it } from 'vitest';
import { parsePort } from '../../vite.config';

describe('vite tray proxy port parsing', () => {
  it('accepts valid TCP ports', () => {
    expect(parsePort('4343')).toBe(4343);
    expect(parsePort(' 55007\n')).toBe(55007);
  });

  it('rejects invalid or unsafe port values', () => {
    expect(parsePort('')).toBeNull();
    expect(parsePort('0')).toBeNull();
    expect(parsePort('65536')).toBeNull();
    expect(parsePort('abc')).toBeNull();
  });
});
