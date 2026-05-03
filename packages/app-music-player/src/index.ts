/**
 * @tytus/app-music-player — Music Player workspace package entry.
 * Skeleton in M3 PR-M3.4; the existing in-tree MusicPlayer.tsx
 * (~1,500 LOC) lifts in PR-M3.5+.
 */

import type { AppBootEnv } from '@tytus/host-api';

export default function bootMusicPlayer(env: AppBootEnv) {
  void env;
  // eslint-disable-next-line react-refresh/only-export-components
  return function MusicPlayerPlaceholder() {
    return {
      __tytus_placeholder: true,
      message:
        'Music Player extraction in progress (M3 PR-M3.5+).',
    };
  };
}
