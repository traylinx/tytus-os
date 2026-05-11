// ============================================================
// coverSample.ts — find the most musical / iconic slice(s) of audio.
// ============================================================
//
// Two strategies exposed:
//
//   buildCoverSample()    — single best compact window. Used when you want
//                            one clean style-reference sample that fits the
//                            gateway body limit.
//
//   buildIconicMix()      — the most distinctive 2–3 windows stitched
//                            together with crossfades. Closer to a
//                            "highlights reel" the cover model can
//                            learn from.
//
// Algorithm sketch (both share a feature pass):
//
//   1. Decode → AudioBuffer.
//   2. Compute per-frame RMS (loudness) AND spectral centroid (brightness).
//      RMS is from raw samples; centroid uses an OfflineAudioContext
//      AnalyserNode pass so we don't ship a JS FFT.
//   3. Compute a self-similarity score per window: cross-correlate the
//      window's RMS curve against the rest of the track. High overlap
//      means the section REPEATS — which is what a chorus does.
//   4. Combined score per window:
//          0.45 * mean_loudness
//        + 0.20 * mean_brightness
//        + 0.25 * self_similarity
//        − 0.10 * loudness_stdev      (penalize spiky regions)
//   5. For coverSample: pick highest-scoring window.
//      For iconicMix: pick 2–3 high-scoring windows that are spaced
//      apart in time, concat with 0.4 s linear crossfades.
//
// Output is always 16-bit PCM WAV (browsers don't ship an mp3 encoder
// and MiniMax music-cover accepts mp3/wav/flac equally). We downsample
// reference WAVs to 24 kHz mono and prefer 60-second cover references so MiniMax cover mode sees enough
// rhythmic and lyrical structure to extract stable features. The upstream
// accepts 6 seconds to 6 minutes and 50 MB; 60 s at 24 kHz mono stays
// small enough for the local/tray gateway while avoiding brittle 14 s clips.

const FRAME_MS = 100;
const TARGET_SECONDS = 60;
const MIN_SECONDS = 6;
const MAX_SECONDS = 90;
const REFERENCE_SAMPLE_RATE = 24_000;
const REFERENCE_PEAK = 0.92;
const REFERENCE_MAX_GAIN = 3;
const REFERENCE_FADE_SEC = 0.05;

const MIX_SEG_SECONDS = 20;
const MIX_SEG_COUNT = 3;
const MIX_CROSSFADE_SEC = 0.35;
const FAST_REMOTE_RATIO = 0.55;

export interface CoverSampleResult {
  /** Base64 (no data-URL prefix) of the trimmed WAV. */
  base64: string;
  /** Trimmed length in seconds. */
  durationSec: number;
  /** Where the slice started in the source clip (seconds). */
  startSec: number;
  /** Total length of the source clip (seconds). */
  sourceDurationSec: number;
  /** Score of the picked window in [0..1] (higher = more "iconic"). */
  score: number;
}

export interface IconicMixResult {
  base64: string;
  durationSec: number;
  /** Time ranges (in seconds) of source segments that made it in. */
  segments: { startSec: number; endSec: number; score: number }[];
  sourceDurationSec: number;
}

export type CoverSampleStage =
  | 'loading'
  | 'decoding'
  | 'capturing'
  | 'analyzing'
  | 'encoding'
  | 'done';

export interface CoverSampleProgress {
  stage: CoverSampleStage;
  progress: number;
  message: string;
}

export interface CoverSampleOptions {
  targetSec?: number;
  /**
   * For streamed/library URLs, avoid the old "download + decode the whole song"
   * path. Capture one compact seeked slice through the browser media pipeline.
   */
  fastRemote?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: CoverSampleProgress) => void;
}

