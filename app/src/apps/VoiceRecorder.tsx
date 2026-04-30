// ============================================================
// Voice Recorder — real microphone capture (no longer a fake skeleton)
// ============================================================
//
// Uses the browser's MediaRecorder + getUserMedia to capture real audio
// and stores it as base64-encoded webm in localStorage so:
//   1. Recordings survive reloads.
//   2. Music Creator's Cover mode can pick from these recordings to
//      build "cover samples" (auto-trimmed to MiniMax's 6 s–6 min
//      window with the most musical section selected).
//
// Storage key: `tytus.voice-recorder.recordings`
// Schema is intentionally compatible with what Music Creator expects.

import { useState, useRef, useEffect, memo } from 'react';
import {
  Mic, Play, Pause, Square, Trash2, Download, AlertCircle,
} from 'lucide-react';

// ---- Types ----
export interface VoiceRecording {
  id: string;
  name: string;
  durationMs: number;
  createdAt: number;
  // Base64-encoded webm/opus blob from MediaRecorder.
  audioDataUrl: string;
  mimeType: string;
}

const STORAGE_KEY = 'tytus.voice-recorder.recordings';

const loadRecordings = (): VoiceRecording[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VoiceRecording[]) : [];
  } catch {
    return [];
  }
};

const saveRecordings = (list: VoiceRecording[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Voice recordings storage failed:', e);
  }
};

// ---- Live waveform driven by AnalyserNode RMS ----
const WaveformVisualizer = memo(function WaveformVisualizer({
  analyser,
  active,
}: { analyser: AnalyserNode | null; active: boolean }) {
  const [bars, setBars] = useState<number[]>(Array(40).fill(4));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !analyser) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      queueMicrotask(() => setBars(Array(40).fill(4)));
      return;
    }
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      // 40 visible bars; sample evenly across the FFT bins.
      const step = Math.floor(buf.length / 40);
      const next: number[] = [];
      for (let i = 0; i < 40; i++) {
        const v = buf[i * step] || 0;
        next.push(4 + (v / 255) * 64);
      }
      setBars(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, active]);

  return (
    <div className="flex items-end justify-center gap-1" style={{ height: 80 }}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="rounded-full transition-all"
          style={{
            width: 4,
            height: h,
            background: 'linear-gradient(to top, #4CAF50, #81C784)',
            opacity: 0.5 + (i / 40) * 0.5,
          }}
        />
      ))}
    </div>
  );
});

