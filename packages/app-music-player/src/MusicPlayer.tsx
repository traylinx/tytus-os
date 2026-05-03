// ============================================================
// Music Player — real audio playback (no longer a fake skeleton)
// ============================================================
//
// Track sources:
//   1. JULI3TA gallery — base64 MP3s saved by MusicCreator into its
//      own SQLite-backed table. Read here read-only via a cross-app
//      shared key (`storage.shared.music_creator_tracks`); the OWNING
//      app declares `storage.shares.music_creator_tracks →
//      app_music_creator_tracks`. Auto-imported so the same library
//      is visible in both apps.
//   2. Local file picker / drag-and-drop — anything the browser's
//      <audio> element accepts (mp3, wav, ogg, flac, m4a, aac).
//
// All playback uses a real <audio> element with timeupdate / ended
// listeners — no setInterval timer pretending to be playback.
//
// Lifted from app/src/apps/MusicPlayer.tsx as part of the Apps
// Platform W3 extraction. Two notable rewrites vs the legacy file:
//   - Reads the gallery via `host.storage.forSharedKey('music_creator_tracks')`
//     instead of importing the in-tree `@/lib/repo/musicCreator` repo.
//   - Reads window args via `host.windows.current.args` instead of
//     `useCurrentWindowArgs()`. The args path is now `args?.trackId`
//     (matching `MusicPlayerWindowArgs` in @tytus/contracts), NOT the
//     legacy nested `args?.music?.trackId`. See contract drift note in
//     the W3 PR body for the consumer cleanup that follows.

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Volume2, VolumeX, ListMusic, Music, Upload, Sparkles, Trash2,
} from 'lucide-react';
import type { HostClient, SharedDb } from '@tytus/host-api';
import type { MusicPlayerWindowArgs } from '@tytus/contracts';

// `Sparkles` is intentionally unused here — kept in the import list to
// match the legacy file's bundle imports while the dual-source
// transition is live. The placeholder branch below uses the
// JULI3TA mark image instead of the icon.
void Sparkles;

// ---- Types ----
interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds; 0 = unknown until <audio> loads
  src: string;      // data URL or object URL or file path
  source: 'juli3ta' | 'local';
  // Optional album-cover-art (base64 data URL). When present the
  // player renders it in place of the gradient + Sparkles placeholder.
  // Carried across from MusicCreator's SavedTrack.coverDataUrl so an
  // OPEN_OR_FOCUS_WINDOW handoff doesn't lose the art the user
  // generated/uploaded in JULI3TA.
  coverDataUrl?: string;
}

// ---- Cross-app shared row shape ----------------------------------------
//
// Wire-level row shape of the OWNING app's table
// (`app_music_creator_tracks`). Duplicated here from
// `app/src/lib/repo/musicCreator.ts` (see `SavedTrackRow` /
// `DBRow.fromDb`) because this app reads the table over the
// share-key boundary; importing the in-tree repo would re-link the
// player to shell internals. KEEP THIS SHAPE IN SYNC with the
// owner — schema changes there (new columns, renames) MUST land
// here too.
//
// Only the fields the player actually consumes are required; the
// rest are optional so we don't crash if the owner adds columns.
export interface SavedTrackRow {
  id: string;
  title: string;
  styleTags: string;
  durationMs: number;
  audioDataUrl: string;
  coverDataUrl?: string;
}

interface RawSavedTrackDbRow {
  id: string;
  title: string | null;
  style_tags: string | null;
  duration_ms: number | null;
  audio_data_url: string | null;
  cover_data_url?: string | null;
}

const fromDbRow = (r: RawSavedTrackDbRow): SavedTrackRow => ({
  id: r.id,
  title: r.title ?? '',
  styleTags: r.style_tags ?? '',
  durationMs: r.duration_ms ?? 0,
  audioDataUrl: r.audio_data_url ?? '',
  coverDataUrl: r.cover_data_url ?? undefined,
});

const rowToTrack = (r: SavedTrackRow): Track => ({
  id: r.id,
  title: r.title || 'Untitled',
  artist: 'JULI3TA',
  album: r.styleTags || '—',
  duration: Math.round((r.durationMs || 0) / 1000),
  src: r.audioDataUrl,
  source: 'juli3ta' as const,
  coverDataUrl: r.coverDataUrl || undefined,
});

