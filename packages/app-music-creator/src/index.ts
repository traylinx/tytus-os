/**
 * @tytus/app-music-creator — Music Creator (JULI3TA) workspace
 * package entry. Default export is the boot function the loader
 * calls with AppBootEnv.
 *
 * M3 PR-M3.4 ships the package skeleton + manifest + migrations.
 * The actual UI extraction (3,742 LOC from the in-tree
 * MusicCreator.tsx, plus its hooks + repo + audio pipeline) lands
 * across PR-M3.5+ as a multi-PR effort.
 *
 * The skeleton boot returns a placeholder component so the loader
 * path is exercisable end-to-end before the full surgery is done.
 * Tests + dev mode load this and see "Extraction in progress" until
 * the real bootMusicCreator lands.
 */

import type { AppBootEnv } from '@tytus/host-api';

export default function bootMusicCreator(env: AppBootEnv) {
  // Return a thunk so the loader's `mod.default(env)` call site sees
  // the same shape as a real React component factory. Real impl ships
  // the Music Creator UI; this stub keeps the contract live.
  void env;
  // eslint-disable-next-line react-refresh/only-export-components
  return function MusicCreatorPlaceholder() {
    // We don't import React types here to keep the package framework-
    // agnostic at the type level (the engine's no-React rule + the
    // tooling around export-default factories). The shell wraps the
    // returned value via React.createElement at mount time.
    return {
      __tytus_placeholder: true,
      message:
        'Music Creator extraction in progress (M3 PR-M3.5+). The package + manifest + migrations are landed; the UI lifts in subsequent sub-PRs.',
    };
  };
}