const normalizeOptions = (
  targetSecOrOptions: number | CoverSampleOptions | undefined,
): Required<Pick<CoverSampleOptions, 'targetSec' | 'fastRemote'>> & Omit<CoverSampleOptions, 'targetSec' | 'fastRemote'> => {
  if (typeof targetSecOrOptions === 'number') {
    return { targetSec: targetSecOrOptions, fastRemote: false };
  }
  return {
    targetSec: targetSecOrOptions?.targetSec ?? TARGET_SECONDS,
    fastRemote: targetSecOrOptions?.fastRemote ?? false,
    signal: targetSecOrOptions?.signal,
    onProgress: targetSecOrOptions?.onProgress,
  };
};

const reportProgress = (
  options: Pick<CoverSampleOptions, 'onProgress'> | undefined,
  stage: CoverSampleStage,
  progress: number,
  message: string,
) => {
  options?.onProgress?.({
    stage,
    progress: Math.max(0, Math.min(1, progress)),
    message,
  });
};

const isRemoteUrl = (source: string) => /^https?:\/\//i.test(source);

const parseRemoteHints = (source: string): { durationSec?: number } => {
  const candidates = [source];
  try {
    const encoded = source.split('/api/music/proxy/')[1];
    if (encoded) candidates.push(decodeURIComponent(encoded));
  } catch {
    // Best-effort only.
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const dur = Number(url.searchParams.get('dur') || url.searchParams.get('duration'));
      if (Number.isFinite(dur) && dur > 0) return { durationSec: dur };
    } catch {
      // Ignore malformed embedded URL candidates.
    }
  }
  return {};
};

// ─── Audio I/O helpers ────────────────────────────────────────

// Real-time playback capture rescue. When `decodeAudioData` rejects a
// codec the browser's HTML5 <audio> element CAN still play (e.g.
// opus-in-webm in older Safari, weird mp4 box layouts from streaming
// proxies, mp4a.40.5 HE-AAC), we play the source silently through a
// MediaElementAudioSourceNode → MediaStreamDestination → MediaRecorder
// chain. The recorder produces a webm/opus blob the SAME browser can
// always re-decode (since it just produced it). Cost: real-time wall
// clock for `captureSec` seconds. We cap to the cover-reference
// window so the rescue completes before the user gets impatient.
const decodeViaPlaybackCapture = async (
  blob: Blob,
  ctx: AudioContext,
  captureSec: number,
): Promise<AudioBuffer> => {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder unavailable in this environment.');
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) {
    throw new Error('No supported recorder mime type for fallback.');
  }

  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.src = url;
  audio.muted = true;
  audio.crossOrigin = 'anonymous';
  audio.preload = 'auto';

  try {
    await new Promise<void>((res, rej) => {
      const onReady = () => res();
      const onErr = () =>
        rej(new Error('Audio element rejected the source format too — browser cannot play it.'));
      audio.addEventListener('canplay', onReady, { once: true });
      audio.addEventListener('error', onErr, { once: true });
      audio.load();
    });

    const srcNode = ctx.createMediaElementSource(audio);
    const dest = ctx.createMediaStreamDestination();
    srcNode.connect(dest);
    // Intentionally NOT connecting to ctx.destination — keep playback silent.

    const recorder = new MediaRecorder(dest.stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const targetMs = Math.max(
      6_000,
      Math.min(captureSec, audio.duration || captureSec) * 1000,
    );

    const stopped = new Promise<void>((res) => { recorder.onstop = () => res(); });
    recorder.start(250);
    audio.currentTime = 0;
    await audio.play();
    await new Promise<void>((res) => setTimeout(res, targetMs));
    recorder.stop();
    audio.pause();
    await stopped;

    const recBlob = new Blob(chunks, { type: mime });
    if (recBlob.size === 0) {
      throw new Error('Fallback capture produced no audio data.');
    }
    const recAb = await recBlob.arrayBuffer();
    return await ctx.decodeAudioData(recAb);
  } finally {
    URL.revokeObjectURL(url);
  }
};