const loadJuli3taGalleryAsync = async (sharedDb: SharedDb): Promise<Track[]> => {
  try {
    // Read directly off the OWNING app's physical table. The cross-app
    // prefix guard accepts this query because our manifest declares
    // `storage.shared.music_creator_tracks` and Music Creator declares
    // `storage.shares.music_creator_tracks → app_music_creator_tracks`.
    const rows = await sharedDb.query<RawSavedTrackDbRow>(
      `SELECT id, title, style_tags, duration_ms, audio_data_url, cover_data_url
         FROM app_music_creator_tracks
        ORDER BY created_at DESC`,
    );
    const mapped = rows.map(fromDbRow);
    // Hide lyrics-only sheets — MusicPlayer only plays audio. The
    // gallery already shows them in MusicCreator.
    return mapped.filter((r) => r.audioDataUrl).map(rowToTrack);
  } catch {
    // Owner may not have provisioned the shared key yet (fresh install,
    // pre-seed boot race). Empty list keeps the UI in its empty state.
    return [];
  }
};

// ---- Helpers ----
const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// ---- Visualizer Bars (still cosmetic; bars dance while audio plays) ----
const VisualizerBars = memo(function VisualizerBars({ isPlaying }: { isPlaying: boolean }) {
  const [bars, setBars] = useState<number[]>(Array(32).fill(4));

  useEffect(() => {
    if (!isPlaying) {
      queueMicrotask(() => setBars(Array(32).fill(4)));
      return;
    }
    const interval = setInterval(() => {
      setBars(Array.from({ length: 32 }, () => Math.random() * 40 + 4));
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <div className="flex items-end justify-center gap-[2px]" style={{ height: 50 }}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="rounded-full transition-all"
          style={{
            width: 4,
            height: h,
            background: `linear-gradient(to top, var(--accent-primary), var(--accent-secondary))`,
            opacity: 0.6 + (i / 32) * 0.4,
          }}
        />
      ))}
    </div>
  );
});

export interface MusicPlayerProps {
  host: HostClient;
  /** Read-only handle to Music Creator's `app_music_creator_tracks`
   *  table, resolved via `host.storage.forSharedKey('music_creator_tracks')`.
   *  May be null in degraded conditions (owner uninstalled or share
   *  not declared) — the player falls back to local-file-only mode. */
  sharedDb: SharedDb | null;
}

