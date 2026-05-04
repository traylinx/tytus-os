/**
 * Tests for the bundled-app loader dispatch — pins the static map in
 * sync with `seed-bundled-apps.ts` and verifies the bare-specifier
 * routing.
 *
 * Background: the dynamic-loader used to default to
 * `import(/* @vite-ignore *​/ url)` which breaks for `@tytus/app-<id>`
 * specifiers (browser refuses to resolve a bare identifier without an
 * importmap). This file is the regression net for that bug.
 */

import { describe, expect, it } from 'vitest';

import {
  BUNDLED_APP_LOADERS,
  bundledIdFromSpecifier,
  isBundledSpecifier,
} from './bundled-app-loaders';
import { BUNDLED_APP_MANIFESTS } from './seed-bundled-apps';

describe('bundled-app-loaders helpers', () => {
  it('isBundledSpecifier matches @tytus/app-<id>', () => {
    expect(isBundledSpecifier('@tytus/app-sheet')).toBe(true);
    expect(isBundledSpecifier('@tytus/app-music-creator')).toBe(true);
  });

  it('isBundledSpecifier rejects URLs and other prefixes', () => {
    expect(isBundledSpecifier('https://cdn.jsdelivr.net/x.js')).toBe(false);
    expect(isBundledSpecifier('/packages/app-sheet/dist/index.js')).toBe(
      false,
    );
    expect(isBundledSpecifier('@tytus/host-api')).toBe(false);
  });

  it('bundledIdFromSpecifier strips the @tytus/app- prefix', () => {
    expect(bundledIdFromSpecifier('@tytus/app-sheet')).toBe('sheet');
    expect(bundledIdFromSpecifier('@tytus/app-music-creator')).toBe(
      'music-creator',
    );
  });
});

describe('BUNDLED_APP_LOADERS map', () => {
  it('covers every id in BUNDLED_APP_MANIFESTS (drift guard)', () => {
    const seedIds = BUNDLED_APP_MANIFESTS.map((b) => b.manifest.id).sort();
    const loaderIds = Object.keys(BUNDLED_APP_LOADERS).sort();
    expect(loaderIds).toEqual(seedIds);
  });

  it('every entry in the map is a function returning a Promise', () => {
    for (const [id, loader] of Object.entries(BUNDLED_APP_LOADERS)) {
      expect(typeof loader).toBe('function');
      // Don't await — Vite's actual `import()` call resolves a real
      // workspace package which we do not want to load in this unit
      // test. Just verify the call is callable and yields a thenable.
      const result = loader();
      expect(typeof (result as Promise<unknown>).then).toBe('function');
      // Swallow the promise so any rejection from the dummy call doesn't
      // surface as an unhandled rejection in the test runner.
      (result as Promise<unknown>).catch(() => undefined);
      void id;
    }
  });
});