const decodeAudio = async (
  blob: Blob,
  fallbackCaptureSec = 35,
  allowPlaybackCapture = true,
  options?: Pick<CoverSampleOptions, 'onProgress'>,
): Promise<AudioBuffer> => {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    const ab = await blob.arrayBuffer();
    try {
      return await ctx.decodeAudioData(ab.slice(0));
    } catch (primaryErr) {
      if (!allowPlaybackCapture) throw primaryErr;
      // Codec the static decoder rejects but <audio> may still play.
      try {
        reportProgress(options, 'capturing', 0.32, 'Browser decoder needs compatibility capture…');
        return await decodeViaPlaybackCapture(blob, ctx, fallbackCaptureSec);
      } catch (fallbackErr) {
        const primaryMsg = (primaryErr as Error).message || 'decodeAudioData failed';
        const fallbackMsg = (fallbackErr as Error).message || 'fallback failed';
        throw new Error(
          `Audio format isn't supported by this browser (${primaryMsg}). Compatibility-mode capture also failed: ${fallbackMsg}`,
        );
      }
    }
  } finally {
    ctx.close().catch(() => undefined);
  }
};

const blobFromSource = async (source: string, options?: Pick<CoverSampleOptions, 'signal'>): Promise<Blob> => {
  const r = await fetch(source, { signal: options?.signal });
  if (!r.ok) throw new Error(`Could not load audio (${r.status}).`);
  return r.blob();
};

