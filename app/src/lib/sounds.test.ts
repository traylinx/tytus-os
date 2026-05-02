import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSoundsForTest,
  isSoundEnabled,
  playSound,
  setSoundEnabled,
} from "./sounds";

beforeEach(() => _resetSoundsForTest());
afterEach(() => _resetSoundsForTest());

describe("sounds", () => {
  it("is enabled by default", () => {
    expect(isSoundEnabled()).toBe(true);
  });

  it("setSoundEnabled toggles", () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it("playSound when muted does not invoke Audio.play", () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    class FakeAudio {
      preload = "";
      cloneNode() {
        return { volume: 0, play: playSpy } as unknown as HTMLAudioElement;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    setSoundEnabled(false);
    playSound("notification");
    expect(playSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("playSound when enabled clones + plays", () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    const cloned: { volume: number; play: typeof playSpy } = { volume: 0, play: playSpy };
    class FakeAudio {
      preload = "";
      cloneNode() {
        return cloned as unknown as HTMLAudioElement;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    playSound("notification");
    expect(playSpy).toHaveBeenCalledOnce();
    expect(cloned.volume).toBeCloseTo(0.6);

    vi.unstubAllGlobals();
  });

  it("playSound swallows play() rejection (autoplay block)", async () => {
    const playSpy = vi.fn().mockRejectedValue(new Error("autoplay blocked"));
    class FakeAudio {
      preload = "";
      cloneNode() {
        return { volume: 0, play: playSpy } as unknown as HTMLAudioElement;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    expect(() => playSound("notification")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(playSpy).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("each kind maps to a distinct asset", () => {
    const constructed: string[] = [];
    class FakeAudio {
      preload = "";
      constructor(src?: string) {
        if (src) constructed.push(src);
      }
      cloneNode() {
        return { volume: 0, play: () => Promise.resolve() } as unknown as HTMLAudioElement;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    playSound("notification");
    playSound("error");
    playSound("empty-trash");
    playSound("screenshot");

    expect(new Set(constructed).size).toBe(4);
    expect(constructed).toContain("/sounds/notification.wav");
    expect(constructed).toContain("/sounds/error.wav");
    expect(constructed).toContain("/sounds/empty-trash.wav");
    expect(constructed).toContain("/sounds/screenshot.wav");

    vi.unstubAllGlobals();
  });

  it("subsequent playSound for same kind reuses prototype (one Audio() ctor call per kind)", () => {
    const ctorSpy = vi.fn();
    class FakeAudio {
      preload = "";
      constructor(src?: string) {
        ctorSpy(src);
      }
      cloneNode() {
        return { volume: 0, play: () => Promise.resolve() } as unknown as HTMLAudioElement;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    playSound("notification");
    playSound("notification");
    playSound("notification");
    expect(ctorSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
