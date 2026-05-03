import { useEffect, useMemo, useRef } from 'react';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useWindows } from '@/hooks/useOSStore';
import {
  setDaemonStateProvider,
  setWindowsActions,
  type ShellPodDescriptor,
} from '@/runtime/host-impl';
import { revealSecret } from '@/lib/secrets';
import type { Pod, Agent, DaemonState, AnyWindowArgs } from '@tytus/host-api';

type DaemonStateListener = (state: DaemonState) => void;

export function HostBridgeWiring() {
  const ds = useDaemonStateContext();
  const w = useWindows();

  const stateRef = useRef<DaemonState>({ agents: [], included: [] });
  const includedRef = useRef(ds.state?.included ?? []);
  const listenersRef = useRef<Set<DaemonStateListener>>(new Set());

  const projected: DaemonState = useMemo(() => {
    const includedRaw = ds.state?.included ?? [];
    const included: Pod[] = includedRaw.map((p) => ({
      id: p.pod_id,
      status: 'running',
      publicUrl: p.public_url,
      kind: p.kind,
    }));
    const agents: Agent[] = (ds.state?.agents ?? []).map((a) => ({
      id: a.pod_id,
      kind: a.agent_type,
      status: a.status ?? 'unknown',
    }));
    return { agents, included };
  }, [ds.state?.included, ds.state?.agents]);

  useEffect(() => {
    stateRef.current = projected;
    includedRef.current = ds.state?.included ?? [];
    for (const fn of [...listenersRef.current]) {
      try {
        fn(projected);
      } catch {
        // listener faults must not break the bridge
      }
    }
  }, [projected, ds.state?.included]);

  useEffect(() => {
    setDaemonStateProvider({
      getState: () => stateRef.current,
      getPod: (podId) => {
        const raw = includedRef.current.find((p) => p.pod_id === podId);
        if (!raw) return null;
        const descriptor: ShellPodDescriptor = {
          pod: {
            id: raw.pod_id,
            status: 'running',
            publicUrl: raw.public_url,
            kind: raw.kind,
          },
          bearer: revealSecret(raw.user_key, 'user_gesture'),
        };
        return descriptor;
      },
      subscribe: (fn) => {
        listenersRef.current.add(fn);
        return () => {
          listenersRef.current.delete(fn);
        };
      },
    });
    return () => {
      setDaemonStateProvider(null);
      listenersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setWindowsActions({
      open: (appId, args) => {
        w.openWindow(appId, undefined);
        void args;
        return appId;
      },
      openOrFocus: (appId: string, args?: AnyWindowArgs) => {
        w.openWindow(appId, undefined);
        void args;
        return appId;
      },
      close: (windowId) => {
        w.closeWindow(windowId);
      },
      addDesktopIcon: () => {
        // Desktop-icon registration ships with the dynamic-loader sprint.
      },
      current: (appId) => ({ id: appId, appId }),
    });
    return () => {
      setWindowsActions(null);
    };
  }, [w]);

  return null;
}
