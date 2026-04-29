// Manifest AN8 — "Show demo apps" toggle.
//
// Apps marked `isDemo: true` in the registry (Games + ASCII Art +
// Matrix Rain) are gated behind this preference. Default OFF for paid
// users so the App Launcher and Dock surface only the apps with a
// real product role; default ON for Explorer-tier where the demo
// surface is part of the value prop ("look at all this stuff!").
//
// Persisted in localStorage under `tytus_show_demo_apps`. When the
// localStorage key is absent (first launch), the default falls back
// to the tier passed in. Once the user explicitly toggles, that
// stored choice wins regardless of tier.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "tytus_show_demo_apps";

/** Tier-based default applied when the user has never toggled. */
const defaultForTier = (tier: string | null | undefined): boolean => {
  // Anything that isn't a known paid tier defaults to ON. We default
  // OFF for paid (creator/operator) so demo apps don't dilute the
  // workspace shell that a $79–$149/mo customer sees on day one.
  if (tier === "creator" || tier === "operator") return false;
  return true;
};

interface StorageRead {
  /** True when localStorage held an explicit choice. */
  explicit: boolean;
  value: boolean;
}

const loadFromStorage = (): StorageRead => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "true") return { explicit: true, value: true };
    if (raw === "false") return { explicit: true, value: false };
    return { explicit: false, value: false };
  } catch {
    return { explicit: false, value: false };
  }
};

const writeToStorage = (value: boolean): void => {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // best-effort — private mode / sandboxed contexts can throw
  }
};

export interface UseDemoAppsResult {
  showDemoApps: boolean;
  setShowDemoApps: (value: boolean) => void;
}

/**
 * @param tier — optional tier-aware default. When the user has never
 *   toggled, Explorer (and unknown tiers) default to ON; paid tiers
 *   default to OFF. Once the user toggles, the stored value wins.
 */
export const useDemoApps = (tier?: string | null): UseDemoAppsResult => {
  const [showDemoApps, setShowDemoAppsState] = useState<boolean>(() => {
    const r = loadFromStorage();
    return r.explicit ? r.value : defaultForTier(tier);
  });

  // Re-derive default when tier resolves AFTER first mount and the
  // user has never explicitly toggled. Real flow: hook mounts before
  // /api/state lands → tier=undefined → ON (assume Explorer). Then
  // state loads with tier=operator → flip to OFF, since they never
  // expressed a choice. This is a deliberate sync from an external
  // store (localStorage + tier prop) — not state derivation from
  // props, so the lint suppression is appropriate.
  useEffect(() => {
    const r = loadFromStorage();
    if (r.explicit) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setShowDemoAppsState(defaultForTier(tier));
  }, [tier]);

  // Sync across tabs / windows of the same origin so toggling in
  // Settings updates the AppLauncher already mounted in the shell.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setShowDemoAppsState(e.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Custom event for same-tab updates (StorageEvent doesn't fire on
  // the writing tab itself).
  useEffect(() => {
    const onLocal = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      if (typeof detail === "boolean") setShowDemoAppsState(detail);
    };
    window.addEventListener("tytus:demo-apps-changed", onLocal);
    return () => window.removeEventListener("tytus:demo-apps-changed", onLocal);
  }, []);

  const setShowDemoApps = useCallback((value: boolean) => {
    setShowDemoAppsState(value);
    writeToStorage(value);
    window.dispatchEvent(
      new CustomEvent("tytus:demo-apps-changed", { detail: value }),
    );
  }, []);

  return { showDemoApps, setShowDemoApps };
};
