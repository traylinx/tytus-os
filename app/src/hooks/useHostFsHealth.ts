import { useSyncExternalStore } from 'react';
import {
  getHostFsHealth,
  type HostFsHealth,
  type HostFsHealthSnapshot,
} from '@/runtime/host-fs-health';

/**
 * Subscribe to the host.fs health module's snapshot. The module is the
 * single source of truth — this hook is a thin React adapter via
 * `useSyncExternalStore` so re-renders coalesce on snapshot identity.
 *
 * The default `health` argument is the process-wide singleton wired by
 * `host-impl.makeFsApi()`. Tests can inject their own instance.
 */
export function useHostFsHealth(
  health: HostFsHealth = getHostFsHealth(),
): HostFsHealthSnapshot {
  return useSyncExternalStore(
    (listener) => health.subscribe(() => listener()),
    () => health.getSnapshot(),
    () => health.getSnapshot(),
  );
}
