// ============================================================
// sounds — Sprint B Phase 7 system-sound API
// ============================================================
//
// Module-level state intentionally — `playSound` must be callable
// from anywhere (Toast effects, trash empty, file ops) without
// prop-drilling the OS state. React side syncs the mute toggle
// once via `setSoundEnabled` whenever `state.theme.soundEnabled`
// changes; everything else just calls `playSound(kind)`.
//
// Implementation: HTMLAudioElement, lazy-instantiated on first
// `playSound`. We `cloneNode` per trigger so two notifications
// in close succession don't cut each other off.

export type SoundKind =
  | "notification"
  | "error"
  | "empty-trash"
  | "screenshot";

const SOUND_PATHS: Readonly<Record<SoundKind, string>> = {
  notification: "/sounds/notification.wav",
  error: "/sounds/error.wav",
  "empty-trash": "/sounds/empty-trash.wav",
  screenshot: "/sounds/screenshot.wav",
};

let enabled = true;
const cache = new Map<SoundKind, HTMLAudioElement>();

/** React-side sync: call from a useEffect on `state.theme.soundEnabled`. */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

function getProto(kind: SoundKind): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  let a = cache.get(kind);
  if (!a) {
    a = new Audio(SOUND_PATHS[kind]);
    a.preload = "auto";
    cache.set(kind, a);
  }
  return a;
}

/**
 * Play a system sound. No-op when muted, when the asset is missing,
 * or when running in a non-DOM environment (tests, SSR).
 */
export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  const proto = getProto(kind);
  if (!proto) return;
  // Clone so retriggers in <duration overlap instead of cutting off.
  const node = proto.cloneNode(true) as HTMLAudioElement;
  node.volume = 0.6;
  // .play() returns a Promise that rejects on autoplay-block — swallow,
  // the worst case is silence.
  void node.play().catch(() => {});
}

/** Test helper. */
export function _resetSoundsForTest(): void {
  enabled = true;
  cache.clear();
}
