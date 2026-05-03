/**
 * @tytus/app-music-player — Music Player workspace package entry.
 *
 * The default export is the `bootMusicPlayer(env)` function the
 * loader invokes with `AppBootEnv`. Resolves the read-only handle to
 * Music Creator's tracks table once at boot (cheap, sync from
 * the host's surface) and threads it into the component as a prop —
 * the component itself does NOT call `useOS()` or otherwise reach
 * into shell internals.
 *
 * The cross-app share is gated by:
 *   - this app's manifest declaring `storage.shared.music_creator_tracks`
 *     in `permissions[]`
 *   - Music Creator's manifest declaring
 *     `storage.shares.music_creator_tracks → app_music_creator_tracks`
 *
 * If either side is missing the host throws a clear PermissionDeniedError;
 * we let it surface to the loader rather than swallow it, so install-time
 * misconfiguration is visible immediately.
 */

import type { AppBootEnv } from '@tytus/host-api';
import MusicPlayer from './MusicPlayer';

export default function bootMusicPlayer(env: AppBootEnv) {
  // Resolve the share at boot. This may legitimately return null if
  // Music Creator is not installed (e.g. user uninstalled it post-boot
  // — system apps are protected today, but the loader contract
  // acknowledges null). The component degrades to local-files-only.
  const sharedDb = env.host.storage.forSharedKey('music_creator_tracks');
  return function MusicPlayerApp() {
    return <MusicPlayer host={env.host} sharedDb={sharedDb} />;
  };
}
