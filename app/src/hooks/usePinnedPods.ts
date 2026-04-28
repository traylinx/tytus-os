// Pinned pods — persisted to localStorage. Cap is 8 per manifest §2.5.
// Phase 3b chunk 5 wires this to Fleet sort + tab strip; the desktop
// reserved-zone integration (manifest §2.5 full spec) waits on a
// Desktop component refactor to make room for it.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "tytus_pinned_pods";
export const PIN_CAP = 8;

const loadFromStorage = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
};

const writeToStorage = (pods: string[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pods));
  } catch {
    // best-effort — private mode / sandboxed contexts can throw
  }
};

export interface UsePinnedPodsResult {
  pinned: string[];
  has: (podId: string) => boolean;
  isFull: boolean;
  /** Returns false if the cap would be exceeded; true on success. */
  pin: (podId: string) => boolean;
  unpin: (podId: string) => void;
  toggle: (podId: string) => boolean;
}

export const usePinnedPods = (): UsePinnedPodsResult => {
  const [pinned, setPinned] = useState<string[]>(() => loadFromStorage());

  useEffect(() => {
    writeToStorage(pinned);
  }, [pinned]);

  const has = useCallback(
    (podId: string) => pinned.includes(podId),
    [pinned],
  );

  const pin = useCallback(
    (podId: string): boolean => {
      let allowed = true;
      setPinned((prev) => {
        if (prev.includes(podId)) return prev;
        if (prev.length >= PIN_CAP) {
          allowed = false;
          return prev;
        }
        return [...prev, podId];
      });
      return allowed;
    },
    [],
  );

  const unpin = useCallback((podId: string) => {
    setPinned((prev) => prev.filter((p) => p !== podId));
  }, []);

  const toggle = useCallback(
    (podId: string): boolean => {
      let didPin = false;
      setPinned((prev) => {
        if (prev.includes(podId)) {
          return prev.filter((p) => p !== podId);
        }
        if (prev.length >= PIN_CAP) {
          // Cap reached — don't pin, but the result-flag tells the
          // caller to surface a "limit reached" toast.
          didPin = false;
          return prev;
        }
        didPin = true;
        return [...prev, podId];
      });
      return didPin;
    },
    [],
  );

  return {
    pinned,
    has,
    isFull: pinned.length >= PIN_CAP,
    pin,
    unpin,
    toggle,
  };
};
