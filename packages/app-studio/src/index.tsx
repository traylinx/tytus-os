/**
 * @tytus/app-studio — Studio workspace package entry.
 *
 * Default export is the boot function the loader calls with AppBootEnv.
 * Returns a React component bound to this app's HostClient + AppDb +
 * createSession factory.
 *
 * Studio's M6.x scope adds:
 *   - ⌘K composition commands wired to `createSession({...})` (engine)
 *   - studio.* patch variants flowing through the TransactionRunner
 *   - Apply/Discard ghost preview overlays per staged patch
 *
 * Replaces the legacy in-tree TextEditor + RichEditor + AIWriter triad
 * (Notes already lifted to Memo in W4-C). Legacy apps stay in place
 * for the dual-source transition; the W6 cleanup PR removes them
 * once the loader-driven boot path verifies end-to-end.
 */

import { useEffect, useState } from 'react';
import type { AppBootEnv } from '@tytus/host-api';
import { Studio } from './Studio';

type MigrationState = { ready: boolean; error: string | null };

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export default function bootStudio(env: AppBootEnv) {
  const db = env.host.storage.current();
  // eslint-disable-next-line react-refresh/only-export-components
  return function StudioApp() {
    const [state, setState] = useState<MigrationState>({
      ready: false,
      error: null,
    });

    useEffect(() => {
      let alive = true;
      void db
        .migrate('migrations/')
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
      return <div role="alert">Studio failed to initialize: {state.error}</div>;
    }
    if (!state.ready) return <div>Preparing Studio…</div>;
    return (
      <Studio db={db} host={env.host} createSession={env.createSession} />
    );
  };
}
