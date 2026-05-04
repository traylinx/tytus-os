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

import { useEffect, useState } from 'react';
import type { AppBootEnv } from '@tytus/host-api';
import { VoiceRecorder } from './VoiceRecorder';
import { tryImportLegacyRows } from './repo/voiceRecordings';

type MigrationState = { ready: boolean; error: string | null };

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export default function bootVoiceRecorder(env: AppBootEnv) {
  const db = env.host.storage.current();
  // eslint-disable-next-line react-refresh/only-export-components
  return function VoiceRecorderApp() {
    const [state, setState] = useState<MigrationState>({
      ready: false,
      error: null,
    });

    useEffect(() => {
      let alive = true;
      void db
        .migrate('migrations/')
        .then(() => tryImportLegacyRows(db))
        .then(() => {
          if (alive) setState({ ready: true, error: null });
        })
        .catch((err: unknown) => {
          if (alive) setState({ ready: false, error: errorMessage(err) });
        });
      return () => {
        alive = false;
      };
    }, []);

    if (state.error) {
      return <div role="alert">Voice Recorder failed to initialize: {state.error}</div>;
    }
    if (!state.ready) return <div>Preparing Voice Recorder…</div>;
    return <VoiceRecorder db={db} host={env.host} />;
  };
}
