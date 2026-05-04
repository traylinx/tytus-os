import { describe, expect, it } from 'vitest';
import { loadPrompt, parsePromptDocument, promptPath } from './prompts';
import type { AssetResolver } from './types';

const fakeAssets = (files: Record<string, string>): AssetResolver => ({
  text: async (path: string) => {
    if (!(path in files)) throw new Error(`asset not found: ${path}`);
    return files[path];
  },
  bytes: async () => new Uint8Array(),
});

describe('parsePromptDocument', () => {
  it('returns the body verbatim when no frontmatter', () => {
    const doc = parsePromptDocument('You are an editor.');
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe('You are an editor.');
  });

  it('extracts frontmatter into a key/value map', () => {
    const doc = parsePromptDocument(
      '---\napp: studio\nmode: code\nversion: 2026-05-03.1\nmodel_min: small\n---\nYou are Studio.',
    );
    expect(doc.frontmatter).toEqual({
      app: 'studio',
      mode: 'code',
      version: '2026-05-03.1',
      model_min: 'small',
    });
    expect(doc.body).toBe('You are Studio.');
  });

  it('only matches frontmatter at the very start of the file', () => {
    const doc = parsePromptDocument(
      'leading text\n---\napp: x\n---\nbody',
    );
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toMatch(/leading text/);
  });
});

describe('promptPath', () => {
  it('produces the expected path from (app, mode)', () => {
    expect(promptPath('sheet', 'default')).toBe('prompts/sheet-default.md');
    expect(promptPath('studio', 'code')).toBe('prompts/studio-code.md');
    expect(promptPath('memo', 'default')).toBe('prompts/memo-default.md');
  });
});

describe('loadPrompt', () => {
  it('resolves through the AssetResolver and parses', async () => {
    const assets = fakeAssets({
      'prompts/sheet-default.md':
        '---\napp: sheet\nmode: default\nversion: 2026-05-03.1\n---\nYou are Sheet.',
    });
    const doc = await loadPrompt(assets, 'sheet', 'default');
    expect(doc.frontmatter.version).toBe('2026-05-03.1');
    expect(doc.body).toBe('You are Sheet.');
  });

  it('honors promptVersion override path', async () => {
    const assets = fakeAssets({
      'prompts/sheet-default@v2.md': '---\nversion: v2\n---\nA/B variant.',
    });
    const doc = await loadPrompt(assets, 'sheet', 'default', 'v2');
    expect(doc.body).toBe('A/B variant.');
  });

  it('propagates resolver errors when prompt is missing', async () => {
    const assets = fakeAssets({});
    await expect(loadPrompt(assets, 'sheet', 'default')).rejects.toThrow(
      /asset not found/,
    );
  });
});
