/**
 * Adapter surface for in-tree apps that haven't moved to the workspace
 * loader yet. Today this is a thin wrapper around `useHost()` — the goal
 * is to give every in-tree app the same `host.*` surface a workspace
 * package gets, so future migrations only have to swap `useFileSystem`
 * for `useHost().fs` (etc.) without changing call shapes.
 *
 * No real adapter logic in M1 — the hooks-vs-host bridge gets filled in
 * milestone-by-milestone as each in-tree app migrates. For PR4 this file
 * exists to lock the import path so future PRs don't have to retrofit
 * it across every consumer.
 */

import type { HostClient } from '@tytus/host-api';
import { useHost } from '@/hooks/useHost';

/** In-tree-app facade. Returns the same HostClient `useHost()` returns,
 *  reserved here so future shims can layer adapter logic without the
 *  apps themselves changing import paths. */
export function useLegacyHost(): HostClient {
  return useHost();
}
