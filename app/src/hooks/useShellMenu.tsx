// ============================================================
// ShellMenuProvider — dynamic app-owned macOS-style menu hooks
// ============================================================

/* eslint-disable react-refresh/only-export-components */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ShellMenuModel } from '@/lib/shellMenu';

interface ShellMenuContextValue {
  menusByWindow: Record<string, ShellMenuModel>;
  register: (windowId: string, model: ShellMenuModel) => void;
  unregister: (windowId: string) => void;
}

const ShellMenuContext = createContext<ShellMenuContextValue | null>(null);

export const ShellMenuProvider = ({ children }: { children: ReactNode }) => {
  const [menusByWindow, setMenusByWindow] = useState<Record<string, ShellMenuModel>>({});

  const register = useCallback((windowId: string, model: ShellMenuModel) => {
    setMenusByWindow((prev) => ({ ...prev, [windowId]: model }));
  }, []);

  const unregister = useCallback((windowId: string) => {
    setMenusByWindow((prev) => {
      if (!(windowId in prev)) return prev;
      const next = { ...prev };
      delete next[windowId];
      return next;
    });
  }, []);

  const value = useMemo(() => ({ menusByWindow, register, unregister }), [menusByWindow, register, unregister]);

  return <ShellMenuContext.Provider value={value}>{children}</ShellMenuContext.Provider>;
};

export const useRegisteredShellMenu = (windowId: string | null | undefined): ShellMenuModel | null => {
  const ctx = useContext(ShellMenuContext);
  if (!ctx || !windowId) return null;
  return ctx.menusByWindow[windowId] ?? null;
};

/**
 * Imperative register/unregister handles for non-React callers
 * (HostBridgeWiring routes the per-app `host.shellMenu.register(spec)`
 * call through these). Returns null outside the provider.
 */
export const useShellMenuActions = () => {
  const ctx = useContext(ShellMenuContext);
  return ctx ? { register: ctx.register, unregister: ctx.unregister } : null;
};

/**
 * Future app seam: call from an app rendered inside WindowFrame to replace
 * the default registry menu with live, app-state-aware menu groups.
 */
export const useShellMenuRegistration = (
  windowId: string | null | undefined,
  model: ShellMenuModel | null | undefined,
) => {
  const ctx = useContext(ShellMenuContext);
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  useEffect(() => {
    if (!register || !unregister || !windowId || !model) return;
    register(windowId, model);
    return () => unregister(windowId);
  }, [register, unregister, windowId, model]);
};
