// Manifest AN8 — "Show demo apps" toggle.
//
// Apps marked `isDemo: true` in the registry (Games + ASCII Art +
// Matrix Rain) are gated behind this preference. Default OFF for paid
// users so the App Launcher and Dock surface only the apps with a
// real product role.
//
// Persisted in localStorage under `tytus_show_demo_apps`. The hook
// returns the current value + a setter that also persists.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "tytus_show_demo_apps";

const loadFromStorage = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "true";
  } catch {
    return false;
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

export const useDemoApps = (): UseDemoAppsResult => {
  const [showDemoApps, setShowDemoAppsState] = useState<boolean>(() =>
    loadFromStorage(),
  );

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