// ---- Helpers ----
const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// ---- Main ----
export default function VoiceRecorder() {
  const [recordings, setRecordings] = useState<VoiceRecording[]>(() => loadRecordings());
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startTimestampRef = useRef<number>(0);
  const accumulatedBeforePauseRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);

  // Persist whenever the list changes.
  useEffect(() => {
    saveRecordings(recordings);
  }, [recordings]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => undefined);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up the analyser for the live waveform.
      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtor();
      const source = ctx.createMediaStreamSource(stream);
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);
      audioCtxRef.current = ctx;
      setAnalyser(analyserNode);

      // Pick the best-supported mime type. Webm/opus is universally
      // available in Chromium-family browsers; Safari falls back to mp4.
      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: chunksRef.current[0]?.type || mime || 'audio/webm',
          });
          if (blob.size === 0) {
            setError('Recording was empty.');
            return;
          }
          const dataUrl = await blobToDataUrl(blob);
          const duration = accumulatedBeforePauseRef.current;
          const rec: VoiceRecording = {
            id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: `Recording ${recordings.length + 1}`,
            durationMs: duration,
            createdAt: Date.now(),
            audioDataUrl: dataUrl,
            mimeType: blob.type,
          };
          setRecordings((prev) => [rec, ...prev]);
        } catch (err) {
          setError(`Could not save recording: ${(err as Error).message}`);
        } finally {
          // Always release the mic.
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          audioCtxRef.current?.close().catch(() => undefined);
          audioCtxRef.current = null;
          setAnalyser(null);
        }
      };
      mr.start(250); // 250ms chunks for smooth stop
      mediaRecorderRef.current = mr;

      accumulatedBeforePauseRef.current = 0;
      startTimestampRef.current = Date.now();
      setElapsedMs(0);
      setRecording(true);
      setPaused(false);

      tickerRef.current = setInterval(() => {
        setElapsedMs(accumulatedBeforePauseRef.current + (Date.now() - startTimestampRef.current));
      }, 100);
    } catch (e) {
      setError((e as Error).message || 'Microphone access denied.');
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const pauseRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state !== 'recording') return;
    mr.pause();
    accumulatedBeforePauseRef.current += Date.now() - startTimestampRef.current;
    setPaused(true);
  };

  const resumeRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state !== 'paused') return;
    mr.resume();
    startTimestampRef.current = Date.now();
    setPaused(false);
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (mr.state === 'recording') {
      accumulatedBeforePauseRef.current += Date.now() - startTimestampRef.current;
    }
    mr.stop();
    if (tickerRef.current) clearInterval(tickerRef.current);
    setRecording(false);
    setPaused(false);
    setElapsedMs(0);
  };

  const togglePlay = (rec: VoiceRecording) => {
    if (playingId === rec.id) {
      playbackAudioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
    }
    const audio = new Audio(rec.audioDataUrl);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => { setPlayingId(null); setError('Cannot play this recording.'); };
    audio.play().catch((e: Error) => {
      setError(e.message || 'Playback blocked.');
      setPlayingId(null);
    });
    playbackAudioRef.current = audio;
    setPlayingId(rec.id);
  };

  const deleteRecording = (id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    if (playingId === id) {
      playbackAudioRef.current?.pause();
      setPlayingId(null);
    }
  };

  const downloadRecording = (rec: VoiceRecording) => {
    const a = document.createElement('a');
    a.href = rec.audioDataUrl;
    // Pick file extension from the mime type.
    const ext = rec.mimeType.includes('mp4') ? 'm4a'
      : rec.mimeType.includes('ogg') ? 'ogg'
      : 'webm';
    a.download = `${rec.name}.${ext}`;
    a.click();
  };

  const renameRecording = (id: string, name: string) => {
    setRecordings((prev) => prev.map((r) => r.id === id ? { ...r, name: name.trim() || r.name } : r));
  };

  const statusLabel = recording
    ? (paused ? 'Paused' : 'Recording…')
    : (playingId ? 'Playing' : 'Ready to record');

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-window)' }}>
      {/* Visualizer Area */}
      <div
        className="flex flex-col items-center justify-center gap-4 px-6 py-5 shrink-0"
        style={{ background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <WaveformVisualizer analyser={analyser} active={recording && !paused} />

        <div style={{ fontSize: 36, fontWeight: 300, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(elapsedMs / 1000)}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {statusLabel}
          {recording && !paused && (
            <span className="inline-flex items-center gap-1.5 ml-2">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
              <span style={{ fontSize: 11, color: '#ef4444' }}>REC</span>
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          {!recording ? (
            <button
              onClick={startRecording}
              className="flex items-center justify-center rounded-full transition-all hover:scale-105"
              style={{
                width: 64, height: 64,
                background: '#ef4444', color: 'white',
                boxShadow: '0 0 20px rgba(239,68,68,0.35)',
              }}
              title="Start recording"
            >
              <Mic size={28} />
            </button>
          ) : !paused ? (
            <>
              <button
                onClick={pauseRecording}
                className="flex items-center justify-center rounded-full transition-all hover:scale-105"
                style={{ width: 48, height: 48, background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                title="Pause"
              >
                <Pause size={20} />
              </button>
              <button
                onClick={stopRecording}
                className="flex items-center justify-center rounded-full transition-all hover:scale-105"
                style={{
                  width: 64, height: 64, background: '#ef4444', color: 'white',
                  animation: 'pulse 1s infinite',
                }}
                title="Stop"
              >
                <Square size={24} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={resumeRecording}
                className="flex items-center justify-center rounded-full transition-all hover:scale-105"
                style={{ width: 48, height: 48, background: 'var(--accent-primary)', color: 'white' }}
                title="Resume"
              >
                <Play size={20} className="ml-0.5" />
              </button>
              <button
                onClick={stopRecording}
                className="flex items-center justify-center rounded-full transition-all hover:scale-105"
                style={{ width: 64, height: 64, background: '#ef4444', color: 'white' }}
                title="Stop"
              >
                <Square size={24} />
              </button>
            </>
          )}
        </div>

        {error && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-md mt-1"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <AlertCircle size={12} style={{ color: '#ff8a80' }} />
            <span style={{ fontSize: 11, color: '#ff8a80' }}>{error}</span>
          </div>
        )}
      </div>

      {/* Recordings List */}
      <div className="flex-1 overflow-y-auto invisible-scrollbar" style={{ paddingBottom: 96 }}>
        {recordings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
            <Mic size={32} style={{ color: 'var(--text-disabled)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-disabled)' }}>No recordings yet</span>
            <span style={{ fontSize: 11, color: 'var(--text-disabled)', maxWidth: 280 }}>
              Tap the mic to capture audio. Recordings can be reused as cover samples in Juli3ta.
            </span>
          </div>
        ) : (
          recordings.map((rec) => (
            <div
              key={rec.id}
              className="flex items-center gap-3 px-4 py-3 transition-all"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <button
                onClick={() => togglePlay(rec)}
                className="flex items-center justify-center rounded-full transition-all shrink-0"
                style={{
                  width: 36, height: 36,
                  background: playingId === rec.id ? 'var(--accent-primary)' : 'var(--bg-hover)',
                  color: playingId === rec.id ? 'white' : 'var(--text-secondary)',
                }}
              >
                {playingId === rec.id ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
              </button>

              <div className="flex-1 min-w-0">
                <input
                  defaultValue={rec.name}
                  onBlur={(e) => renameRecording(rec.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="bg-transparent outline-none focus:ring-1 focus:ring-[var(--accent-primary)] rounded-input px-1 -ml-1"
                  style={{ fontSize: 13, color: 'var(--text-primary)', width: '100%' }}
                />
                <div className="flex items-center gap-2 mt-0.5">
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatTime(rec.durationMs / 1000)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>{new Date(rec.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <button
                onClick={() => downloadRecording(rec)}
                className="flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] shrink-0"
                style={{ width: 28, height: 28 }}
                title="Download"
              >
                <Download size={14} style={{ color: 'var(--text-secondary)' }} />
              </button>
              <button
                onClick={() => deleteRecording(rec.id)}
                className="flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] shrink-0"
                style={{ width: 28, height: 28 }}
                title="Delete"
              >
                <Trash2 size={14} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