// ---- Main Music Player ----
export default function MusicPlayer({ host, sharedDb }: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  // Read window args via the host surface — workspace-package apps
  // never call `useCurrentWindowArgs()` (a shell-only hook).
  // Args may be undefined when the player launched without a payload.
  const args = host.windows.current.args as MusicPlayerWindowArgs | undefined;
  const intentTrackId = args?.trackId ?? null;
  const intentSeededRef = useRef(false);

  // Gallery hydrates async from SQLite. Empty until the first load
  // resolves (typically <50 ms). A "Loading…" banner isn't worth the
  // visual jitter; the empty state already says "Pick files / generate".
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'one' | 'all'>('off');
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTrack: Track | undefined = tracks[currentIndex];

  // ── Keep gallery in sync with MusicCreator writes ────────────────
  useEffect(() => {
    if (!sharedDb) return; // No share resolved → stay local-files-only.
    let cancelled = false;
    const refresh = async () => {
      const fromGallery = await loadJuli3taGalleryAsync(sharedDb);
      if (cancelled) return;
      setTracks((prev) => {
        // Preserve any locally-imported (non-Juli3ta) tracks; replace Juli3ta set.
        const local = prev.filter((t) => t.source === 'local');
        return [...fromGallery, ...local];
      });
    };
    void refresh();
    // SQLite has no built-in change notification, so refresh on focus
    // (covers tab-switch back to the OS) and at a generous interval.
    // Player-side cache; owner-side writes are intentionally NOT
    // wire-level events — keeps the cross-app coupling read-only.
    const onFocus = () => { void refresh(); };
    const intervalId = setInterval(refresh, 5000);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [sharedDb]);

  // Honour an OPEN_OR_FOCUS_WINDOW intent like
  // `{ trackId }` (flat, per `MusicPlayerWindowArgs`) from a desktop
  // double-click. The legacy nested `args.music.trackId` shape is
  // fixed at the consumer in W3+; this app reads the contract shape.
  useEffect(() => {
    if (!intentTrackId || intentSeededRef.current) return;
    if (tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.id === intentTrackId);
    if (idx >= 0) {
      intentSeededRef.current = true;
      queueMicrotask(() => {
        setCurrentIndex(idx);
        setIsPlaying(true);
      });
    }
  }, [intentTrackId, tracks]);

  // ── Reflect volume + src changes ─────────────────────────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !currentTrack) return;
    if (a.src !== currentTrack.src) {
      a.src = currentTrack.src;
      setCurrentTime(0);
      setDuration(currentTrack.duration || 0);
    }
    // Keep the <audio> element's paused state in sync with React's
    // `isPlaying` flag. Previously we only called play() when the src
    // changed — so external state changes (e.g. an OPEN_OR_FOCUS_WINDOW
    // intent that flipped isPlaying=true after the src was already set)
    // never reached the audio element. The visualizer + Pause icon
    // followed React state and the actual audio stayed silent.
    if (isPlaying && a.paused) {
      a.play().catch(() => setIsPlaying(false));
    } else if (!isPlaying && !a.paused) {
      a.pause();
    }
  }, [currentTrack, isPlaying]);

  // ── Cleanup object URLs on unmount ────────────────────────────────
  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  // ── Controls ──────────────────────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    const a = audioRef.current;
    if (!a || !currentTrack) return;
    setError(null);
    if (a.paused) {
      a.play().then(() => setIsPlaying(true)).catch((e: Error) => {
        setError(e.message || 'Playback failed.');
        setIsPlaying(false);
      });
    } else {
      a.pause();
      setIsPlaying(false);
    }
  }, [currentTrack]);

  const handleNext = useCallback(() => {
    if (tracks.length === 0) return;
    const a = audioRef.current;
    let nextIdx: number;
    if (isShuffle) {
      nextIdx = Math.floor(Math.random() * tracks.length);
    } else {
      nextIdx = (currentIndex + 1) % tracks.length;
      // End of list + repeat=off → stop playback at the last track.
      if (currentIndex === tracks.length - 1 && repeatMode === 'off') {
        setIsPlaying(false);
        if (a) a.pause();
        return;
      }
    }
    setCurrentIndex(nextIdx);
    setCurrentTime(0);
    setIsPlaying(true);
  }, [isShuffle, tracks.length, currentIndex, repeatMode]);

  // ── Wire up real audio element events ─────────────────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrentTime(a.currentTime);
    const onLoaded = () => setDuration(a.duration || 0);
    const onEnded = () => {
      if (repeatMode === 'one') {
        a.currentTime = 0;
        a.play().catch(() => undefined);
      } else {
        handleNext();
      }
    };
    const onErr = () => setError('Unable to play this track.');
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onErr);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onErr);
    };
  }, [handleNext, repeatMode]);

  const handlePrev = useCallback(() => {
    if (tracks.length === 0) return;
    if (currentTime > 3) {
      const a = audioRef.current;
      if (a) a.currentTime = 0;
      setCurrentTime(0);
    } else {
      setCurrentIndex((prev) => (prev - 1 + tracks.length) % tracks.length);
      setCurrentTime(0);
      setIsPlaying(true);
    }
  }, [currentTime, tracks.length]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    setCurrentTime(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
  };

  const toggleRepeat = () => {
    setRepeatMode((prev) => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off');
  };

  const handlePickFiles = () => fileInputRef.current?.click();

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const added: Track[] = [];
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      added.push({
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: 'Local file',
        album: '—',
        duration: 0,
        src: url,
        source: 'local',
      });
    }
    setTracks((prev) => [...prev, ...added]);
    // Auto-select the first newly-imported track if nothing's playing.
    if (!isPlaying && added.length > 0) {
      setCurrentIndex(tracks.length); // first new index
    }
    // Reset input so re-picking the same file fires the change event.
    e.target.value = '';
  };

  const handleRemoveTrack = (idx: number) => {
    setTracks((prev) => {
      const removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      // Clean up object URL if it was a local file.
      if (removed && removed.source === 'local' && removed.src.startsWith('blob:')) {
        URL.revokeObjectURL(removed.src);
        objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== removed.src);
      }
      // Adjust current index if needed.
      if (idx === currentIndex) {
        setIsPlaying(false);
        if (audioRef.current) audioRef.current.pause();
        setCurrentIndex(0);
      } else if (idx < currentIndex) {
        setCurrentIndex((c) => c - 1);
      }
      return next;
    });
  };

  // Keyboard shortcuts (Space = play/pause)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlePlayPause]);

  // ── Sprint B Phase 5.3 — accept track drops from MusicCreator ────
  const [isDragOver, setIsDragOver] = useState(false);
  const handleTrackDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types || []);
    if (!types.includes('application/x-juli3ta-track')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);
  const handleTrackDragLeave = useCallback(() => setIsDragOver(false), []);
  const handleTrackDrop = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData('application/x-juli3ta-track');
      if (!raw) return;
      e.preventDefault();
      setIsDragOver(false);
      try {
        const t = JSON.parse(raw) as { id?: string };
        if (typeof t?.id !== 'string') return;
        const idx = tracks.findIndex((tk) => tk.id === t.id);
        if (idx < 0) return; // not in this player's gallery (yet) — silently
        setCurrentIndex(idx);
        setIsPlaying(true);
      } catch {
        /* ignore */
      }
    },
    [tracks],
  );

  // ── Render ────────────────────────────────────────────────────────

  // Empty state — no tracks at all.
  if (tracks.length === 0 || !currentTrack) {
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--bg-window)' }}>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <img
            src="/brand/juli3ta/icon-gradient-256.png"
            alt="JULI3TA"
            width={96}
            height={96}
            draggable={false}
            style={{
              width: 96, height: 96,
              borderRadius: 'var(--radius-2xl)',
              marginBottom: 16,
              opacity: 0.85,
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Your library is empty
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, maxWidth: 320 }}>
            Generate a song with <strong>JULI3TA</strong> or import local audio
            files to start listening.
          </div>
          <div className="flex items-center gap-2 mt-5">
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
              Import audio
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            onChange={handleFiles}
            style={{ display: 'none' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full relative overflow-hidden"
      style={{
        background: 'var(--bg-window)',
        outline: isDragOver ? '2px solid var(--accent-primary)' : 'none',
        outlineOffset: -2,
      }}
      onDragOver={handleTrackDragOver}
      onDragLeave={handleTrackDragLeave}
      onDrop={handleTrackDrop}
    >
      {/* Album Art Area */}
      <div className="flex flex-col items-center pt-6 pb-4">
        <div
          className="flex items-center justify-center rounded-xl mb-4 transition-transform overflow-hidden"
          style={{
            width: 200, height: 200,
            background: currentTrack.coverDataUrl
              ? `url(${currentTrack.coverDataUrl}) center/cover no-repeat`
              : 'linear-gradient(135deg, #7B43C9 0%, #C8377E 55%, #F08A4B 100%)',
            boxShadow: 'var(--shadow-lg)',
            animation: isPlaying ? 'pulse 2s infinite' : 'none',
          }}
        >
          {!currentTrack.coverDataUrl && (
            currentTrack.source === 'juli3ta'
              ? <img
                  src="/brand/juli3ta/mark-cream-256.png"
                  alt=""
                  width={120}
                  height={120}
                  draggable={false}
                  style={{ width: 120, height: 120, opacity: 0.9, userSelect: 'none', pointerEvents: 'none' }}
                />
              : <Music size={80} style={{ color: 'rgba(255,255,255,0.3)' }} />
          )}
        </div>

        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>
          {currentTrack.title}
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {currentTrack.artist}
        </p>
        <p style={{ fontSize: '11px', color: 'var(--text-disabled)', marginTop: '1px' }}>
          {currentTrack.album}
        </p>
      </div>

      {/* Visualizer */}
      <div className="px-6 mb-2">
        <VisualizerBars isPlaying={isPlaying} />
      </div>

      {/* Progress Bar — uses REAL duration from <audio> metadata */}
      <div className="px-6 mb-2">
        <input
          type="range"
          min={0}
          max={duration || currentTrack.duration || 1}
          value={currentTime}
          onChange={handleSeek}
          className="w-full"
          style={{ accentColor: 'var(--accent-primary)', height: 4 }}
        />
        <div className="flex justify-between mt-1">
          <span style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>{formatTime(currentTime)}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>
            {formatTime(duration || currentTrack.duration)}
          </span>
        </div>
      </div>

      {/* Error banner (autoplay block, decode error, etc.) */}
      {error && (
        <div
          className="mx-6 mb-2 px-3 py-1.5 rounded-md"
          style={{ fontSize: 11, color: '#ff8a80', background: 'rgba(255,82,82,0.08)' }}
        >
          {error}
        </div>
      )}

      {/* Controls Row */}
      <div className="flex items-center justify-center gap-5 px-6 py-2">
        <button
          onClick={() => setIsShuffle((s) => !s)}
          className="transition-all hover:scale-110"
          style={{ color: isShuffle ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
        >
          <Shuffle size={20} />
        </button>
        <button onClick={handlePrev} className="transition-all hover:scale-110" style={{ color: 'var(--text-primary)' }}>
          <SkipBack size={28} />
        </button>
        <button
          onClick={handlePlayPause}
          className="flex items-center justify-center rounded-full transition-all hover:scale-105"
          style={{
            width: 56, height: 56,
            background: 'var(--accent-primary)', color: 'white',
          }}
        >
          {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
        </button>
        <button onClick={handleNext} className="transition-all hover:scale-110" style={{ color: 'var(--text-primary)' }}>
          <SkipForward size={28} />
        </button>
        <button
          onClick={toggleRepeat}
          className="transition-all hover:scale-110"
          style={{ color: repeatMode !== 'off' ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
        >
          {repeatMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
        </button>
      </div>

      {/* Volume + Playlist + Import row */}
      <div className="flex items-center justify-between px-6 py-2 pb-4">
        <div className="flex items-center gap-2 flex-1">
          <button onClick={() => setVolume(v => v === 0 ? 0.7 : 0)} className="transition-all" style={{ color: 'var(--text-secondary)' }}>
            {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={handleVolumeChange}
            className="flex-1"
            style={{ accentColor: 'var(--accent-primary)', height: 4, maxWidth: 100 }}
          />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handlePickFiles}
            className="flex items-center justify-center rounded-lg transition-all hover:bg-[var(--bg-hover)]"
            style={{ width: 32, height: 32, color: 'var(--text-secondary)' }}
            title="Import local audio"
          >
            <Upload size={18} />
          </button>
          <button
            onClick={() => setShowPlaylist((s) => !s)}
            className="flex items-center justify-center rounded-lg transition-all hover:bg-[var(--bg-hover)]"
            style={{ width: 32, height: 32, color: showPlaylist ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
            title={`Playlist (${tracks.length})`}
          >
            <ListMusic size={20} />
          </button>
        </div>
      </div>

      {/* The actual audio element */}
      <audio ref={audioRef} src={currentTrack.src} preload="metadata" />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={handleFiles}
        style={{ display: 'none' }}
      />

      {/* Playlist Panel */}
      {showPlaylist && (
        <div
          className="absolute bottom-0 left-0 right-0 z-10 overflow-y-auto invisible-scrollbar"
          style={{
            height: '60%',
            background: 'var(--bg-titlebar)',
            borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
            paddingBottom: 96,
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 sticky top-0"
            style={{ background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Playlist</span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{tracks.length} tracks</span>
          </div>
          {tracks.map((track, i) => (
            <div
              key={track.id}
              onClick={() => { setCurrentIndex(i); setCurrentTime(0); setIsPlaying(true); }}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all group"
              style={{
                background: i === currentIndex ? 'var(--bg-selected)' : 'transparent',
                borderLeft: i === currentIndex ? '3px solid var(--accent-primary)' : '3px solid transparent',
              }}
            >
              {track.coverDataUrl ? (
                <div
                  className="rounded-md flex-shrink-0"
                  style={{
                    width: 28,
                    height: 28,
                    background: `url(${track.coverDataUrl}) center/cover no-repeat`,
                    border: '1px solid var(--border-subtle)',
                  }}
                />
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--text-disabled)', width: 20, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {i === currentIndex && isPlaying
                    ? <Music size={12} style={{ color: 'var(--accent-primary)' }} />
                    : track.source === 'juli3ta'
                      ? <img
                          src="/brand/juli3ta/mark-ink-32.png"
                          alt=""
                          width={14}
                          height={14}
                          draggable={false}
                          style={{ width: 14, height: 14, opacity: 0.85, userSelect: 'none', pointerEvents: 'none' }}
                        />
                      : i + 1}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ fontSize: '13px', fontWeight: i === currentIndex ? 600 : 400, color: 'var(--text-primary)' }}>
                  {track.title}
                </div>
                <div className="truncate" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {track.artist}
                </div>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-disabled)', flexShrink: 0 }}>
                {track.duration > 0 ? formatTime(track.duration) : '—'}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemoveTrack(i); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-secondary)' }}
                title="Remove from playlist"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