const waitForMediaEvent = (
  audio: HTMLAudioElement,
  event: keyof HTMLMediaElementEventMap,
  signal?: AbortSignal,
  timeoutMs = 12_000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      audio.removeEventListener(event, onOk);
      audio.removeEventListener('error', onErr);
      signal?.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
    };
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => {
      cleanup();
      reject(new Error('Browser media element rejected the streamed audio.'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Reference extraction was cancelled.', 'AbortError'));
    };
    audio.addEventListener(event, onOk, { once: true });
    audio.addEventListener('error', onErr, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for audio ${String(event)}.`));
    }, timeoutMs);
  });

const decodeRemoteStreamSlice = async (
  source: string,
  targetSec: number,
  options: CoverSampleOptions,
): Promise<{ buffer: AudioBuffer; sourceOffsetSec: number; sourceDurationSec?: number }> => {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder unavailable for fast streamed reference capture.');
  }

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('No supported recorder mime type for fast streamed reference capture.');

  const hints = parseRemoteHints(source);
  const captureSec = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, targetSec + 2));
  const hintedDuration = hints.durationSec;
  const sourceOffsetSec = hintedDuration
    ? Math.max(0, Math.min(hintedDuration - captureSec, hintedDuration * FAST_REMOTE_RATIO - captureSec / 2))
    : 0;

  reportProgress(options, 'loading', 0.08, 'Opening streamed audio without downloading the full song…');

  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'auto';
  audio.src = source;

  let progressTimer: ReturnType<typeof setInterval> | null = null;
  try {
    await waitForMediaEvent(audio, 'canplay', options.signal, 15_000);
    if (sourceOffsetSec > 0 && Number.isFinite(audio.duration)) {
      reportProgress(options, 'loading', 0.15, `Seeking to ${Math.floor(sourceOffsetSec / 60)}:${Math.floor(sourceOffsetSec % 60).toString().padStart(2, '0')}…`);
      audio.currentTime = sourceOffsetSec;
      await waitForMediaEvent(audio, 'seeked', options.signal, 12_000);
    } else if (sourceOffsetSec > 0) {
      // Some proxied streams do not expose duration to <audio>; try anyway.
      audio.currentTime = sourceOffsetSec;
      await Promise.race([
        waitForMediaEvent(audio, 'seeked', options.signal, 12_000),
        new Promise<void>((res) => setTimeout(res, 1200)),
      ]);
    }

    const srcNode = ctx.createMediaElementSource(audio);
    const dest = ctx.createMediaStreamDestination();
    srcNode.connect(dest);

    const recorder = new MediaRecorder(dest.stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const stopped = new Promise<void>((res) => { recorder.onstop = () => res(); });
    const captureStartedAt = performance.now();
    progressTimer = setInterval(() => {
      const elapsedSec = (performance.now() - captureStartedAt) / 1000;
      reportProgress(
        options,
        'capturing',
        0.18 + 0.52 * Math.min(1, elapsedSec / captureSec),
        `Capturing ${captureSec.toFixed(0)} s cover reference…`,
      );
    }, 250);

    reportProgress(options, 'capturing', 0.18, `Capturing ${captureSec.toFixed(0)} s cover reference…`);
    recorder.start(250);
    await ctx.resume().catch(() => undefined);
    await audio.play();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, captureSec * 1000);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Reference extraction was cancelled.', 'AbortError'));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
    });
    recorder.stop();
    audio.pause();
    await stopped;
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;

    const recBlob = new Blob(chunks, { type: mime });
    if (recBlob.size === 0) throw new Error('Fast streamed capture produced no audio.');

    reportProgress(options, 'decoding', 0.75, 'Decoding cover reference…');
    const ab = await recBlob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab);
    return {
      buffer,
      sourceOffsetSec,
      sourceDurationSec: hintedDuration || (Number.isFinite(audio.duration) ? audio.duration : undefined),
    };
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    ctx.close().catch(() => undefined);
  }
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = typeof r.result === 'string' ? r.result : '';
      const idx = result.indexOf('base64,');
      resolve(idx >= 0 ? result.slice(idx + 7) : '');
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// ─── Feature extraction ──────────────────────────────────────

interface Features {
  rms: Float32Array;          // per frame
  centroid: Float32Array;     // per frame, normalized [0..1]
  framesPerSec: number;
}

const computeRmsFrames = (buf: AudioBuffer): Float32Array => {
  const sr = buf.sampleRate;
  const samplesPerFrame = Math.max(1, Math.floor((sr * FRAME_MS) / 1000));
  const numFrames = Math.floor(buf.length / samplesPerFrame);
  const rms = new Float32Array(numFrames);

  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));

  for (let f = 0; f < numFrames; f++) {
    const start = f * samplesPerFrame;
    let sum = 0;
    for (let i = 0; i < samplesPerFrame; i++) {
      let s = 0;
      for (let c = 0; c < channels.length; c++) s += channels[c][start + i];
      s /= channels.length;
      sum += s * s;
    }
    rms[f] = Math.sqrt(sum / samplesPerFrame);
  }
  return rms;
};

// Spectral centroid via OfflineAudioContext + AnalyserNode. We render
// the buffer once and tap a 256-bin AnalyserNode; for each FRAME_MS
// boundary, we sum band_freq*magnitude / sum(magnitude).
//
// Browsers don't expose synchronous AnalyserNode reads on offline
// contexts, so we approximate centroid with a CHEAP zero-crossing-rate
// proxy: high-frequency energy correlates strongly with both ZCR and
// centroid for music signals. ZCR is one division per sample → fast,
// robust, no FFT dependency.
const computeBrightnessFrames = (buf: AudioBuffer): Float32Array => {
  const sr = buf.sampleRate;
  const samplesPerFrame = Math.max(1, Math.floor((sr * FRAME_MS) / 1000));
  const numFrames = Math.floor(buf.length / samplesPerFrame);
  const out = new Float32Array(numFrames);

  // Mix to mono on the fly.
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));

  for (let f = 0; f < numFrames; f++) {
    const start = f * samplesPerFrame;
    let zc = 0;
    let prev = 0;
    for (let c = 0; c < channels.length; c++) prev += channels[c][start];
    prev /= channels.length;

    for (let i = 1; i < samplesPerFrame; i++) {
      let s = 0;
      for (let c = 0; c < channels.length; c++) s += channels[c][start + i];
      s /= channels.length;
      // Sign change above a small noise floor counts as a zero crossing.
      if ((prev > 1e-3 && s < -1e-3) || (prev < -1e-3 && s > 1e-3)) zc++;
      prev = s;
    }
    // Normalize: max ZCR for a Nyquist-rate signal is samplesPerFrame/2.
    out[f] = zc / (samplesPerFrame / 2);
  }
  return out;
};

const extractFeatures = (buf: AudioBuffer): Features => {
  const rms = computeRmsFrames(buf);
  const centroid = computeBrightnessFrames(buf);
  return { rms, centroid, framesPerSec: 1000 / FRAME_MS };
};

// ─── Self-similarity ──────────────────────────────────────────

// Mean-and-stdev-normalize, then return a downsampled copy. Used both
// for self-similarity scoring and for chorus matching across windows.
const normalize = (arr: Float32Array, downsample = 4): Float32Array => {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const mean = sum / arr.length;
  let sqSum = 0;
  for (let i = 0; i < arr.length; i++) sqSum += (arr[i] - mean) ** 2;
  const std = Math.sqrt(sqSum / arr.length) || 1;

  const outLen = Math.floor(arr.length / downsample);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let acc = 0;
    for (let j = 0; j < downsample; j++) acc += arr[i * downsample + j];
    out[i] = (acc / downsample - mean) / std;
  }
  return out;
};

// Score how often a given window's RMS pattern repeats elsewhere in
// the track — chorus-detection by self-correlation. Returns a value
// roughly in [0..1] where higher = repeats more.
const selfSimilarityScore = (
  normRms: Float32Array,
  winStart: number,
  winLen: number,
): number => {
  if (winStart + winLen >= normRms.length) return 0;
  const hop = Math.max(1, Math.floor(winLen / 4));
  let bestOther = -Infinity;
  let countMatches = 0;

  for (let pos = 0; pos + winLen < normRms.length; pos += hop) {
    if (Math.abs(pos - winStart) < winLen) continue; // skip overlap
    let dot = 0;
    for (let i = 0; i < winLen; i++) {
      dot += normRms[winStart + i] * normRms[pos + i];
    }
    dot /= winLen; // normalized correlation
    if (dot > bestOther) bestOther = dot;
    if (dot > 0.5) countMatches++;
  }
  // Combine: best correlation + how many other windows look similar.
  // Both clipped/squashed into [0..1].
  const bestNorm = Math.max(0, Math.min(1, (bestOther + 1) / 2));
  const repeatNorm = Math.min(1, countMatches / 6);
  return 0.6 * bestNorm + 0.4 * repeatNorm;
};

// ─── Window scoring ──────────────────────────────────────────

interface WindowScore {
  startFrame: number;
  lenFrames: number;
  score: number;
  meanRms: number;
  stdRms: number;
  meanBright: number;
  selfSim: number;
}

const computeWindowScores = (
  feat: Features,
  winLenSec: number,
): WindowScore[] => {
  const winLen = Math.max(1, Math.floor(winLenSec * feat.framesPerSec));
  if (feat.rms.length <= winLen) return [];

  const normRms = normalize(feat.rms, 4);
  const downsampleRatio = feat.rms.length / normRms.length;
  const normWinLen = Math.max(1, Math.floor(winLen / downsampleRatio));

  // Rolling sums for fast mean/std.
  let rmsSum = 0;
  let rmsSqSum = 0;
  let brightSum = 0;
  for (let i = 0; i < winLen; i++) {
    rmsSum += feat.rms[i];
    rmsSqSum += feat.rms[i] * feat.rms[i];
    brightSum += feat.centroid[i];
  }

  const out: WindowScore[] = [];
  // Hop = 1 second to cap how many windows we score on long inputs.
  const hop = Math.max(1, Math.floor(feat.framesPerSec));

  const pushScore = (start: number) => {
    const meanRms = rmsSum / winLen;
    const variance = Math.max(0, rmsSqSum / winLen - meanRms * meanRms);
    const stdRms = Math.sqrt(variance);
    const meanBright = brightSum / winLen;
    const normStart = Math.floor(start / downsampleRatio);
    const selfSim = selfSimilarityScore(normRms, normStart, normWinLen);

    // Combined score — see file header for weights.
    const score =
      0.45 * Math.min(1, meanRms * 4)         // RMS rarely > 0.25 in music
      + 0.20 * meanBright
      + 0.25 * selfSim
      - 0.10 * Math.min(1, stdRms * 6);

    out.push({
      startFrame: start,
      lenFrames: winLen,
      score,
      meanRms, stdRms, meanBright, selfSim,
    });
  };

  pushScore(0);
  for (let i = winLen; i < feat.rms.length; i += hop) {
    // Advance the rolling sums by `hop` frames.
    for (let j = 0; j < hop && i - hop + j < feat.rms.length; j++) {
      const dropIdx = i - winLen - hop + j + 1;
      const addIdx = i - hop + j + 1;
      if (addIdx >= feat.rms.length) break;
      if (dropIdx >= 0) {
        rmsSum -= feat.rms[dropIdx];
        rmsSqSum -= feat.rms[dropIdx] * feat.rms[dropIdx];
        brightSum -= feat.centroid[dropIdx];
      }
      rmsSum += feat.rms[addIdx];
      rmsSqSum += feat.rms[addIdx] * feat.rms[addIdx];
      brightSum += feat.centroid[addIdx];
    }
    pushScore(i - winLen + hop);
  }

  return out;
};

// ─── WAV encoding ────────────────────────────────────────────

const sliceMono = (
  buf: AudioBuffer,
  startSample: number,
  lenSamples: number,
): Float32Array => {
  const out = new Float32Array(lenSamples);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  for (let i = 0; i < lenSamples; i++) {
    let s = 0;
    for (let c = 0; c < channels.length; c++) s += channels[c][startSample + i] || 0;
    out[i] = s / channels.length;
  }
  return out;
};

const resampleLinear = (
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array => {
  if (targetRate >= sourceRate) return samples;
  const ratio = sourceRate / targetRate;
  const outLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(samples.length - 1, lo + 1);
    const t = src - lo;
    out[i] = samples[lo] * (1 - t) + samples[hi] * t;
  }
  return out;
};

const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
  const numChannels = 1;
  const bitDepth = 16;
  const byteRate = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign = numChannels * (bitDepth / 8);
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let off = 0;
  const writeStr = (s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); };
  const writeU32 = (v: number) => { view.setUint32(off, v, true); off += 4; };
  const writeU16 = (v: number) => { view.setUint16(off, v, true); off += 2; };

  writeStr('RIFF');
  writeU32(36 + dataSize);
  writeStr('WAVE');
  writeStr('fmt ');
  writeU32(16);
  writeU16(1);
  writeU16(numChannels);
  writeU32(sampleRate);
  writeU32(byteRate);
  writeU16(blockAlign);
  writeU16(bitDepth);
  writeStr('data');
  writeU32(dataSize);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

const prepareReferenceSamples = (samples: Float32Array, sampleRate: number): Float32Array => {
  const out = new Float32Array(samples);

  // Peak-normalize gently. Cover mode is sensitive to a quiet / clipped
  // reference: too quiet loses melody/timbre; clipped transients make the
  // generated cover messy. Cap boost so background noise doesn't get blasted.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1e-4) {
    const gain = Math.min(REFERENCE_PEAK / peak, REFERENCE_MAX_GAIN);
    for (let i = 0; i < out.length; i++) out[i] *= gain;
  }

  // Tiny edge fades remove hard-cut clicks from the auto-picked window.
  const fadeSamples = Math.min(Math.floor(sampleRate * REFERENCE_FADE_SEC), Math.floor(out.length / 2));
  for (let i = 0; i < fadeSamples; i++) {
    const t = i / Math.max(1, fadeSamples);
    out[i] *= t;
    out[out.length - 1 - i] *= t;
  }

  return out;
};

const encodeReferenceWav = (samples: Float32Array, sampleRate: number): Blob => {
  const targetRate = Math.min(sampleRate, REFERENCE_SAMPLE_RATE);
  const prepared = prepareReferenceSamples(samples, sampleRate);
  const compact = resampleLinear(prepared, sampleRate, targetRate);
  return encodeWav(compact, targetRate);
};

// ─── Public: single best window ─────────────────────────────

const buildCoverSampleFromBuffer = async (
  buf: AudioBuffer,
  targetSec: number,
  options: CoverSampleOptions,
  sourceOffsetSec = 0,
  sourceDurationSec?: number,
): Promise<CoverSampleResult> => {
  const totalSec = buf.length / buf.sampleRate;
  const fullSourceDurationSec = sourceDurationSec ?? totalSec;

  if (totalSec < MIN_SECONDS) {
    throw new Error(`Source is too short (${totalSec.toFixed(1)} s). Need at least ${MIN_SECONDS} s.`);
  }

  const desired = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, targetSec));

  if (totalSec <= desired) {
    reportProgress(options, 'encoding', 0.88, 'Encoding cover-ready reference…');
    const samples = sliceMono(buf, 0, buf.length);
    const wav = encodeReferenceWav(samples, buf.sampleRate);
    const base64 = await blobToBase64(wav);
    reportProgress(options, 'done', 1, 'Reference sample ready.');
    return { base64, durationSec: totalSec, startSec: sourceOffsetSec, sourceDurationSec: fullSourceDurationSec, score: 1 };
  }

  reportProgress(options, 'analyzing', 0.78, 'Analyzing loudness and musical shape…');
  const feat = extractFeatures(buf);
  const scored = computeWindowScores(feat, desired);
  if (scored.length === 0) {
    throw new Error('Could not analyze the audio (track too short).');
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  const startSample = Math.floor((best.startFrame / feat.framesPerSec) * buf.sampleRate);
  const lenSamples = Math.floor((best.lenFrames / feat.framesPerSec) * buf.sampleRate);
  reportProgress(options, 'encoding', 0.9, 'Encoding cover-ready reference…');
  const samples = sliceMono(buf, startSample, lenSamples);
  const wav = encodeReferenceWav(samples, buf.sampleRate);
  const base64 = await blobToBase64(wav);
  reportProgress(options, 'done', 1, 'Reference sample ready.');

  return {
    base64,
    durationSec: lenSamples / buf.sampleRate,
    startSec: sourceOffsetSec + startSample / buf.sampleRate,
    sourceDurationSec: fullSourceDurationSec,
    score: Math.max(0, Math.min(1, best.score)),
  };
};

export const buildCoverSample = async (
  source: Blob | string,
  targetSecOrOptions: number | CoverSampleOptions = TARGET_SECONDS,
): Promise<CoverSampleResult> => {
  const options = normalizeOptions(targetSecOrOptions);
  const desired = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, options.targetSec));

  if (typeof source === 'string' && options.fastRemote && isRemoteUrl(source)) {
    try {
      const fast = await decodeRemoteStreamSlice(source, desired, options);
      return await buildCoverSampleFromBuffer(
        fast.buffer,
        desired,
        options,
        fast.sourceOffsetSec,
        fast.sourceDurationSec,
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      reportProgress(options, 'loading', 0.08, 'Fast streamed capture failed — falling back to full decode…');
    }
  }

  reportProgress(options, 'loading', 0.08, 'Loading reference audio…');
  const blob = typeof source === 'string' ? await blobFromSource(source, options) : source;
  reportProgress(options, 'decoding', 0.28, 'Decoding reference audio…');
  const buf = await decodeAudio(blob, MAX_SECONDS + 5, true, options);
  return await buildCoverSampleFromBuffer(buf, desired, options);
};

// ─── Public: best-of mix (3 short segments with crossfades) ───

const crossfadeConcat = (
  segments: Float32Array[],
  sampleRate: number,
  fadeSec: number,
): Float32Array => {
  if (segments.length === 0) return new Float32Array(0);
  if (segments.length === 1) return segments[0];

  const fadeSamples = Math.floor(fadeSec * sampleRate);
  let total = 0;
  for (const s of segments) total += s.length;
  total -= fadeSamples * (segments.length - 1);
  const out = new Float32Array(total);

  let writePos = 0;
  // First segment: copy verbatim except its tail will be overlapped.
  out.set(segments[0], 0);
  writePos = segments[0].length - fadeSamples;

  for (let s = 1; s < segments.length; s++) {
    const seg = segments[s];
    // Crossfade: linear ramp out (previous) + linear ramp in (current).
    for (let i = 0; i < fadeSamples; i++) {
      const t = i / fadeSamples;
      out[writePos + i] = out[writePos + i] * (1 - t) + seg[i] * t;
    }
    // Copy remainder of current segment.
    for (let i = fadeSamples; i < seg.length; i++) {
      out[writePos + i] = seg[i];
    }
    writePos += seg.length - fadeSamples;
  }
  return out;
};

// Pick top-N windows that don't overlap with each other (greedy
// non-overlapping selection). Spread enforces minimum source-time gap.
const pickTopNonOverlapping = (
  scored: WindowScore[],
  count: number,
  minGapFrames: number,
): WindowScore[] => {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const picks: WindowScore[] = [];
  for (const cand of sorted) {
    const conflict = picks.some(
      (p) => Math.abs(p.startFrame - cand.startFrame) < Math.max(p.lenFrames, cand.lenFrames) + minGapFrames,
    );
    if (!conflict) picks.push(cand);
    if (picks.length >= count) break;
  }
  picks.sort((a, b) => a.startFrame - b.startFrame);
  return picks;
};

export const buildIconicMix = async (
  source: Blob | string,
  options: CoverSampleOptions = {},
): Promise<IconicMixResult> => {
  reportProgress(options, 'loading', 0.08, 'Loading reference audio…');
  const blob = typeof source === 'string' ? await blobFromSource(source, options) : source;
  reportProgress(options, 'decoding', 0.28, 'Decoding reference audio…');
  const buf = await decodeAudio(blob, MAX_SECONDS + 5, true, options);
  const totalSec = buf.length / buf.sampleRate;

  if (totalSec < MIN_SECONDS * 2) {
    // Too short for a meaningful mix — fall through to a single sample.
    const single = await buildCoverSample(blob, { ...options, targetSec: TARGET_SECONDS });
    return {
      base64: single.base64,
      durationSec: single.durationSec,
      segments: [{ startSec: single.startSec, endSec: single.startSec + single.durationSec, score: single.score }],
      sourceDurationSec: totalSec,
    };
  }

  reportProgress(options, 'analyzing', 0.68, 'Finding iconic moments…');
  const feat = extractFeatures(buf);
  const scored = computeWindowScores(feat, MIX_SEG_SECONDS);
  if (scored.length === 0) {
    throw new Error('Could not analyze the audio.');
  }

  // Want segments roughly 1/3 of the track apart — gives variety.
  const minGapFrames = Math.max(
    Math.floor(MIX_SEG_SECONDS * feat.framesPerSec * 0.5),
    Math.floor(feat.rms.length / 4),
  );
  const picks = pickTopNonOverlapping(scored, MIX_SEG_COUNT, minGapFrames);

  // Slice each pick from the source AudioBuffer.
  const segs: Float32Array[] = picks.map((w) => {
    const startSample = Math.floor((w.startFrame / feat.framesPerSec) * buf.sampleRate);
    const lenSamples = Math.floor((w.lenFrames / feat.framesPerSec) * buf.sampleRate);
    return sliceMono(buf, startSample, lenSamples);
  });

  const mixed = crossfadeConcat(segs, buf.sampleRate, MIX_CROSSFADE_SEC);
  reportProgress(options, 'encoding', 0.9, 'Encoding cover-ready reference mix…');
  const wav = encodeReferenceWav(mixed, buf.sampleRate);
  const base64 = await blobToBase64(wav);
  reportProgress(options, 'done', 1, 'Reference sample ready.');

  const segments = picks.map((w) => ({
    startSec: w.startFrame / feat.framesPerSec,
    endSec: (w.startFrame + w.lenFrames) / feat.framesPerSec,
    score: Math.max(0, Math.min(1, w.score)),
  }));

  return {
    base64,
    durationSec: mixed.length / buf.sampleRate,
    segments,
    sourceDurationSec: totalSec,
  };
};
