import { describe, expect, it } from 'vitest';
import { transformCss } from './style-isolator';

describe('style-isolator — transformCss', () => {
  it('rewrites html/body/:root to the container selector', () => {
    const { css } = transformCss(
      `body { background: red } html { color: black } :root { font-size: 16px }`,
      { appId: 'sheet' },
    );
    expect(css).toContain('.tytus-app-sheet { background: red }');
    expect(css).toContain('.tytus-app-sheet { color: black }');
    expect(css).toContain('.tytus-app-sheet { font-size: 16px }');
    expect(css).not.toMatch(/\bbody\s*\{/);
    expect(css).not.toMatch(/\bhtml\s*\{/);
  });

  it('prefixes ordinary selectors with the container', () => {
    const { css } = transformCss(`.btn { color: blue }`, { appId: 'sheet' });
    expect(css).toContain('.tytus-app-sheet .btn { color: blue }');
  });

  it('prefixes selector lists individually', () => {
    const { css } = transformCss(
      `.foo, .bar, h1.heading { color: green }`,
      { appId: 'sheet' },
    );
    expect(css).toContain(
      '.tytus-app-sheet .foo, .tytus-app-sheet .bar, .tytus-app-sheet h1.heading',
    );
  });

  it('renames @keyframes and updates animation references', () => {
    const { css } = transformCss(
      `@keyframes spin { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } } .x { animation: spin 1s infinite }`,
      { appId: 'sheet' },
    );
    expect(css).toContain('@keyframes tytus-app-sheet-spin');
    expect(css).toContain('animation: tytus-app-sheet-spin 1s infinite');
    expect(css).not.toMatch(/animation: spin\b/);
  });

  it('namespaces CSS custom properties and their var() references', () => {
    const { css } = transformCss(
      `:root { --primary: red } .btn { color: var(--primary) }`,
      { appId: 'sheet' },
    );
    expect(css).toContain('--app-sheet-primary: red');
    expect(css).toContain('var(--app-sheet-primary)');
    expect(css).not.toContain('--primary:');
  });

  it('rejects @font-face with a warning instead of dropping silently', () => {
    const { css, warnings } = transformCss(
      `@font-face { font-family: 'X'; src: url('x.woff') } .x { color: red }`,
      { appId: 'sheet' },
    );
    expect(css).not.toContain('@font-face');
    expect(warnings.some((w) => w.includes('@font-face rejected'))).toBe(true);
    // The non-rejected rule still survives.
    expect(css).toContain('.tytus-app-sheet .x { color: red }');
  });

  it('rejects @import with a warning', () => {
    const { css, warnings } = transformCss(
      `@import url('shared.css'); .x { color: red }`,
      { appId: 'sheet' },
    );
    expect(css).not.toContain('@import');
    expect(warnings.some((w) => w.includes('@import rejected'))).toBe(true);
    expect(css).toContain('.tytus-app-sheet .x { color: red }');
  });

  it('wraps the whole stylesheet in @layer for predictable cascade', () => {
    const { css } = transformCss(`.x { color: red }`, { appId: 'sheet' });
    expect(css.startsWith('@layer tytus-app-sheet {')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it(':global() escape hatch passes selectors through unprefixed when enabled', () => {
    const { css } = transformCss(
      `:global(.shared-button) { color: blue }`,
      { appId: 'sheet', allowGlobalEscape: true },
    );
    expect(css).toContain('.shared-button { color: blue }');
    expect(css).not.toContain('.tytus-app-sheet .shared-button');
  });

  it(':global() is stripped (and its contents prefixed) when escape is disabled', () => {
    const { css } = transformCss(
      `:global(.shared) { color: blue }`,
      { appId: 'sheet' },
    );
    expect(css).not.toContain(':global');
    expect(css).toContain('.tytus-app-sheet .shared { color: blue }');
  });

  it('rewrites selectors inside @media blocks', () => {
    const { css } = transformCss(
      `@media (min-width: 600px) { .x { color: red } }`,
      { appId: 'sheet' },
    );
    expect(css).toContain('@media (min-width: 600px)');
    expect(css).toContain('.tytus-app-sheet .x { color: red }');
  });

  it('exposes the container selector for the loader to attach', () => {
    const { containerSelector } = transformCss(`.x{}`, { appId: 'memo' });
    expect(containerSelector).toBe('.tytus-app-memo');
  });

  it('handles the spec M1 fixture (body+btn+@keyframes+:root+@font-face)', () => {
    const fixture = `
      body { background: red }
      .btn { color: blue }
      @keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
      :root { --primary: red }
      @font-face { font-family: 'X'; src: url('x.woff') }
      .spinner { animation: spin 1s linear infinite; color: var(--primary) }
    `;
    const { css, warnings } = transformCss(fixture, { appId: 'sheet' });
    // Body/root rewritten, btn/spinner prefixed
    expect(css).toContain('.tytus-app-sheet { background: red }');
    expect(css).toContain('.tytus-app-sheet .btn { color: blue }');
    expect(css).toContain('.tytus-app-sheet .spinner');
    // Keyframes renamed
    expect(css).toContain('@keyframes tytus-app-sheet-spin');
    expect(css).toContain('animation: tytus-app-sheet-spin');
    // Variable namespaced + var() rewritten
    expect(css).toContain('--app-sheet-primary: red');
    expect(css).toContain('var(--app-sheet-primary)');
    // font-face rejected with warning
    expect(css).not.toContain('@font-face');
    expect(warnings).toContainEqual(
      expect.stringContaining('@font-face rejected'),
    );
  });
});
