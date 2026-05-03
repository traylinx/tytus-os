/**
 * @tytus/app-voice-recorder — Voice Recorder workspace package entry.
 *
 * Default export is the boot function the loader calls with AppBootEnv.
 * Returns a React component bound to this app's HostClient + AppDb.
 *
 * Migrated from the placeholder boot in W3 of the apps-platform sprint.
 * The legacy in-tree app at app/src/apps/VoiceRecorder.tsx stays in
 * place for the dual-source transition; a follow-up cleanup PR removes
 * it once the loader-driven boot path verifies end-to-end.
 */

import type { AppBootEnv } from '@tytus/host-api';
import { VoiceRecorder } from './VoiceRecorder';
import { tryImportLegacyRows } from './repo/voiceRecordings';

export default function bootVoiceRecorder(env: AppBootEnv) {
  const db = env.host.storage.current();
  // One-shot legacy import (no-op when no legacy rows exist). Fire-and-
  // forget so first paint is not blocked.
  void tryImportLegacyRows(db);
  // eslint-disable-next-line react-refresh/only-export-components
  return function VoiceRecorderApp() {
    return <VoiceRecorder db={db} host={env.host} />;
  };
}
