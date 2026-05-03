/**
 * @tytus/app-voice-recorder — Voice Recorder workspace package entry.
 * Skeleton in M3 PR-M3.4; the existing in-tree VoiceRecorder.tsx
 * (~800 LOC) lifts in PR-M3.5+. The placeholder keeps the loader
 * surface live so end-to-end mount + manifest + cross-app share
 * declarations validate today.
 */

import type { AppBootEnv } from '@tytus/host-api';

export default function bootVoiceRecorder(env: AppBootEnv) {
  void env;
  // eslint-disable-next-line react-refresh/only-export-components
  return function VoiceRecorderPlaceholder() {
    return {
      __tytus_placeholder: true,
      message:
        'Voice Recorder extraction in progress (M3 PR-M3.5+).',
    };
  };
}
