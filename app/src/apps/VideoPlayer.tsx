// ============================================================
// Video Player — real <video> playback (no longer a fake skeleton)
// ============================================================
//
// Loads local video files via the file picker. Supports drag-and-drop,
// fullscreen, keyboard shortcuts, playback speed, and a horizontal
// thumbnail playlist for swapping between recently-loaded files.

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Maximize, Minimize, Settings, Film, Upload, Trash2,
} from 'lucide-react';
import { useI18n } from '@/i18n';

// ---- Types ----
interface VideoEntry {
  id: string;
  name: string;
  size: string;
  src: string;          // object URL
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// ---- Helpers ----
const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatBytes = (b: number): string => {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

// ---- Main Video Player ----
export default function VideoPlayer() {
  const { t } = useI18n();
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playlist, setPlaylist] = useState<VideoEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const currentVideo = currentIndex !== null ? playlist[currentIndex] : null;

  // ── Cleanup object URLs on unmount ────────────────────────────────
  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  // ── Wire up real video events ─────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onLoaded = () => setDuration(v.duration || 0);
    const onEnded = () => setIsPlaying(false);
    const onErr = () => setError('Unable to play this video.');
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onErr);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onErr);
    };
  }, [currentVideo?.src]);

  // ── Volume / playback speed sync ──────────────────────────────────
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, currentVideo?.src]);

  // ── Fullscreen change listener ────────────────────────────────────
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ── File handling ─────────────────────────────────────────────────
  const handlePickFiles = () => fileInputRef.current?.click();

  const ingestFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('video/'));
    if (list.length === 0) return;
    const added: VideoEntry[] = list.map((file) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      return {
        id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        size: formatBytes(file.size),
        src: url,
      };
    });
    setPlaylist((prev) => {
      const next = [...prev, ...added];
      // Auto-select first newly-imported video if nothing's currently playing.
      if (currentIndex === null) {
        setCurrentIndex(prev.length); // first new index
        setIsPlaying(true);
      }
      return next;
    });
  }, [currentIndex]);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) ingestFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) ingestFiles(e.dataTransfer.files);
  };

  const handleRemove = (idx: number) => {
    setPlaylist((prev) => {
      const removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      if (removed) {
        URL.revokeObjectURL(removed.src);
        objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== removed.src);
      }
      if (idx === currentIndex) {
        setIsPlaying(false);
        setCurrentIndex(next.length > 0 ? 0 : null);
      } else if (currentIndex !== null && idx < currentIndex) {
        setCurrentIndex((c) => (c === null ? null : c - 1));
      }
      return next;
    });
  };

  // ── Controls ──────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setError(null);
    if (v.paused) {
      v.play().then(() => setIsPlaying(true)).catch((e: Error) => {
        setError(e.message || 'Playback failed.');
        setIsPlaying(false);
      });
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const skip = (delta: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + delta));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = Number(e.target.value);
    setVolume(newVol);
    if (newVol > 0 && muted) setMuted(false);
  };

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      videoContainerRef.current?.requestFullscreen().catch(() => undefined);
    } else {
      document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const selectVideo = (idx: number) => {
    setCurrentIndex(idx);
    setCurrentTime(0);
    setIsPlaying(true);
    setTimeout(() => videoRef.current?.play().catch(() => undefined), 50);
  };

  // Auto-hide controls during playback
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target !== document.body && !(e.target instanceof HTMLDivElement)) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') skip(5);
      if (e.code === 'ArrowLeft') skip(-5);
      if (e.code === 'ArrowUp') setVolume((v) => Math.min(v + 0.1, 1));
      if (e.code === 'ArrowDown') setVolume((v) => Math.max(v - 0.1, 0));
      if (e.code === 'KeyF') toggleFullscreen();
      if (e.code === 'KeyM') setMuted((m) => !m);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, toggleFullscreen, duration]);

  return (
    <div
      ref={videoContainerRef}
      className="flex flex-col h-full relative"
      style={{ background: '#000' }}
      onMouseMove={handleMouseMove}
      onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setIsDragging(false); }}
      onDrop={handleDrop}
    >
      {/* Drag-overlay highlight */}
      {isDragging && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
          style={{
            background: 'rgba(124, 77, 255, 0.15)',
            border: '2px dashed var(--accent-primary)',
          }}
        >
          <div style={{ fontSize: 14, color: 'white', fontWeight: 600 }}>
            {t('videoPlayer.dropToAdd')}
          </div>
        </div>
      )}

      {/* Video Display Area */}
      <div className="flex-1 flex items-center justify-center relative" style={{ background: '#0A0A0A' }}>
        {!currentVideo ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: 88, height: 88,
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                opacity: 0.5,
              }}
            >
              <Film size={40} style={{ color: 'white' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t('videoPlayer.empty.title')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 320 }}>
                Pick a video file from your computer or drag one into this window. Supports mp4, webm, mov, mkv.
              </div>
            </div>
            <button
              onClick={handlePickFiles}
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all hover:scale-[1.02]"
              style={{
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                color: 'white',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Upload size={14} />
              {t('videoPlayer.openFile')}
            </button>
          </div>
        ) : (
          <>
            {/* Real video element */}
            <video
              ref={videoRef}
              src={currentVideo.src}
              className="w-full h-full"
              style={{ background: '#000', objectFit: 'contain' }}
              onClick={togglePlay}
              playsInline
            />

            {/* Centered play button when paused */}
            {!isPlaying && (
              <button
                onClick={togglePlay}
                className="absolute flex items-center justify-center rounded-full transition-transform hover:scale-110"
                style={{
                  width: 72, height: 72,
                  background: 'rgba(0,0,0,0.6)',
                  border: '2px solid rgba(255,255,255,0.4)',
                }}
              >
                <Play size={36} style={{ color: 'white', marginLeft: 4 }} />
              </button>
            )}

            {/* Error banner */}
            {error && (
              <div
                className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md"
                style={{ fontSize: 11, color: '#ff8a80', background: 'rgba(0,0,0,0.7)' }}
              >
                {error}
              </div>
            )}

            {/* Controls Overlay */}
            {showControls && (
              <div
                className="absolute bottom-0 left-0 right-0 flex flex-col gap-1 px-3 pb-3 pt-8 transition-opacity"
                style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' }}
              >
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.01}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full cursor-pointer"
                  style={{ accentColor: 'var(--accent-primary)', height: 4 }}
                />
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-2">
                    <button onClick={togglePlay} className="flex items-center justify-center rounded-full hover:bg-[rgba(255,255,255,0.1)]" style={{ width: 36, height: 36 }}>
                      {isPlaying
                        ? <Pause size={20} style={{ color: 'white' }} />
                        : <Play size={20} style={{ color: 'white' }} className="ml-0.5" />}
                    </button>
                    <button onClick={() => skip(-10)} className="flex items-center justify-center rounded-full hover:bg-[rgba(255,255,255,0.1)]" style={{ width: 28, height: 28 }} title={t('videoPlayer.back10')}>
                      <SkipBack size={16} style={{ color: 'white' }} />
                    </button>
                    <button onClick={() => skip(10)} className="flex items-center justify-center rounded-full hover:bg-[rgba(255,255,255,0.1)]" style={{ width: 28, height: 28 }} title={t('videoPlayer.forward10')}>
                      <SkipForward size={16} style={{ color: 'white' }} />
                    </button>
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.85)', marginLeft: 8, fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={() => setMuted((m) => !m)} className="flex items-center justify-center rounded-full hover:bg-[rgba(255,255,255,0.1)]" style={{ width: 28, height: 28 }}>
                      {muted || volume === 0
                        ? <VolumeX size={16} style={{ color: 'white' }} />
                        : <Volume2 size={16} style={{ color: 'white' }} />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      onChange={handleVolumeChange}
                      style={{ width: 60, accentColor: 'white', height: 3 }}
                    />
                    <div className="relative">
                      <button
                        onClick={() => setShowSpeedMenu((s) => !s)}
                        className="flex items-center justify-center rounded-full hover:bg-[rgba(255,255,255,0.1)]"
                        style={{ width: 28, height: 28 }}
                        title={`${playbackSpeed}x`}
                      >
                        <Settings size={16} style={{ color: 'white' }} />
                      </button>
                      {showSpeedMenu && (
                        <div
                          className="absolute bottom-8 right-0 rounded-lg overflow-hidden z-20"
                          style={{ background: 'rgba(30,30,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
                        >
                          {SPEED_OPTIONS.map((s) => (
                            <button
                              key={s}
                              onClick={() => { setPlaybackSpeed(s); setShowSpeedMenu(false); }}
                              className="block w-full px-4 py-2 text-left transition-all hover:bg-[rgba(255,255,255,0.1)]"
                              style={{ fontSize: '12px', color: s === playbackSpeed ? 'var(--accent-primary)' : 'white' }}
                            >
                              {s}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={handlePickFiles} className="flex items-center justify-center rounded-full hover:bg-[rgba(255,255,255,0.1)]" style={{ width: 28, height: 28 }} title={t('videoPlayer.addFiles')}>
                      <Upload size={16} style={{ color: 'white' }} />
                    </button>
                    <button onClick={toggleFullscreen} className="flex items-center justify-center rounded-full hover:bg-[rgba(255,255,255,0.1)]" style={{ width: 28, height: 28 }} title={t('videoPlayer.fullscreen')}>
                      {isFullscreen ? <Minimize size={16} style={{ color: 'white' }} /> : <Maximize size={16} style={{ color: 'white' }} />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Playlist strip — only when at least one video is loaded */}
      {playlist.length > 0 && (
        <div
          className="shrink-0 overflow-x-auto invisible-scrollbar"
          style={{
            height: 80,
            background: 'var(--bg-titlebar)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div className="flex gap-2 p-2 h-full items-center">
            {playlist.map((video, i) => (
              <div
                key={video.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg shrink-0 group cursor-pointer"
                onClick={() => selectVideo(i)}
                style={{
                  background: i === currentIndex ? 'var(--bg-selected)' : 'var(--bg-hover)',
                  border: i === currentIndex ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                }}
              >
                <Film size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                <div className="text-left">
                  <div className="truncate" style={{ fontSize: '12px', color: 'var(--text-primary)', maxWidth: 160 }}>{video.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>{video.size}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(i); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--text-secondary)' }}
                  title={t('common.remove')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={handlePickFiles}
              className="flex items-center gap-2 px-3 py-2 rounded-lg shrink-0 transition-all hover:bg-[var(--bg-hover)]"
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                border: '1px dashed var(--border-subtle)',
              }}
            >
              <Upload size={14} />
              {t('common.add')}
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        onChange={handleFiles}
        style={{ display: 'none' }}
      />
    </div>
  );
}
