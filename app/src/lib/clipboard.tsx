// ============================================================
// Internal file clipboard — Sprint A Phase 4.6
// ============================================================
//
// In-OS only. The host clipboard work (Phase 5.4 in Sprint B) is a
// different module that goes through the navigator.clipboard API
// with permission UX. This module owns the *internal* clipboard
// state used by Cmd+C / Cmd+X / Cmd+V on FileRef[].
//
// Mode semantics:
//   • copy — paste produces independent duplicates (or shortcuts
//     across backends per the cross-backend matrix from Phase 3).
//   • cut  — source items render at 40% opacity until paste (move)
//     or Esc (cancel cut).
//
// State is exposed as a Provider so consumers (Desktop, FileManager,
// TrashManager) read the same buffer. Mutations are async-safe — the
// Provider state is just `{ refs, mode } | null`.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FileRef } from "@/lib/files/fileRef";

export type ClipboardMode = "copy" | "cut";

export interface ClipboardState {
  refs: FileRef[];
  mode: ClipboardMode;
}

export interface ClipboardAPI {
  state: ClipboardState | null;
  copy: (refs: readonly FileRef[]) => void;
  cut: (refs: readonly FileRef[]) => void;
  /** Returns the buffer content. Caller is responsible for clearing
   *  the cut state on a successful paste. */
  paste: () => ClipboardState | null;
  clear: () => void;
  /** Whether the buffer is non-empty. Drives Paste menu enable. */
  hasContent: boolean;
  /** True iff this ref is part of the current cut buffer (drives the
   *  ghosted source rendering). */
  isCut: (ref: FileRef) => boolean;
}

const ClipboardContext = createContext<ClipboardAPI | null>(null);

export function ClipboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ClipboardState | null>(null);

  const copy = useCallback((refs: readonly FileRef[]) => {
    if (refs.length === 0) {
      setState(null);
      return;
    }
    setState({ refs: [...refs], mode: "copy" });
  }, []);

  const cut = useCallback((refs: readonly FileRef[]) => {
    if (refs.length === 0) {
      setState(null);
      return;
    }
    setState({ refs: [...refs], mode: "cut" });
  }, []);

  const paste = useCallback((): ClipboardState | null => {
    return state;
  }, [state]);

  const clear = useCallback(() => setState(null), []);

  const isCut = useCallback(
    (ref: FileRef) => {
      if (!state || state.mode !== "cut") return false;
      return state.refs.some((r) => sameRef(r, ref));
    },
    [state],
  );

  const value = useMemo<ClipboardAPI>(
    () => ({
      state,
      copy,
      cut,
      paste,
      clear,
      hasContent: !!state && state.refs.length > 0,
      isCut,
    }),
    [state, copy, cut, paste, clear, isCut],
  );

  return (
    <ClipboardContext.Provider value={value}>
      {children}
    </ClipboardContext.Provider>
  );
}

export function useClipboard(): ClipboardAPI {
  const ctx = useContext(ClipboardContext);
  if (!ctx) throw new Error("useClipboard must be used inside ClipboardProvider");
  return ctx;
}

/** Standalone helper for non-React callers (tests, fileOps). */
export function sameRef(a: FileRef, b: FileRef): boolean {
  if (a.source !== b.source) return false;
  if (a.source === "vfs" && b.source === "vfs") {
    return a.nodeId === b.nodeId;
  }
  if (a.source === "daemon" && b.source === "daemon") {
    return (
      a.daemonSource === b.daemonSource &&
      a.path === b.path &&
      (a.binding ?? -1) === (b.binding ?? -1) &&
      (a.pod ?? "") === (b.pod ?? "")
    );
  }
  return false;
}
