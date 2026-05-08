import { describe, it, expect } from 'vitest';
import { validateManifest } from './manifest';

const VALID = {
  id: 'photo-editor',
  name: 'Photo Editor',
  version: '1.0.0',
  icon: 'Image',
  category: 'Media',
  description: 'Edits photos',
  window: {
    defaultSize: { width: 1100, height: 760 },
    minSize: { width: 640, height: 480 },
  },
  permissions: ['vfs.user.documents', 'storage.app'],
  entry: { module: './dist/index.js' },
};

describe('validateManifest', () => {
  it('accepts a known-good manifest', () => {
    const r = validateManifest(VALID);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('rejects non-object inputs', () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest('string').valid).toBe(false);
    expect(validateManifest([]).valid).toBe(false);
  });

  it('rejects malformed id', () => {
    const bad = { ...VALID, id: 'Photo_Editor' };
    const r = validateManifest(bad);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === '/id')).toBe(true);
  });

  it('rejects empty name', () => {
    const r = validateManifest({ ...VALID, name: '   ' });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === '/name')).toBe(true);
  });

  it('rejects bad semver', () => {
    const r = validateManifest({ ...VALID, version: 'one-point-oh' });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === '/version')).toBe(true);
  });

  it('accepts pre-release semver', () => {
    const r = validateManifest({ ...VALID, version: '1.0.0-beta.1' });
    expect(r.valid).toBe(true);
  });

  it('accepts AI/Cortex permissions at runtime', () => {
    const r = validateManifest({
      ...VALID,
      permissions: ['ai.chat', 'ai.memory.read', 'ai.memory.write', 'ai.artifacts'],
    });
    expect(r.valid).toBe(true);
  });

  it('reports negative window size', () => {
    const r = validateManifest({
      ...VALID,
      window: {
        defaultSize: { width: -100, height: 760 },
        minSize: { width: 640, height: 480 },
      },
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === '/window/defaultSize/width')).toBe(true);
  });

  it('requires entry for non-alias kinds', () => {
    const { entry: _entry, ...withoutEntry } = VALID;
    const r = validateManifest({ ...withoutEntry, kind: 'installed' });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === '/entry')).toBe(true);
  });

  it("forbids entry for kind='alias'", () => {
    const r = validateManifest({ ...VALID, kind: 'alias', aliasOf: 'memo' });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === '/entry')).toBe(true);
  });

  it('rejects bad storage.tables[].name', () => {
    const r = validateManifest({
      ...VALID,
      storage: { tables: [{ name: 'BadName!', schema: 'migrations/0001.sql' }] },
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === '/storage/tables/0/name')).toBe(true);
  });

  it('accepts entry.url as the installed-app remote ESM transport', () => {
    const { entry: _entry, ...withoutEntry } = VALID;
    const r = validateManifest({
      ...withoutEntry,
      kind: 'installed',
      entry: {
        url: 'https://cdn.jsdelivr.net/gh/traylinx/tytus-app-text-editor@v0.1.0/dist/index.js',
      },
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('rejects entry with neither module nor url', () => {
    const { entry: _entry, ...withoutEntry } = VALID;
    const r = validateManifest({
      ...withoutEntry,
      kind: 'installed',
      entry: {},
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === '/entry')).toBe(true);
  });

  it('rejects entry with both module and url set (XOR)', () => {
    const { entry: _entry, ...withoutEntry } = VALID;
    const r = validateManifest({
      ...withoutEntry,
      kind: 'installed',
      entry: {
        module: './dist/index.js',
        url: 'https://cdn.example.com/app.js',
      },
    });
    expect(r.valid).toBe(false);
    expect(
      r.issues.some(
        (i) => i.path === '/entry' && /mutually exclusive/.test(i.message),
      ),
    ).toBe(true);
  });

  it('rejects entry.url that is not https://', () => {
    const { entry: _entry, ...withoutEntry } = VALID;
    for (const url of [
      'http://cdn.example.com/app.js',
      'data:text/javascript,export default null',
      'blob:https://x',
      'file:///tmp/app.js',
      'cdn.example.com/app.js',
    ]) {
      const r = validateManifest({
        ...withoutEntry,
        kind: 'installed',
        entry: { url },
      });
      expect(r.valid, `should reject url ${url}`).toBe(false);
      expect(r.issues.some((i) => i.path === '/entry/url')).toBe(true);
    }
  });

  it('reports multiple issues without bailing', () => {
    const r = validateManifest({
      id: 'BAD',
      name: '',
      version: 'no',
      window: { defaultSize: { width: 100, height: 100 }, minSize: { width: 50, height: 50 } },
      permissions: [],
      entry: { module: './x.js' },
    });
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });
});
