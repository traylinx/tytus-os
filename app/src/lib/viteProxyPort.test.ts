import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_TRAY_PORT, parsePort, pickTrayPort } from '../../vite.config';

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

describe('vite tray proxy port selection', () => {
  it('prefers the tray-web.port candidate when it is not the daemon control port', () => {
    expect(pickTrayPort([55007, DEFAULT_DEV_TRAY_PORT], 49811)).toBe(55007);
  });

  it('falls back to the dev sidecar port when tray-web.port is missing', () => {
    expect(pickTrayPort([null, null, DEFAULT_DEV_TRAY_PORT], 49811)).toBe(DEFAULT_DEV_TRAY_PORT);
  });

  it('skips a stale tray-web.port that points at the daemon control port', () => {
    expect(pickTrayPort([49811, DEFAULT_DEV_TRAY_PORT], 49811)).toBe(DEFAULT_DEV_TRAY_PORT);
  });

  it('returns null when every candidate is missing or the daemon control port', () => {
    expect(pickTrayPort([null, 49811], 49811)).toBeNull();
  });
});
