/**
 * `useHost()` — React hook for IN-TREE consumers (FileManager, Settings,
 * Launcher, legacy in-tree apps). Workspace-package apps receive
 * `AppBootEnv` via their default export and never call this hook.
 *
 * The Provider builds one HostClient bound to the synthetic shell appId.
 * In M3+ this gets refined so each in-tree app's React subtree sees a
 * HostClient bound to its own appId; today the shell-level binding is
 * sufficient because in-tree apps still use the older hook-based APIs
 * (useFileSystem, useDaemonStateContext) directly.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { HostClient, Manifest } from '@tytus/host-api';

import { makeHostForApp } from '@/runtime/host-impl';

const HostContext = createContext<HostClient | null>(null);

const SHELL_APP_ID = '__shell__';

const SHELL_MANIFEST: Manifest = {
  id: SHELL_APP_ID,
  name: 'Tytus OS',
  version: '0.0.0',
  icon: 'Box',
  category: 'System',
  description: 'Tytus OS shell — synthetic manifest for in-tree consumers.',
  window: {
    defaultSize: { width: 1, height: 1 },
    minSize: { width: 1, height: 1 },
  },
  permissions: [],
  entry: { module: '' },
};

const SHELL_ENTRY_URLS = {
  module: '',
  assets: '/',
  css: null,
};

interface ProviderProps {
  children: ReactNode;
  /** Test-only: inject a HostClient instead of constructing one. Production
   *  callers always omit this. */
  client?: HostClient;
}

export const HostProvider = ({ children, client }: ProviderProps) => {
  const value = useMemo(() => {
    return (
      client ??
      makeHostForApp(SHELL_APP_ID, SHELL_MANIFEST, SHELL_ENTRY_URLS)
    );
  }, [client]);
  return (
    <HostContext.Provider value={value}>{children}</HostContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useHost(): HostClient {
  const v = useContext(HostContext);
  if (!v) {
    throw new Error(
      'useHost() called outside <HostProvider>. Wrap your tree in <HostProvider> at the shell root.',
    );
  }
  return v;
}
