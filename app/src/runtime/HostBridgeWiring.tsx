import { useEffect, useMemo, useRef } from 'react';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useWindows } from '@/hooks/useOSStore';
import { useI18n } from '@/i18n';
import { useShellMenuActions } from '@/hooks/useShellMenu';
import {
  setDaemonStateProvider,
  setWindowsActions,
  setI18nOverride,
  setShellMenuActions,
  type ShellPodDescriptor,
} from '@/runtime/host-impl';
import { revealSecret } from '@/lib/secrets';
import type {
  Pod,
  Agent,
  DaemonState,
  AnyWindowArgs,
  ShellMenuSpec,
  ShellMenuItem as HostShellMenuItem,
} from '@tytus/host-api';
import type {
  ShellMenuModel,
  ShellMenuGroup,
  ShellMenuItem as InTreeShellMenuItem,
} from '@/lib/shellMenu';

type DaemonStateListener = (state: DaemonState) => void;

const withV1Suffix = (url: string): string => {
  const trimmed = url.trim().replace(/\/+$/, '');
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

export function HostBridgeWiring() {
  const ds = useDaemonStateContext();
  const w = useWindows();
  const i18n = useI18n();

  const stateRef = useRef<DaemonState>({ agents: [], included: [] });
  const includedRef = useRef(ds.state?.included ?? []);
  const listenersRef = useRef<Set<DaemonStateListener>>(new Set());
  const i18nRef = useRef(i18n);
  const previousLanguageRef = useRef(i18n.language);
  const localeListenersRef = useRef<Set<(locale: string) => void>>(new Set());

  const projected: DaemonState = useMemo(() => {
    const includedRaw = ds.state?.included ?? [];
    const included: Pod[] = includedRaw.map((p) => {
      const userKey = revealSecret(p.user_key, 'user_gesture');
      return {
        id: p.pod_id,
        status: 'running',
        publicUrl: p.public_url,
        kind: p.kind,
        // Standalone apps get the host-api Pod shape, not the raw daemon
        // `included[]` shape. Expose the gateway material in `meta` for
        // apps that use OpenAI-compatible SDKs directly (API Tester,
        // JULI3TA), while `callPodEndpoint` remains the preferred host
        // proxy when an app can delegate the request.
        meta: {
          endpoint: p.endpoint,
          gatewayKey: userKey,
          gatewayUrl: withV1Suffix(p.public_url),
          privateUrl: p.endpoint,
          publicUrl: p.public_url,
          userKey,
        },
      };
    });
    const agents: Agent[] = (ds.state?.agents ?? []).map((a) => ({
      id: a.id || a.route_id || a.pod_id,
      kind: a.agent_type,
      status: a.status ?? 'unknown',
      meta: {
        podId: a.pod_id,
        routeId: a.route_id,
        agentIdentityId: a.agent_identity_id ?? null,
        displayName: a.display_name,
        displayLabel: a.display_label,
      },
    }));
    return {
      agents,
      included,
      daemon_version: ds.state?.daemon_version,
      daemon_started_at: ds.state?.daemon_started_at,
    };
  }, [
    ds.state?.included,
    ds.state?.agents,
    ds.state?.daemon_version,
    ds.state?.daemon_started_at,
  ]);

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
    const listeners = listenersRef.current;
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
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    });
    return () => {
      setDaemonStateProvider(null);
      listeners.clear();
    };
  }, []);

  useEffect(() => {
    i18nRef.current = i18n;
    if (previousLanguageRef.current === i18n.language) return;
    previousLanguageRef.current = i18n.language;
    for (const fn of [...localeListenersRef.current]) {
      try {
        fn(i18n.language);
      } catch {
        // listener faults must not break the bridge
      }
    }
  }, [i18n]);

  useEffect(() => {
    const localeListeners = localeListenersRef.current;
    setI18nOverride({
      get locale() {
        return i18nRef.current.language;
      },
      t: (key, vars) => i18nRef.current.t(key, vars),
      onLocaleChange: (fn) => {
        localeListeners.add(fn);
        return () => {
          localeListeners.delete(fn);
        };
      },
    });
    return () => {
      setI18nOverride(null);
      localeListeners.clear();
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

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function specToModel(spec: ShellMenuSpec): ShellMenuModel {
  const groups: ShellMenuGroup[] = spec.groups.map((g) => ({
    id: slug(g.label) || 'group',
    label: g.label,
    items: g.items.map(translateItem),
  }));
  return { appLabel: spec.appId, groups };
}

function translateItem(it: HostShellMenuItem): InTreeShellMenuItem {
  return {
    id: it.id,
    label: it.label,
    disabled: it.disabled,
    onSelect: it.onClick,
  };
}

/**
 * Wires `host.shellMenu.register(spec)` to the in-tree per-window
 * ShellMenuProvider context. Mounted INSIDE ShellMenuProvider in
 * App.tsx; HostBridgeWiring lives above it (closer to the providers
 * that own daemon state + windows) and can't reach the menu context
 * from there.
 *
 * Bridges per-app spec → per-window model by synthesizing a
 * windowId of `app:${spec.appId}`. Multiple windows per app aren't
 * yet differentiated; refine when the loader assigns real window
 * IDs to workspace-mounted apps.
 */
export function ShellMenuBridge() {
  const actions = useShellMenuActions();

  useEffect(() => {
    if (!actions) return;
    setShellMenuActions({
      registerForApp(spec) {
        const windowId = `app:${spec.appId}`;
        const model = specToModel(spec);
        actions.register(windowId, model);
        return () => actions.unregister(windowId);
      },
    });
    return () => {
      setShellMenuActions(null);
    };
  }, [actions]);

  return null;
}
