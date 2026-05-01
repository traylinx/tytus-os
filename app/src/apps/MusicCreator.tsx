// ============================================================
// Music Creator — AI song + lyrics generator
// ============================================================
//
// Layout mirrors the MusicPlayer aesthetic (gradient album art,
// purple accent, Lucide icons) but adds a creator pane on the
// left and a "My Work" gallery on the right.
//
// Flow:
//   1. /v1/music/lyrics  → song_title + lyrics
//   2. /v1/music/generations (model: discovered from /v1/models) → base64 MP3
//   3. Save MP3 + metadata to localStorage gallery
//   4. Real <audio> playback in the gallery row
//
// Model names are NOT hardcoded — different deployments register different
// aliases (a remote Tytus pod may expose `ail-music`, while local
// switchAILocal exposes `minimax:music-2.6`). At endpoint resolution time
// we hit `/v1/models` and pick the first id that matches a music regex.
// If no match, music generation is disabled for that endpoint.
//
// Talks directly to the pod's public Tytus URL — CORS is
// `Access-Control-Allow-Origin: *` so the browser can call it
// without a daemon proxy hop. If the user has no pod allocated,
// we surface an empty-state pointing them at PodInspector.

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import {
  Sparkles, Wand2, Loader2, Play, Pause, Download,
  Trash2, AlertCircle, FileMusic, Shuffle, Plus, Mic, Disc3,
  HelpCircle, Square, MonitorSpeaker, Layers, ChevronDown, Check,
  Settings2, X, Monitor, MoreVertical, NotebookText, Music2, Search,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import JulietaHelp from './JulietaHelp';
import { Switch } from '@/components/ui/switch';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useShellMenuRegistration } from '@/hooks/useShellMenu';
import { useCurrentWindow } from '@/hooks/useCurrentWindow';
import { useFileSystem, getIconForFileName } from '@/hooks/useFileSystem';
import { useOS, useNotifications } from '@/hooks/useOSStore';
import { useI18n } from '@/i18n';
import {
  listTracks,
  getTrackById,
  insertTrack as insertTrackRow,
  deleteTrack as deleteTrackRow,
  loadSettings as loadCreatorSettings,
  saveSettings as saveCreatorSettings,
  type MusicCreatorSettings,
  type ModelOverrides,
  DEFAULT_SETTINGS as DEFAULT_CREATOR_SETTINGS,
} from '@/lib/repo/musicCreator';
import {
  listRecordings,
  insertRecording,
  migrateLegacyRecordingsToSqlite,
  type VoiceRecordingRow,
} from '@/lib/repo/voiceRecordings';
import { revealSecret } from '@/lib/secrets';
import { buildCoverSample, buildIconicMix } from '@/lib/coverSample';
import type { Agent, IncludedPod } from '@/types/daemon';

// Voice Recorder rows come from the SQLite repo. Aliased here to keep
// existing call sites simple — `VoiceRecording` was the in-file type
// before the localStorage→SQLite migration.
type VoiceRecording = VoiceRecordingRow;

// ──────────────────────────────────────────────────────────
// Cross-app drag MIME types
// ──────────────────────────────────────────────────────────
//
// Tytus OS apps swap structured data via custom dataTransfer MIME
// types — the same trick a real desktop OS uses (think
// `application/x-apple-pasteboard-promised-file` on macOS). Anyone
// can read `text/plain`, but tracks carry a JSON payload that lets
// the receiver pull lyrics, audio, and metadata out without a
// shared store.
const MIME_TRACK = 'application/x-juli3ta-track';

// Slim drag payload — title + lyrics + a `hasAudio` flag. The actual
// audio data URL is NOT carried in the payload because base64 MP3s are
// MB-scale and chunking that into `dataTransfer` blocks the main thread
// and silently fails cross-app paste on most browsers. Drop targets that
// need the audio bytes resolve them by id from SQLite via getTrackById().
interface DraggedTrackPayload {
  id: string;
  title: string;
  styleTags: string;
  lyricsPreview: string;
  durationMs: number;
  hasAudio: boolean;
}

const sanitizeFileName = (s: string): string => {
  const trimmed = (s || 'untitled').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
  return trimmed || 'untitled';
};

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

interface SavedTrack {
  id: string;
  title: string;
  styleTags: string;
  lyricsPreview: string;
  durationMs: number;
  bitrate: number;
  sampleRate: number;
  sizeBytes: number;
  createdAt: number;
  // Audio is stored as a base64 data URL so it survives reloads.
  audioDataUrl: string;
}

interface PodEndpoint {
  url: string;        // e.g. https://...tytus.traylinx.com/v1  or  http://localhost:18080/v1
  apiKey: string;
  podId: string;
  source: 'agent' | 'included' | 'local';
  // Display label for the connection badge.
  label: string;
  // Resolved model ids for this endpoint. Different deployments expose
  // different aliases — the local switchAILocal might register
  // `minimax:music-2.6`, while a remote pod might expose `ail-music`.
  // We discover them dynamically from /v1/models and pattern-match.
  // Null means the endpoint doesn't expose a usable model for that op.
  models: DiscoveredModels;
}

// Per-task model mapping. Each music/audio-shaped op gets its own slot
// so we can fail loudly + locally when an endpoint doesn't expose the
// model we need (instead of sending a 400 to the server).
//
// `lyricsBackup` is a regular chat-completions model (gpt-style). When
// the dedicated music-lyrics path fails (quota, upstream 502, etc.) we
// fall back to chatting any general LLM with a JSON-output prompt and
// parse song_title / style_tags / lyrics out of the response.
interface DiscoveredModels {
  music: string | null;          // default song-from-lyrics generation
  cover: string | null;          // cover / style-transfer generation
  lyrics: string | null;         // dedicated /music/lyrics model id
  lyricsBackup: string | null;   // chat model used when `lyrics` errors
  allIds: readonly string[];     // full /v1/models id list — populates Settings dropdowns
}

// Local AIL fallback. switchAILocal binds to localhost:18080 by default
// with `sk-test-123` as the dev key. If the user has switchAILocal
// running, browser fetch can hit it cross-origin (CORS is `*`).
const LOCAL_AIL_URL = 'http://localhost:18080/v1';
const LOCAL_AIL_KEY = 'sk-test-123';

// Style chips — grouped by family so the list is browsable rather than
// a single uniform pile. Adds genres we were missing (Latin, electronic
// subgenres, world, classical, kids/holiday) so a 5-year-old who wants
// a cumbia or a Christmas lullaby can find it without typing.
interface StyleGroup {
  label: string;
  chips: readonly string[];
}

// Curated 16-family / ~120-genre hierarchy. Sourced from the canonical
// genre spec (popular families × representative subgenres) so the palette
// roughly mirrors how streaming services organise their catalogues. Two
// non-genre groups stay at the end (Mood, Kids/Holiday) because creators
// reach for those as descriptors more than as genres.
const STYLE_GROUPS: readonly StyleGroup[] = [
  {
    label: 'Pop & Mainstream',
    chips: [
      'Pop', 'Dance pop', 'Electropop', 'Synth-pop', 'Teen pop',
      'K-pop', 'J-pop', 'Indie pop', 'Hyperpop', 'Adult contemporary',
    ],
  },
  {
    label: 'Rock & Alternative',
    chips: [
      'Rock', 'Classic rock', 'Hard rock', 'Alternative rock', 'Indie rock',
      'Garage rock', 'Psychedelic rock', 'Progressive rock', 'Post-rock',
      'Grunge', 'Britpop', 'Shoegaze',
    ],
  },
  {
    label: 'Metal',
    chips: [
      'Heavy metal', 'Hard rock / Metal', 'Thrash metal', 'Power metal',
      'Progressive metal', 'Death metal', 'Black metal', 'Metalcore',
      'Nu metal', 'Symphonic metal',
    ],
  },
  {
    label: 'Punk & Hardcore',
    chips: [
      'Punk', 'Pop punk', 'Hardcore punk', 'Post-punk', 'Emo / emocore',
      'Skate punk', 'Crust punk', 'Post-hardcore',
    ],
  },
  {
    label: 'Indie, Lo-Fi & Singer-Songwriter',
    chips: [
      'Indie', 'Lo-fi', 'Lo-fi hip-hop', 'Bedroom pop', 'Singer-songwriter',
      'Acoustic', 'Folk rock', 'Dream pop',
    ],
  },
  {
    label: 'Hip-Hop & Rap',
    chips: [
      'Hip-hop / Rap', 'Boom bap', 'Trap', 'Drill', 'Gangsta rap',
      'Conscious rap', 'Cloud rap', 'Emo rap', 'Latin trap',
      'Old-school hip-hop', 'Alternative hip-hop', 'Underground hip-hop',
    ],
  },
  {
    label: 'R&B, Soul & Funk',
    chips: [
      'R&B', 'Contemporary R&B', 'Soul', 'Neo-soul', 'Motown / Classic soul',
      'Funk', 'Disco', 'Quiet storm', 'New jack swing', 'Urban contemporary',
    ],
  },
  {
    label: 'Electronic & Dance',
    chips: [
      'Electronic', 'EDM', 'House', 'Deep house', 'Tech house',
      'Progressive house', 'Electro house', 'Techno', 'Minimal techno',
      'Trance', 'Progressive trance', 'Psytrance', 'Drum and bass', 'Jungle',
      'Breakbeat', 'UK garage', 'Future bass', 'Dubstep', 'Brostep',
      'Chillout', 'Ambient', 'Downtempo', 'Synthwave / Retrowave',
    ],
  },
  {
    label: 'Latin & Caribbean',
    chips: [
      'Latin', 'Latin pop', 'Reggaeton', 'Latin trap', 'Regional Mexican',
      'Corridos tumbados', 'Banda', 'Salsa', 'Bachata', 'Merengue',
      'Cumbia', 'Latin rock',
    ],
  },
  {
    label: 'Reggae, Dub & Dancehall',
    chips: [
      'Reggae', 'Roots reggae', 'Dancehall', 'Dub', 'Reggae fusion',
    ],
  },
  {
    label: 'African & Global Fusion',
    chips: [
      'Afrobeats', 'Afrobeat', 'Amapiano', 'Afro-house', 'Highlife',
      'Afro-pop', 'World / Global fusion', 'Afro-Latin fusion',
    ],
  },
  {
    label: 'Country, Folk & Americana',
    chips: [
      'Country', 'Classic country', 'Contemporary country', 'Country pop',
      'Outlaw country', 'Americana', 'Bluegrass', 'Folk',
      'Contemporary folk', 'Celtic folk', 'Country rock',
    ],
  },
  {
    label: 'Jazz',
    chips: [
      'Jazz', 'Smooth jazz', 'Swing / Big band', 'Bebop', 'Cool jazz',
      'Latin jazz', 'Jazz fusion', 'Acid jazz', 'Nu jazz',
      'Lounge / Jazz lounge',
    ],
  },
  {
    label: 'Blues & Roots',
    chips: [
      'Blues', 'Electric blues', 'Delta blues', 'Blues rock', 'Roots rock',
    ],
  },
  {
    label: 'Urban Latino',
    chips: [
      'Urbano Latino', 'Dembow', 'Perreo', 'Moombahton', 'Latin drill',
    ],
  },
  {
    label: 'Classical & Cinematic',
    chips: [
      'Classical', 'Orchestral', 'Chamber music', 'Symphonic', 'Solo piano',
      'Film score / Soundtrack', 'Trailer music / Epic orchestral',
      'Contemporary classical / Minimalism',
    ],
  },
  {
    label: 'Religious & Inspirational',
    chips: [
      'Gospel', 'Contemporary Christian', 'Worship', 'Christian rock',
      'Inspirational',
    ],
  },
  {
    label: 'Experimental & Avant-Garde',
    chips: [
      'Experimental', 'Noise', 'Avant-garde', 'Industrial',
      'IDM (Intelligent dance music)',
    ],
  },
  {
    label: 'Mood & Vibe',
    chips: [
      'Driving', 'Sentimental', 'Energetic', 'Dreamy', 'Dark',
      'Uplifting', 'Melancholic', 'Heroic', 'Romantic', 'Epic',
      'Chill', 'Aggressive', 'Nostalgic', 'Mysterious', 'Playful',
    ],
  },
  {
    label: 'Kids & Holiday',
    chips: [
      'Lullaby', "Children's", 'Birthday', 'Christmas', 'Carnival',
      'Marching band',
    ],
  },
];
// Flat list — used for the palette header counter ("56 chips · click to
// add") and for legacy "surprise me" sampling.
const STYLE_PRESETS: readonly string[] = STYLE_GROUPS.flatMap((g) => g.chips);

const LYRIC_TEMPLATES = [
  '[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Verse]\n\n[Chorus]\n\n[Bridge]\n\n[Outro]',
  '[Verse]\n\n[Chorus]\n\n[Verse]\n\n[Chorus]\n\n[Outro]',
  '[Inst]\n\n[Verse]\n\n[Chorus]\n\n[Inst]\n\n[Outro]',
];

// Legacy storage keys — gallery was briefly in localStorage (quota
// exploded), then briefly in IndexedDB. Both get drained into SQLite on
// first run and removed. Keys kept here so the migration can find them.
const LEGACY_LS_KEY = 'tytus.music-creator.gallery';
const LEGACY_IDB_NAME = 'tytus.music-creator';
const LEGACY_IDB_STORE = 'gallery';
const MAX_LYRICS = 3500;
const MAX_STYLE = 2000;

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

const formatTime = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// One-shot migration of any pre-existing tracks (localStorage v1 OR
// IndexedDB v2) into SQLite. Idempotent — safe to call every load; once
// drained the legacy stores are deleted so the migration no-ops forever.
const migrateLegacyTracksToSqlite = async (): Promise<void> => {
  // Phase 1: drain localStorage (the very-first prototype storage).
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const track of parsed as SavedTrack[]) {
          try { await insertTrackRow(track); } catch { /* skip */ }
        }
      }
      localStorage.removeItem(LEGACY_LS_KEY);
    }
  } catch (e) {
    console.warn('Legacy localStorage gallery migration failed:', e);
  }

  // Phase 2: drain IndexedDB (the brief intermediate storage).
  try {
    const tracks = await new Promise<SavedTrack[]>((resolve) => {
      const req = indexedDB.open(LEGACY_IDB_NAME);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEGACY_IDB_STORE)) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction(LEGACY_IDB_STORE, 'readonly');
        const getAll = tx.objectStore(LEGACY_IDB_STORE).getAll();
        getAll.onsuccess = () => {
          db.close();
          resolve((getAll.result ?? []) as SavedTrack[]);
        };
        getAll.onerror = () => { db.close(); resolve([]); };
      };
      req.onerror = () => resolve([]);
    });
    for (const track of tracks) {
      try { await insertTrackRow(track); } catch { /* skip */ }
    }
    if (tracks.length > 0) {
      indexedDB.deleteDatabase(LEGACY_IDB_NAME);
    }
  } catch (e) {
    console.warn('Legacy IDB gallery migration failed:', e);
  }
};

// Empty model map — unresolved candidates start here, get filled in by
// `discoverModels` after the endpoint passes its reachability probe.
const NO_MODELS: DiscoveredModels = {
  music: null, cover: null, lyrics: null, lyricsBackup: null, allIds: [],
};

// Static candidate list — we'll race them with a HEAD probe to pick the
// fastest reachable one (remote first, local fallback).
const buildCandidates = (
  agents: readonly Agent[],
  included: readonly IncludedPod[],
): PodEndpoint[] => {
  const out: PodEndpoint[] = [];
  for (const a of agents) {
    if (a.public_url && a.user_key) {
      out.push({
        url: `${a.public_url.replace(/\/$/, '')}/v1`,
        apiKey: revealSecret(a.user_key, 'user_gesture'),
        podId: a.pod_id,
        source: 'agent',
        label: `AIL pod ${a.pod_id}`,
        models: NO_MODELS,
      });
    }
  }
  for (const p of included) {
    if (p.public_url && p.user_key) {
      out.push({
        url: `${p.public_url.replace(/\/$/, '')}/v1`,
        apiKey: revealSecret(p.user_key, 'user_gesture'),
        podId: p.pod_id,
        source: 'included',
        label: `AIL pod ${p.pod_id}`,
        models: NO_MODELS,
      });
    }
  }
  // Always include the local AIL gateway as the last-resort fallback.
  // If switchAILocal is running on this machine, browser fetch reaches
  // it through CORS (Access-Control-Allow-Origin: *).
  out.push({
    url: LOCAL_AIL_URL,
    apiKey: LOCAL_AIL_KEY,
    podId: 'local',
    source: 'local',
    label: 'Local AIL',
    models: NO_MODELS,
  });
  return out;
};

// Pattern-based mapping from /v1/models output to the per-task ids this
// endpoint exposes. We support every alias convention we've seen:
//   - `minimax:music-2.6` / `minimax:music-cover` / `minimax:music-lyrics` (switchAILocal)
//   - `minimax/minimax:music-2.6`                                          (provider-prefixed)
//   - `ail-music` / `ail-music-cover` / `ail-music-lyrics`                 (legacy AIL alias)
//   - `music-2.6` / `music-cover` / `music-lyrics`                         (bare)
//
// Resolution order matters: cover + lyrics are picked FIRST and removed
// from the music pool, otherwise the more specific ids would also match
// the loose `/music/` fallback meant for default song generation.
const pickModels = (ids: readonly string[]): DiscoveredModels => {
  const findIn = (
    pool: readonly string[],
    preferred: readonly RegExp[],
  ): string | null => {
    const lower = pool.map((id) => id.toLowerCase());
    for (const pat of preferred) {
      const i = lower.findIndex((id) => pat.test(id));
      if (i >= 0) return pool[i];
    }
    return null;
  };

  const cover = findIn(ids, [
    /(^|[/:])minimax:music-cover$/,
    /(^|[/:])ail-music-cover$/,
    /music[-_:]cover/,
    /cover.*music/,
  ]);

  const lyrics = findIn(ids, [
    /(^|[/:])minimax:music-lyrics$/,
    /(^|[/:])ail-music-lyrics$/,
    /music[-_:]lyrics/,
    /lyrics[-_:]?generat/,   // minimax lyrics_generation alias if exposed
    /lyrics.*music/,
    /(^|[/:])lyrics$/,
    /lyric/i,                 // last-resort: anything containing "lyric"
  ]);

  // Music = anything music-shaped that isn't already claimed by cover/lyrics.
  const claimed = new Set([cover, lyrics].filter((x): x is string => !!x));
  const remaining = ids.filter((id) => !claimed.has(id));
  const music = findIn(remaining, [
    /(^|[/:])minimax:music-2\.6$/,
    /(^|[/:])ail-music$/,
    /(^|[/:])music-2\.6$/,
    /music/,  // last-resort: any remaining music-tagged id
  ]);

  // Chat-completions backup. Used when the dedicated lyrics endpoint
  // errors (quota, upstream 502). Excludes anything music/audio/embed
  // shaped — we want a generalist text model. Prefer the well-known
  // ail-* aliases, then anything that looks chat-shaped.
  const isMusicy = (id: string) =>
    /music|cover|tts|stt|transcribe|whisper|embed|image/i.test(id);
  const chatPool = ids.filter((id) => !isMusicy(id));
  const lyricsBackup = findIn(chatPool, [
    /(^|[/:])ail-compound$/,
    /(^|[/:])ail-fast$/,
    /(^|[/:])ail-search$/,
    /(^|[/:])ail-kimi$/,
    /(^|[/:])minimax:m2\.7$/,
    /(^|[/:])gpt-/i,
    /(^|[/:])claude/i,
    /chat/i,
    /./,  // last-resort: any non-music id at all
  ]);

  return { music, cover, lyrics, lyricsBackup, allIds: ids };
};

// Combined reachability + discovery in a single call to /v1/models.
//
// We previously probed `/v1/music/lyrics`, but that endpoint can 502 on
// otherwise-healthy gateways (the upstream music provider can flap
// independently from the gateway), which would cause the entire creator
// to render the "no stage" empty state when local AIL was actually fine.
//
// /v1/models is the canonical OpenAI-compatible "are you alive" probe,
// and the response body IS the discovery payload — one round-trip
// instead of two.
//
// We accept any non-5xx response as "the gateway is up". 401 still
// surfaces the endpoint so the user can fix their key in Settings.
//
// Session cache for URLs that throw a TypeError on fetch — almost
// always a CORS preflight failure (no `Access-Control-Allow-Origin`).
// Once we know a URL is browser-unreachable we stop probing it, which
// keeps the console clean on every daemon-state re-render.
const corsBlocked = new Set<string>();

const probeAndDiscover = async (
  cand: PodEndpoint,
  signal: AbortSignal,
): Promise<{ ok: boolean; models: DiscoveredModels }> => {
  if (corsBlocked.has(cand.url)) {
    return { ok: false, models: NO_MODELS };
  }
  // PROBE_TIMEOUT_MS guards against a hung pod that accepts the TCP
  // connection but never responds — without it the resolving spinner
  // would sit forever and the user couldn't switch endpoints.
  const probeTimeout = withTimeout(signal, PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${cand.url}/models`, {
      method: 'GET',
      signal: probeTimeout.signal,
      headers: { Authorization: `Bearer ${cand.apiKey}` },
    });
    if (r.status >= 500) return { ok: false, models: NO_MODELS };
    if (!r.ok) return { ok: true, models: NO_MODELS };
    const data = (await r.json()) as { data?: Array<{ id?: string }> };
    const ids = (data.data ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return { ok: true, models: pickModels(ids) };
  } catch (e) {
    // TypeError = network-layer failure. Most often that's a CORS
    // preflight rejection — the pod gateway didn't return the
    // Access-Control-Allow-Origin header for our origin. AbortError
    // means the user navigated away; don't pollute the cache.
    // TimeoutError = pod hung; treat like unreachable (no cache, so a
    // retry will probe again — flap is recoverable).
    const name = (e as Error)?.name ?? '';
    if (name === 'TypeError') corsBlocked.add(cand.url);
    return { ok: false, models: NO_MODELS };
  } finally {
    probeTimeout.dispose();
  }
};

// Resolve ALL candidates in parallel. Each survivor gets its model map
// filled from `/v1/models`. The UI uses this list to render a picker
// when more than one endpoint is live.
const resolveAllLiveEndpoints = async (
  candidates: PodEndpoint[],
  signal: AbortSignal,
): Promise<PodEndpoint[]> => {
  const results = await Promise.all(
    candidates.map(async (cand) => {
      if (signal.aborted) return null;
      const { ok, models } = await probeAndDiscover(cand, signal);
      if (!ok) return null;
      return { ...cand, models };
    }),
  );
  return results.filter((c): c is PodEndpoint => c !== null);
};

// ──────────────────────────────────────────────────────────
// API calls
// ──────────────────────────────────────────────────────────

// Per-request timeouts. A hung gateway used to leave the UI busy
// forever — only Cancel got the user out. These compose with the user
// signal so Cancel still wins, but a stalled fetch self-aborts at the
// timeout boundary and surfaces a real error.
const LYRICS_TIMEOUT_MS = 60_000;   // /music/lyrics is text — fast.
const MUSIC_TIMEOUT_MS = 180_000;   // /music/generations — up to ~2 min on cold.
const PROBE_TIMEOUT_MS = 8_000;     // /v1/models reachability probe — must be quick.

// Combine an optional user-driven AbortSignal with a wall-clock timeout.
// Falls back to a manual controller when the runtime doesn't expose
// AbortSignal.any (Safari < 17.4). Returns the combined signal plus a
// dispose() that clears the timer so the test runner doesn't leak.
const withTimeout = (
  user: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; dispose: () => void } => {
  // Modern path — AbortSignal.timeout + AbortSignal.any when available.
  const anyImpl = (AbortSignal as unknown as { any?: (sigs: AbortSignal[]) => AbortSignal }).any;
  const timeoutImpl = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  if (anyImpl && timeoutImpl) {
    const t = timeoutImpl(ms);
    const combined = user ? anyImpl([user, t]) : t;
    return { signal: combined, dispose: () => undefined };
  }
  // Fallback — manual controller bridges either trigger.
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    if (!ctrl.signal.aborted) ctrl.abort(new DOMException('Timeout', 'TimeoutError'));
  }, ms);
  if (user) {
    if (user.aborted) ctrl.abort(user.reason);
    else user.addEventListener('abort', () => ctrl.abort(user.reason), { once: true });
  }
  return { signal: ctrl.signal, dispose: () => clearTimeout(timer) };
};

interface LyricsResponse {
  song_title: string;
  style_tags: string;
  lyrics: string;
}

interface MusicResponse {
  data: {
    audio: string;       // base64 MP3
    duration_ms: number;
    bitrate: number;
    sample_rate: number;
    channels: number;
    format: string;
    size_bytes: number;
  };
  model: string;
  trace_id: string;
}

// Try the dedicated /music/lyrics endpoint first. If it errors with a
// retryable status (429 / 5xx / network), transparently fall back to a
// general chat-completions model with a JSON-output prompt. Hard 4xx
// errors (400/401/403/404) surface directly — they almost always
// indicate a config bug (wrong key, missing model, malformed body) that
// the chat fallback can't fix and would only burn a second API call on.
//
// Returns `{ usedFallback: true }` so the caller can surface a notice.
const RETRYABLE_LYRICS_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const callLyrics = async (
  endpoint: PodEndpoint,
  prompt: string,
  signal?: AbortSignal,
): Promise<LyricsResponse & { usedFallback: boolean }> => {
  // ── Primary: /music/lyrics ─────────────────────────────
  // Track outcome out-of-band so we can branch cleanly after the try.
  // 0 = network failure (fall through), >0 = HTTP status from upstream.
  let primaryStatus = 0;
  let primaryBody = '';
  const primaryTimeout = withTimeout(signal, LYRICS_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = { prompt, mode: 'write_full_song' };
    if (endpoint.models.lyrics) body.model = endpoint.models.lyrics;
    const r = await fetch(`${endpoint.url}/music/lyrics`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: primaryTimeout.signal,
    });
    if (r.ok) {
      const data = (await r.json()) as LyricsResponse;
      // Trust-but-verify the response shape. A gateway returning
      // 200 + {error: ...} would otherwise propagate undefined lyrics
      // and crash the music step with a confusing "lyrics is required".
      if (!data || typeof data.lyrics !== 'string' || data.lyrics.trim().length === 0) {
        throw new Error('Lyrics endpoint returned 200 but no lyrics text.');
      }
      return { ...data, usedFallback: false };
    }
    primaryStatus = r.status;
    primaryBody = await r.text().catch(() => '');
  } catch (e) {
    const name = (e as Error).name;
    // Re-raise user cancellations so the caller can distinguish them
    // from upstream failures. TimeoutError surfaces as a real error.
    if (name === 'AbortError' && signal?.aborted) throw e;
    if (name === 'TimeoutError') {
      throw new Error(`Lyrics request timed out after ${LYRICS_TIMEOUT_MS / 1000}s. Check your pod / pick another endpoint in Settings.`);
    }
    // TypeError / DOMException etc — primaryStatus stays 0, fall
    // through to the chat backup below.
    console.warn('Lyrics primary threw (network), falling back to chat:', e);
  } finally {
    primaryTimeout.dispose();
  }

  // Hard 4xx → don't burn a second call on the chat backup. These are
  // config bugs (wrong key, model not exposed, malformed body) that the
  // chat path can't fix; surfacing them directly lets the user fix the
  // config in Settings instead of paying for a wrong second answer.
  if (primaryStatus !== 0 && !RETRYABLE_LYRICS_STATUSES.has(primaryStatus)) {
    const truncated = primaryBody.length > 300 ? `${primaryBody.slice(0, 300)}…` : primaryBody;
    throw new Error(`Lyrics HTTP ${primaryStatus}: ${truncated || 'no body'}`);
  }
  if (primaryStatus !== 0) {
    console.warn(`Lyrics primary HTTP ${primaryStatus} (retryable), falling back to chat:`, primaryBody);
  }

  // ── Backup: chat-completions with JSON-output prompt ───
  const backupModel = endpoint.models.lyricsBackup;
  if (!backupModel) {
    throw new Error(
      `Lyrics endpoint failed and no chat backup model is configured for ${endpoint.label}. Pick one in Music Creator Settings.`,
    );
  }
  const sys = `You are a songwriter. Given a theme, write a complete singable song.
Respond with VALID JSON ONLY in exactly this shape, nothing else:
{
  "song_title": "Short catchy title",
  "style_tags": "comma, separated, style, hints",
  "lyrics": "[Verse]\\nFour lines\\n\\n[Chorus]\\nFour lines\\n\\n[Verse]\\nFour lines\\n\\n[Chorus]\\nFour lines\\n\\n[Bridge]\\nTwo lines\\n\\n[Outro]\\nTwo lines"
}`;
  const chatBody = {
    model: backupModel,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `Theme: ${prompt}` },
    ],
    temperature: 0.85,
    response_format: { type: 'json_object' },
  };
  const fallbackTimeout = withTimeout(signal, LYRICS_TIMEOUT_MS);
  let fallbackResp: Response;
  try {
    fallbackResp = await fetch(`${endpoint.url}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chatBody),
      signal: fallbackTimeout.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') {
      throw new Error(`Lyrics backup model timed out after ${LYRICS_TIMEOUT_MS / 1000}s.`);
    }
    throw e;
  } finally {
    fallbackTimeout.dispose();
  }
  if (!fallbackResp.ok) {
    const errBody = await fallbackResp.text().catch(() => '');
    throw new Error(`Lyrics fallback HTTP ${fallbackResp.status}: ${errBody.slice(0, 300)}`);
  }
  const data = (await fallbackResp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('Lyrics fallback returned empty content');
  // Some chat models wrap JSON in ```json ... ``` fences — strip if present.
  const stripped = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let parsed: LyricsResponse;
  try {
    parsed = JSON.parse(stripped) as LyricsResponse;
  } catch {
    throw new Error(`Lyrics fallback returned non-JSON content: ${content.slice(0, 200)}`);
  }
  if (!parsed.lyrics) throw new Error('Lyrics fallback JSON missing "lyrics" field');
  return {
    song_title: parsed.song_title || 'Untitled',
    style_tags: parsed.style_tags || '',
    lyrics: parsed.lyrics,
    usedFallback: true,
  };
};

const callMusic = async (
  endpoint: PodEndpoint,
  args: {
    lyrics: string;
    prompt?: string;
    instrumental?: boolean;
    // Cover-mode args. When refAudioBase64 is set, model switches to
    // ail-music-cover and the upstream uses the reference audio for
    // style transfer.
    refAudioBase64?: string;
  },
  signal?: AbortSignal,
): Promise<MusicResponse> => {
  const isCover = !!args.refAudioBase64;
  const modelId = isCover ? endpoint.models.cover : endpoint.models.music;
  if (!modelId) {
    throw new Error(
      isCover
        ? `This endpoint (${endpoint.label}) doesn't expose a music-cover model. Try a different connection.`
        : `This endpoint (${endpoint.label}) doesn't expose a music model. Try a different connection.`,
    );
  }
  const body: Record<string, unknown> = {
    model: modelId,
    lyrics: args.lyrics,
  };
  if (args.prompt) body.prompt = args.prompt;
  if (args.instrumental) body.instrumental = true;
  if (isCover) body.audio_base64 = args.refAudioBase64;

  const musicTimeout = withTimeout(signal, MUSIC_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(`${endpoint.url}/music/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: musicTimeout.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') {
      throw new Error(`Music generation timed out after ${MUSIC_TIMEOUT_MS / 1000}s. Try a shorter lyric or a different endpoint.`);
    }
    throw e;
  } finally {
    musicTimeout.dispose();
  }
  if (!r.ok) {
    const errBody = await r.text().catch(() => '');
    throw new Error(`Music HTTP ${r.status}: ${errBody.slice(0, 300)}`);
  }
  return r.json();
};

// Friendly progress copy that rotates while we wait. Every line is a
// little personality nudge so the 60-second wait feels alive.
const FUN_LYRICS_TIPS = [
  '✍️  Putting pen to paper…',
  '🎀  Looking for the perfect rhyme…',
  '📝  Stitching the chorus together…',
  '🎤  Polishing the bridge…',
];
const FUN_MUSIC_TIPS = [
  '🎹  Warming up the keys…',
  '🥁  Calling in the drums…',
  '🎻  Strings rolling in…',
  '🎚️  Mixing the perfect sauce…',
  '✨  Sprinkling some magic…',
  '🎧  Almost there — last touches…',
];

// ──────────────────────────────────────────────────────────
// Empty state — shown when no pod is allocated
// ──────────────────────────────────────────────────────────

interface EmptyStateProps {
  retrying: boolean;
  onRetry: () => void;
}

function EmptyState({ retrying, onRetry }: EmptyStateProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center" style={{ background: 'var(--bg-window)' }}>
      <div
        className="flex items-center justify-center rounded-2xl mb-5"
        style={{
          width: 96, height: 96,
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          boxShadow: '0 8px 32px rgba(124, 77, 255, 0.4)',
          animation: 'pulse 2s infinite',
        }}
      >
        <Disc3 size={44} style={{ color: 'white' }} />
      </div>
      <div
        style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        Juli3ta needs a stage
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12, maxWidth: 380, lineHeight: 1.5 }}>
        {t('musiccreator.empty.body')}
      </p>

      {/* Two-track CTA — Tytus subscribers get a one-tap retry; everyone
          else gets pointed at the website to grab a free pod. */}
      <div className="flex items-center gap-2 mt-6">
        <button
          onClick={onRetry}
          disabled={retrying}
          className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all hover:scale-[1.02] disabled:opacity-60"
          style={{
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            color: 'white',
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 4px 16px rgba(124, 77, 255, 0.3)',
          }}
        >
          {retrying ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {retrying ? 'Looking for a stage…' : 'Try again'}
        </button>
        <a
          href="https://tytus.traylinx.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all hover:bg-[var(--bg-hover)]"
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          Get Tytus →
        </a>
      </div>

      <div
        className="mt-6 px-3 py-2 rounded-lg text-left"
        style={{
          fontSize: 11,
          color: 'var(--text-disabled)',
          background: 'var(--bg-titlebar)',
          border: '1px solid var(--border-subtle)',
          maxWidth: 380,
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
          Juli3ta tries, in order:
        </div>
        <div>1. Your remote Tytus pod (best — runs in the cloud)</div>
        <div>2. Local <code>switchAILocal</code> on this machine</div>
        <div>3. This screen — when neither is reachable</div>
      </div>
    </div>
  );
}

// Standardised "field card" wrapper used by every form section. One
// place for label styling, hint position, optional counter — so all
// sections in the workspace share a single visual rhythm.
interface FieldCardProps {
  label: string;
  hint?: string;
  counter?: string;
  counterDanger?: boolean;
  className?: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}
function FieldCard({ label, hint, counter, counterDanger, className, headerExtra, children }: FieldCardProps) {
  return (
    <div
      className={`rounded-xl p-3 ${className ?? ''}`}
      style={{
        background: 'var(--bg-titlebar)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <label
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {label}
        </label>
        {(headerExtra || counter) && (
          <div className="flex items-center gap-2">
            {headerExtra}
            {counter && (
              <span
                style={{
                  fontSize: 10,
                  color: counterDanger ? '#ff5252' : 'var(--text-disabled)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {counter}
              </span>
            )}
          </div>
        )}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 6 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// Genre palette — collapsible, grouped chip browser. Sits on its own
// full-width row so Theme + Style stay balanced without being stretched
// by 56 chips. Defaults to one expanded "starter" group to keep the
// form tight on first paint; user can expand all to scan everything.
interface GenrePaletteCardProps {
  onPick: (chip: string) => void;
  disabled?: boolean;
}
function GenrePaletteCard({ onPick, disabled }: GenrePaletteCardProps) {
  const [expandAll, setExpandAll] = useState(false);
  const [activeGroup, setActiveGroup] = useState(STYLE_GROUPS[0].label);
  const [query, setQuery] = useState('');

  // Search collapses the family tabs and shows a flat result list. We
  // keep the family label as a tiny badge on each chip so users still
  // know which bucket a match came from. Empty query → original UX.
  const trimmed = query.trim().toLowerCase();
  const searching = trimmed.length > 0;
  const matches = useMemo(() => {
    if (!searching) return [] as Array<{ family: string; chip: string }>;
    const out: Array<{ family: string; chip: string }> = [];
    for (const group of STYLE_GROUPS) {
      for (const chip of group.chips) {
        if (chip.toLowerCase().includes(trimmed)) {
          out.push({ family: group.label, chip });
        }
      }
    }
    return out;
  }, [searching, trimmed]);

  return (
    <div
      className="rounded-xl p-3 mb-4"
      style={{
        background: 'var(--bg-titlebar)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label
            style={{
              fontSize: 11, fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}
          >
            Genre palette
          </label>
          <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
            {searching
              ? `${matches.length} match${matches.length === 1 ? '' : 'es'}`
              : `${STYLE_PRESETS.length} chips · click to add`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Live filter — caseless substring across all families. */}
          <div
            className="flex items-center gap-1 px-2 rounded-md"
            style={{
              height: 24,
              background: 'var(--bg-window)',
              border: `1px solid ${searching ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
            }}
          >
            <Search size={11} style={{ color: 'var(--text-disabled)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search genres…"
              className="rounded-input bg-transparent outline-none"
              style={{ fontSize: 11, color: 'var(--text-primary)', width: 140 }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="opacity-60 hover:opacity-100"
                title="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <button
            onClick={() => setExpandAll((v) => !v)}
            className="px-2 rounded-md transition-all hover:bg-[var(--bg-hover)]"
            style={{
              height: 24,
              fontSize: 10,
              color: 'var(--text-secondary)',
              background: 'var(--bg-window)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {expandAll ? 'Collapse' : 'Browse all'}
          </button>
        </div>
      </div>

      {/* Search mode: flat list of matches. Family tabs hidden — family
          comes through as a small grey badge on each chip. */}
      {searching ? (
        matches.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-disabled)', padding: '8px 4px' }}>
            No genres match “{query}”. Try a shorter word.
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            {matches.map(({ family, chip }) => (
              <ChipButton
                key={`${family}::${chip}`}
                chip={chip}
                family={family}
                onPick={onPick}
                disabled={disabled}
              />
            ))}
          </div>
        )
      ) : (
        <>
          {/* Category tabs — visible when collapsed (single group at a time). */}
          {!expandAll && (
            <div className="flex items-center gap-1 flex-wrap mb-2">
              {STYLE_GROUPS.map((group) => (
                <button
                  key={group.label}
                  onClick={() => setActiveGroup(group.label)}
                  className="px-2 rounded-md transition-all hover:bg-[var(--bg-hover)]"
                  style={{
                    height: 24,
                    fontSize: 10,
                    fontWeight: activeGroup === group.label ? 600 : 500,
                    color: activeGroup === group.label ? 'var(--text-primary)' : 'var(--text-secondary)',
                    background: activeGroup === group.label ? 'var(--bg-selected)' : 'var(--bg-window)',
                    border: `1px solid ${activeGroup === group.label ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  }}
                >
                  {group.label}
                </button>
              ))}
            </div>
          )}

          {/* Chips — either the active group only, or every group laid out
              in a multi-column grid that uses the horizontal space cleanly. */}
          {expandAll ? (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
            >
              {STYLE_GROUPS.map((group) => (
                <div key={group.label}>
                  <div
                    style={{
                      fontSize: 9, fontWeight: 600, letterSpacing: 0.5,
                      color: 'var(--text-disabled)', textTransform: 'uppercase',
                      marginBottom: 4,
                    }}
                  >
                    {group.label}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {group.chips.map((chip) => (
                      <ChipButton key={chip} chip={chip} onPick={onPick} disabled={disabled} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1 flex-wrap">
              {(STYLE_GROUPS.find((g) => g.label === activeGroup) ?? STYLE_GROUPS[0]).chips.map((chip) => (
                <ChipButton key={chip} chip={chip} onPick={onPick} disabled={disabled} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChipButton({
  chip, family, onPick, disabled,
}: {
  chip: string;
  family?: string; // shown only in search results so users can see which bucket the match came from
  onPick: (c: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onPick(chip)}
      disabled={disabled}
      className="flex items-center gap-1 px-2 py-1 rounded-full transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
      style={{
        fontSize: 10,
        color: 'var(--text-secondary)',
        background: 'var(--bg-window)',
        border: '1px solid var(--border-subtle)',
      }}
      title={family}
    >
      <Plus size={10} />
      {chip}
      {family && (
        <span style={{ fontSize: 9, color: 'var(--text-disabled)', marginLeft: 2 }}>
          · {family}
        </span>
      )}
    </button>
  );
}

// One colour: green = endpoint reachable + has a usable music model.
// Amber = reachable but no model match (still usable for some flows).
// We pick the colour from the endpoint's discovered models rather than
// from `source`, because what matters to the user is "can I make music
// with this connection" — not "is this remote vs local".
const STATUS_OK = '#4ade80';        // green
const STATUS_PARTIAL = '#fbbf24';   // amber
const endpointStatusColor = (ep: PodEndpoint): string =>
  ep.models.music || ep.models.cover ? STATUS_OK : STATUS_PARTIAL;

// Connection badge / picker. When only one endpoint is live we render
// a static pill. With more than one we render a dropdown so the user
// can choose between (e.g.) their remote Tytus pod and the local
// switchAILocal — exactly the pattern Sebastian asked for.
interface ConnectionBadgeProps {
  endpoint: PodEndpoint;
  endpoints: readonly PodEndpoint[];
  onSwitch: (podId: string) => void;
}

function ConnectionBadge({ endpoint, endpoints, onSwitch }: ConnectionBadgeProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const multi = endpoints.length > 1;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const dot = (color: string) => (
    <span
      className="rounded-full"
      style={{
        width: 6, height: 6,
        background: color, flexShrink: 0,
        boxShadow: `0 0 6px ${color}`,
      }}
    />
  );

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => multi && setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg transition-all hover:bg-[var(--bg-hover)]"
        style={{
          height: 32,
          padding: '0 10px',
          background: 'var(--bg-window)',
          border: '1px solid var(--border-subtle)',
          cursor: multi ? 'pointer' : 'default',
        }}
        title={`${endpoint.url}${endpoint.models.music ? ` · music: ${endpoint.models.music}` : ''}`}
      >
        {dot(endpointStatusColor(endpoint))}
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {endpoint.label}
        </span>
        {multi && (
          <ChevronDown
            size={12}
            style={{ color: 'var(--text-secondary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
          />
        )}
      </button>

      {multi && open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden z-50"
          style={{
            minWidth: 260,
            background: 'var(--bg-window)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {endpoints.map((ep) => {
            const active = ep.podId === endpoint.podId;
            return (
              <button
                key={ep.podId}
                onClick={() => { onSwitch(ep.podId); setOpen(false); }}
                className="w-full flex items-start gap-2 px-3 py-2 text-left transition-all hover:bg-[var(--bg-hover)]"
                style={{
                  background: active ? 'var(--bg-selected)' : 'transparent',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div className="mt-1">{dot(endpointStatusColor(ep))}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {ep.label}
                    </span>
                    {active && <Check size={11} style={{ color: 'var(--accent-primary)' }} />}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-disabled)', marginTop: 2 }}>
                    music: {ep.models.music ?? '—'} · cover: {ep.models.cover ?? '—'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Track card — gallery row with real audio playback
// ──────────────────────────────────────────────────────────

interface TrackCardProps {
  track: SavedTrack;
  onDelete: (id: string) => void;
  onLoad: (track: SavedTrack) => void;
  onOpenLyrics: (track: SavedTrack) => void;
  onSaveSongToDesktop: (track: SavedTrack) => void;
  onSaveLyricsToDesktop: (track: SavedTrack) => void;
  onPlayInPlayer: (track: SavedTrack) => void;
}

interface TrackMenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

const TrackMenuItem: React.FC<TrackMenuItemProps> = ({ icon, label, onClick, danger }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-2.5 px-3 h-8 text-sm transition-colors"
    style={{
      color: danger ? 'var(--accent-error, #ff6b6b)' : 'var(--text-primary)',
      borderRadius: 'var(--radius-sm)',
      margin: '0 4px',
      width: 'calc(100% - 8px)',
      cursor: 'pointer',
      background: 'transparent',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <span className="shrink-0 opacity-80">{icon}</span>
    <span className="flex-1 text-left truncate" style={{ fontSize: 12 }}>{label}</span>
  </button>
);

// Sidebar-friendly compact track row. Used inside the slim 260px gallery
// rail — the bigger 2-column TrackCard layout doesn't fit there.
function TrackCard({
  track, onDelete, onLoad, onOpenLyrics,
  onSaveSongToDesktop, onSaveLyricsToDesktop, onPlayInPlayer,
}: TrackCardProps) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const kebabRef = useRef<HTMLButtonElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Click-outside dismissal — pop the menu shut on any window click that
  // isn't on the kebab itself or the menu portal.
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      const tgt = e.target as Node | null;
      if (kebabRef.current && tgt && kebabRef.current.contains(tgt)) return;
      if (tgt && (tgt as Element).closest?.('[data-track-menu]')) return;
      setMenu(null);
    };
    const onScroll = () => setMenu(null);
    setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [menu]);

  const openMenu = () => {
    const rect = kebabRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Anchor below-right of the kebab; clamp inside the viewport.
    const menuW = 220;
    const x = Math.min(rect.right - menuW, window.innerWidth - menuW - 8);
    const y = rect.bottom + 4;
    setMenu({ x: Math.max(8, x), y });
  };

  const callMenu = (fn: () => void) => () => { setMenu(null); fn(); };

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.currentTime / Math.max(a.duration, 0.01));
    const onEnd = () => { setPlaying(false); setProgress(0); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = track.audioDataUrl;
    link.download = `${track.title || 'track'}.mp3`;
    link.click();
  };

  // Cross-app drag — payload carries the slim metadata; receivers that
  // need the audio bytes (cover-mode field, Desktop) resolve them from
  // SQLite by id. Avoids stuffing MBs of base64 into `dataTransfer`,
  // which made cross-app paste silently fail in Chrome/Firefox.
  const handleDragStart = (e: React.DragEvent) => {
    const payload: DraggedTrackPayload = {
      id: track.id,
      title: track.title,
      styleTags: track.styleTags,
      lyricsPreview: track.lyricsPreview,
      durationMs: track.durationMs,
      hasAudio: Boolean(track.audioDataUrl),
    };
    e.dataTransfer.setData(MIME_TRACK, JSON.stringify(payload));
    if (track.lyricsPreview) {
      e.dataTransfer.setData('text/plain', track.lyricsPreview);
    }
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable
      onDragStart={handleDragStart}
      className="rounded-lg px-2 py-2 transition-all"
      style={{
        background: hover ? 'var(--bg-hover)' : 'transparent',
        border: '1px solid transparent',
        cursor: 'grab',
      }}
      title="Drag to Desktop, Cover field, Text Editor, or any text field"
    >
      <div className="flex items-center gap-2">
        {track.audioDataUrl ? (
          <button
            onClick={toggle}
            className="flex items-center justify-center rounded-md flex-shrink-0 transition-transform hover:scale-105"
            style={{
              width: 36, height: 36,
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            }}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing
              ? <Pause size={14} style={{ color: 'white' }} />
              : <Play size={14} style={{ color: 'white', marginLeft: 1 }} />}
          </button>
        ) : (
          // Lyrics-only — no audio to play. Show the lyric-sheet glyph
          // so the row reads as "this is text, not music" at a glance.
          <div
            className="flex items-center justify-center rounded-md flex-shrink-0"
            style={{
              width: 36, height: 36,
              background: 'linear-gradient(135deg, rgba(124,77,255,0.35), rgba(56,189,248,0.30))',
              border: '1px solid var(--border-subtle)',
            }}
            title={t('musiccreator.track.lyricsOnly')}
          >
            <NotebookText size={16} style={{ color: 'var(--text-primary)' }} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            {track.title || t('musiccreator.track.untitled')}
          </div>
          <div className="truncate" style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
            {track.durationMs > 0 ? formatTime(track.durationMs) : t('musiccreator.track.lyricsOnly')}
            {track.styleTags && track.styleTags !== '—' && ` · ${track.styleTags}`}
          </div>
        </div>
        {/* Single kebab keeps the title room. Hover reveals the dot subtly;
            keyboard / direct tap always works. */}
        <button
          ref={kebabRef}
          onClick={(e) => {
            e.stopPropagation();
            if (menu) setMenu(null);
            else openMenu();
          }}
          className="flex items-center justify-center rounded-md flex-shrink-0 transition-all hover:bg-[var(--bg-selected)]"
          style={{
            width: 24, height: 24,
            color: hover || menu ? 'var(--text-primary)' : 'var(--text-disabled)',
          }}
          aria-label="Track actions"
          title="Track actions"
        >
          <MoreVertical size={14} />
        </button>
      </div>

      {menu && createPortal(
        <div
          data-track-menu
          className="fixed z-[3000] py-1.5 select-none"
          style={{
            left: menu.x,
            top: menu.y,
            width: 220,
            background: 'var(--bg-context-menu)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* Audio actions — shown when the track has playable audio. */}
          {track.audioDataUrl && (
            <>
              <div style={{ padding: '4px 12px 2px', fontSize: 9, fontWeight: 600, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('musiccreator.track.section.song')}
              </div>
              <TrackMenuItem icon={<Music2 size={14} />} label={t('musiccreator.track.playInPlayer')} onClick={callMenu(() => onPlayInPlayer(track))} />
              <TrackMenuItem icon={<Monitor size={14} />} label={t('musiccreator.track.saveSongToDesktop')} onClick={callMenu(() => onSaveSongToDesktop(track))} />
              <TrackMenuItem icon={<Download size={14} />} label={t('musiccreator.track.download')} onClick={callMenu(download)} />
            </>
          )}

          {/* Lyrics actions — shown when the track has lyrics text. */}
          {track.lyricsPreview && (
            <>
              {track.audioDataUrl && (
                <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 6px' }} />
              )}
              <div style={{ padding: '4px 12px 2px', fontSize: 9, fontWeight: 600, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('musiccreator.track.section.lyrics')}
              </div>
              <TrackMenuItem icon={<NotebookText size={14} />} label={t('musiccreator.track.openInEditor')} onClick={callMenu(() => onOpenLyrics(track))} />
              <TrackMenuItem icon={<Monitor size={14} />} label={t('musiccreator.track.saveLyricsToDesktop')} onClick={callMenu(() => onSaveLyricsToDesktop(track))} />
            </>
          )}

          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 6px' }} />
          <TrackMenuItem icon={<FileMusic size={14} />} label={t('musiccreator.track.loadIntoForm')} onClick={callMenu(() => onLoad(track))} />
          <TrackMenuItem icon={<Trash2 size={14} />} label={t('musiccreator.track.delete')} onClick={callMenu(() => onDelete(track.id))} danger />
        </div>,
        document.body,
      )}

      {playing && (
        <div
          className="mt-1.5 rounded-full overflow-hidden"
          style={{ height: 2, background: 'var(--bg-hover)' }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              background: 'linear-gradient(to right, var(--accent-primary), var(--accent-secondary))',
              transition: 'width 0.25s linear',
            }}
          />
        </div>
      )}

      {track.audioDataUrl && (
        <audio ref={audioRef} src={track.audioDataUrl} preload="none" />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────

type Mode = 'compose' | 'cover' | 'lyricsOnly';

export default function MusicCreator() {
  const daemon = useDaemonStateContext();
  const { t } = useI18n();
  const currentWindow = useCurrentWindow();
  // OS-level integration: VFS for lyrics/song files, OS store for opening
  // other apps and dropping desktop icons, notifications for "saved" toasts.
  const fsApi = useFileSystem();
  const { dispatch } = useOS();
  const { addNotification } = useNotifications();

  // Mode tab — compose (default), cover (style transfer), lyrics-only.
  const [mode, setMode] = useState<Mode>('compose');
  // In-app help drawer.
  const [helpOpen, setHelpOpen] = useState(false);

  // Form state
  const [theme, setTheme] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [style, setStyle] = useState('');
  const [songName, setSongName] = useState('');
  const [instrumental, setInstrumental] = useState(false);

  // Cover-mode state
  const [refAudioName, setRefAudioName] = useState<string | null>(null);
  const [refAudioBase64, setRefAudioBase64] = useState<string | null>(null);
  const [refSampleInfo, setRefSampleInfo] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [showRecordingsPicker, setShowRecordingsPicker] = useState(false);
  // Hydrated async from SQLite (after the legacy localStorage drain in
  // the boot effect below). Starts empty so the first paint isn't blocked
  // by the migration roundtrip.
  const [voiceRecordings, setVoiceRecordings] = useState<VoiceRecording[]>([]);
  const refFileInputRef = useRef<HTMLInputElement | null>(null);
  // Cover-sample strategy: single best window OR best-of mix.
  const [sampleStrategy, setSampleStrategy] = useState<'best' | 'mix'>('best');

  // Inline recorder state (mic OR system tab audio).
  const [recOpen, setRecOpen] = useState(false);
  const [recSource, setRecSource] = useState<'mic' | 'tab'>('mic');
  const [recActive, setRecActive] = useState(false);
  const [recElapsedMs, setRecElapsedMs] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const recMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recStartRef = useRef<number>(0);
  const recTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Async state
  const [phase, setPhase] = useState<'idle' | 'lyrics' | 'song'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);

  // Gallery — backed by the OS SQLite db. Starts empty, hydrates on
  // mount (after one-shot migration of any legacy localStorage / IDB
  // tracks), every add/delete persists synchronously inside the handler
  // so a reload always shows the latest state.
  const [gallery, setGallery] = useState<SavedTrack[]>([]);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [gallerySearch, setGallerySearch] = useState('');
  // Persisted user prefs — model overrides, preferred pod, etc.
  const [creatorSettings, setCreatorSettings] = useState<MusicCreatorSettings>(DEFAULT_CREATOR_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([
        migrateLegacyTracksToSqlite(),
        migrateLegacyRecordingsToSqlite(),
      ]);
      const [loaded, prefs, recs] = await Promise.all([
        listTracks(),
        loadCreatorSettings(),
        listRecordings(),
      ]);
      if (cancelled) return;
      setGallery(loaded);
      setCreatorSettings(prefs);
      setVoiceRecordings(recs);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist a new track to SQLite, then prepend to in-memory state. If
  // the write fails (DB not ready, OPFS denied), surface the error so
  // the user knows the song won't survive a reload — it's still playable
  // for this session.
  const saveTrack = useCallback(async (track: SavedTrack) => {
    try {
      await insertTrackRow(track);
      setGalleryError(null);
    } catch (e) {
      const msg = (e as Error).message || 'Database write failed';
      setGalleryError(`Couldn't save "${track.title}" — ${msg}. Track is playable in this session only.`);
    }
    setGallery((g) => [track, ...g]);
  }, []);

  const persistSettings = useCallback(async (next: MusicCreatorSettings) => {
    setCreatorSettings(next);
    try { await saveCreatorSettings(next); }
    catch (e) { console.warn('Settings save failed:', e); }
  }, []);

  // Endpoint resolution — async chain: remote agent → remote included → local.
  const candidates = useMemo(
    () => daemon.state ? buildCandidates(daemon.state.agents, daemon.state.included) : [],
    [daemon.state],
  );
  // All reachable endpoints (with model maps populated). The active one
  // is whichever the user picked, falling back to the first survivor.
  const [endpoints, setEndpoints] = useState<PodEndpoint[]>([]);
  const [activePodId, setActivePodId] = useState<string | null>(() => {
    try { return localStorage.getItem('tytus.music-creator.preferred-pod'); }
    catch { return null; }
  });
  const [resolving, setResolving] = useState(true);

  // Pick the user's preferred pod if it's still reachable, else the first
  // live endpoint in the original priority order (agent → included → local).
  const endpoint: PodEndpoint | null =
    endpoints.find((e) => e.podId === activePodId) ?? endpoints[0] ?? null;

  const resolveNow = useCallback(async () => {
    setResolving(true);
    const ctrl = new AbortController();
    const live = await resolveAllLiveEndpoints(candidates, ctrl.signal);
    setEndpoints(live);
    setResolving(false);
  }, [candidates]);

  useEffect(() => {
    if (candidates.length === 0) return;
    queueMicrotask(() => void resolveNow());
  }, [candidates, resolveNow]);

  const switchEndpoint = useCallback((podId: string) => {
    setActivePodId(podId);
    try { localStorage.setItem('tytus.music-creator.preferred-pod', podId); }
    catch { /* private browsing — ignore */ }
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  // In-flight guard. Tracks a generation across the brief window between
  // a click and React rendering the Cancel button. Without this a fast
  // double-click fires two parallel `callLyrics` requests — the second
  // abort cancels the JS promise but the server already accepted both.
  const generatingRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Fake progress + rotating tip while a real call is in flight.
  useEffect(() => {
    if (phase === 'idle') {
      queueMicrotask(() => {
        setProgress(0);
        setTipIndex(0);
      });
      return;
    }
    const start = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - start) / 1000;
      // Asymptotic curve toward 0.95 across 90s; never claims 100%.
      const target = phase === 'lyrics'
        ? Math.min(0.95, elapsed / 5)
        : Math.min(0.95, 1 - Math.exp(-elapsed / 35));
      setProgress(target);
    };
    tick();
    const progressId = setInterval(tick, 250);
    const tipId = setInterval(() => setTipIndex((i) => i + 1), 4500);
    return () => { clearInterval(progressId); clearInterval(tipId); };
  }, [phase]);

  // ── OS-level mirrors ───────────────────────────────────────
  // Every save to SQLite is also projected into the VFS so the rest of
  // the OS (Files app, Text Editor, Desktop) can see a real `.lyrics.txt`
  // and a `.mp3` shortcut. Cheap — text content is bounded, the audio
  // shortcut is a metadata stub pointing back at SQLite via refTrackId.
  // Defined ABOVE `generate` because it's listed in generate's deps array
  // and React's hook reads happen during the render pass — referencing a
  // `useCallback` declared further down would hit a TDZ.

  const mirrorLyricsToVfs = useCallback((track: SavedTrack): string | null => {
    if (!track.lyricsPreview) return null;
    const musicFolderId = fsApi.ensureUserFolder('Music');
    if (!musicFolderId) return null;
    const fileName = `${sanitizeFileName(track.title.replace(/\s*\((lyrics|cover)\)\s*$/, ''))}.lyrics.txt`;
    const existing = fsApi.findChildByName(musicFolderId, fileName);
    if (existing) {
      fsApi.writeFile(existing.id, track.lyricsPreview);
      return existing.id;
    }
    return fsApi.createFile(musicFolderId, fileName, track.lyricsPreview, {
      mimeType: 'text/plain',
    });
  }, [fsApi]);

  const mirrorAudioToVfs = useCallback((track: SavedTrack): string | null => {
    if (!track.audioDataUrl) return null;
    const musicFolderId = fsApi.ensureUserFolder('Music');
    if (!musicFolderId) return null;
    const fileName = `${sanitizeFileName(track.title.replace(/\s*\((lyrics|cover)\)\s*$/, ''))}.mp3`;
    const existing = fsApi.findChildByName(musicFolderId, fileName);
    if (existing) return existing.id;
    return fsApi.createFile(musicFolderId, fileName, '', {
      mimeType: 'audio/mpeg',
      refTrackId: track.id,
    });
  }, [fsApi]);

  const generate = useCallback(async () => {
    if (!endpoint) {
      setError(t('musiccreator.error.noPod'));
      return;
    }
    // In-flight guard: drop duplicate clicks before phase flips.
    // The button swaps to Cancel via `busy = phase !== 'idle'`, but
    // there's a render-frame gap between this handler firing and the
    // new state landing. Ignore re-entrant calls during that gap.
    if (generatingRef.current) return;
    generatingRef.current = true;
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Apply per-endpoint user overrides on top of auto-discovery. The
      // override slots come from the Settings dialog; empty/missing
      // strings fall back to the discovered ids.
      const overrides = creatorSettings.overridesByEndpoint[endpoint.url] ?? {};
      const effectiveEndpoint: PodEndpoint = {
        ...endpoint,
        models: {
          music: overrides.music || endpoint.models.music,
          cover: overrides.cover || endpoint.models.cover,
          lyrics: overrides.lyrics || endpoint.models.lyrics,
          lyricsBackup: overrides.lyricsBackup || endpoint.models.lyricsBackup,
          allIds: endpoint.models.allIds,
        },
      };

      // Step 1: lyrics (skip if user supplied their own).
      let useLyrics = lyrics.trim();
      let resolvedTitle = songName.trim();
      let resolvedStyle = style.trim();
      let generatedLyrics: Awaited<ReturnType<typeof callLyrics>> | null = null;

      if (!useLyrics && !instrumental) {
        if (!theme.trim()) {
          setError(t('musiccreator.error.noInput'));
          return;
        }
        setPhase('lyrics');
        generatedLyrics = await callLyrics(effectiveEndpoint, theme.trim(), controller.signal);
        useLyrics = generatedLyrics.lyrics;
        if (!resolvedTitle) resolvedTitle = generatedLyrics.song_title;
        if (!resolvedStyle) resolvedStyle = generatedLyrics.style_tags;
      } else if (!useLyrics && instrumental) {
        // Instrumental still needs SOMETHING in the lyrics field — the
        // upstream MiniMax music model rejects empty lyrics with
        // "code=2013 lyrics is required" even when instrumental:true is
        // set. Send a structural placeholder; it never gets vocalized
        // because the instrumental flag suppresses singing.
        useLyrics = '[Intro]\n[Instrumental]\n[Outro]';
      }

      if (generatedLyrics) {
        // Mirror the generated text into the form so the user sees
        // exactly what we got back. Critical for lyrics-only mode where
        // there's no audio to listen to — without this the form looked
        // empty after generation finished.
        setLyrics(generatedLyrics.lyrics);
        if (resolvedTitle && !songName.trim()) setSongName(resolvedTitle);
        if (resolvedStyle && !style.trim()) setStyle(resolvedStyle);
        if (generatedLyrics.usedFallback) {
          // Surface the fallback so the user knows their primary lyrics
          // model errored and a chat model picked up. Yellow banner,
          // dismissable. Doesn't block generation.
          setGalleryError(
            `Primary lyrics model errored — used backup chat model "${effectiveEndpoint.models.lyricsBackup ?? 'unknown'}" instead.`,
          );
        }
      }

      if (useLyrics.length > MAX_LYRICS) {
        setError(t('musiccreator.error.lyricsTooLong', { count: useLyrics.length, max: MAX_LYRICS }));
        setPhase('idle');
        return;
      }

      // Lyrics-only mode → save the full lyric sheet as a track and stop.
      // The form already reflects the generated text (we populated state
      // above) so the user can edit/copy without having to dig in the
      // gallery first.
      if (mode === 'lyricsOnly') {
        const sheetTrack: SavedTrack = {
          id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: (resolvedTitle || t('musiccreator.track.untitled')) + ' (lyrics)',
          styleTags: resolvedStyle || '—',
          lyricsPreview: useLyrics,  // store the full text — used by Load
          durationMs: 0,
          bitrate: 0,
          sampleRate: 0,
          sizeBytes: 0,
          createdAt: Date.now(),
          audioDataUrl: '', // no audio
        };
        await saveTrack(sheetTrack);
        // Project the lyric sheet into the VFS so it shows up in the
        // Files app and can be edited in Text Editor like a real .txt.
        mirrorLyricsToVfs(sheetTrack);
        setPhase('idle');
        setProgress(0);
        return;
      }

      // Cover mode requires a reference-audio upload.
      if (mode === 'cover' && !refAudioBase64) {
        setError('Cover mode needs a reference audio file. Drop one in below.');
        setPhase('idle');
        return;
      }

      // Step 2: music (or cover).
      setPhase('song');
      const song = await callMusic(
        effectiveEndpoint,
        {
          lyrics: useLyrics,
          prompt: resolvedStyle || undefined,
          instrumental,
          refAudioBase64: mode === 'cover' ? refAudioBase64 ?? undefined : undefined,
        },
        controller.signal,
      );

      // Validate the response shape before assuming success. Some
      // gateways return 200 with an empty/error body when an upstream
      // fails — we'd silently save an unplayable track without this.
      if (!song?.data?.audio || typeof song.data.audio !== 'string' || song.data.audio.length < 100) {
        const traceId = song?.trace_id ? ` (trace ${song.trace_id})` : '';
        throw new Error(`Music gen returned no audio data${traceId}. Try again or pick a different model in Settings.`);
      }

      const audioDataUrl = `data:audio/mpeg;base64,${song.data.audio}`;
      const titleSuffix = mode === 'cover' ? ' (cover)' : '';
      const newTrack: SavedTrack = {
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: (resolvedTitle || t('musiccreator.track.untitled')) + titleSuffix,
        styleTags: resolvedStyle || '—',
        lyricsPreview: useLyrics,  // store the full text — used by Load
        durationMs: song.data.duration_ms ?? 0,
        bitrate: song.data.bitrate ?? 0,
        sampleRate: song.data.sample_rate ?? 0,
        sizeBytes: song.data.size_bytes ?? 0,
        createdAt: Date.now(),
        audioDataUrl,
      };

      console.info('[Juli3ta] Saving generated song:', { id: newTrack.id, title: newTrack.title, durationMs: newTrack.durationMs, sizeBytes: newTrack.sizeBytes });
      await saveTrack(newTrack);
      // Mirror to the VFS so the song shows up in Files (~/Music/Title.mp3
      // as a shortcut) and the lyrics show up as ~/Music/Title.lyrics.txt.
      mirrorAudioToVfs(newTrack);
      mirrorLyricsToVfs(newTrack);
      addNotification({
        appId: 'musiccreator',
        appName: 'Music Creator',
        appIcon: 'Sparkles',
        title: t('musiccreator.notify.songReadyTitle'),
        message: t('musiccreator.notify.songReadyBody', { title: newTrack.title }),
        isRead: false,
      });
      setPhase('idle');
      setProgress(0);
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setPhase('idle');
        return;
      }
      // Loud-fail: log to console + surface in the form. Previously a
      // silent throw left the user staring at an idle state with no song.
      console.error('[Juli3ta] Generate failed:', e);
      setError((e as Error).message || 'Generation failed — check the console for details.');
      setPhase('idle');
      setProgress(0);
    } finally {
      generatingRef.current = false;
    }
  }, [
    endpoint, theme, lyrics, songName, style, instrumental, mode, refAudioBase64, t,
    saveTrack, creatorSettings, mirrorAudioToVfs, mirrorLyricsToVfs, addNotification,
  ]);

  const handleRefAudioPick = () => refFileInputRef.current?.click();

  // Stale-result guard for ingestSourceAudio. User can fire-pick file A
  // (long analysis), then file B (short analysis). Without this, B
  // finishes first and writes refAudioBase64; then A finishes and stomps
  // B's result with the wrong file's bytes. We capture a sequence number
  // at call time and only commit state if we're still the latest call.
  const ingestSeqRef = useRef(0);

  // Decode → analyze → extract best window OR mix, then base64-encode.
  // Used for direct file upload, voice recording pick, and inline recorder.
  const ingestSourceAudio = useCallback(async (
    source: Blob | string,
    displayName: string,
  ) => {
    const seq = ++ingestSeqRef.current;
    const isCurrent = () => ingestSeqRef.current === seq;
    setError(null);
    setExtracting(true);
    setRefAudioBase64(null);
    setRefAudioName(displayName);
    setRefSampleInfo(null);
    try {
      if (sampleStrategy === 'mix') {
        const result = await buildIconicMix(source);
        if (!isCurrent()) return;
        setRefAudioBase64(result.base64);
        const sourceMin = result.sourceDurationSec / 60;
        if (result.segments.length > 1) {
          const segDesc = result.segments
            .map((s) => `${Math.floor(s.startSec / 60)}:${Math.floor(s.startSec % 60).toString().padStart(2, '0')}`)
            .join(' + ');
          setRefSampleInfo(
            `Mixed ${result.segments.length} iconic moments (${result.durationSec.toFixed(0)} s) from ${sourceMin.toFixed(1)} min — at ${segDesc}`,
          );
        } else {
          setRefSampleInfo(`Using whole clip (${result.durationSec.toFixed(0)} s)`);
        }
      } else {
        const result = await buildCoverSample(source);
        if (!isCurrent()) return;
        setRefAudioBase64(result.base64);
        const sourceMin = result.sourceDurationSec / 60;
        const startMin = result.startSec / 60;
        const startStr = result.startSec < 60
          ? `${result.startSec.toFixed(1)} s`
          : `${Math.floor(startMin)}:${Math.floor(result.startSec % 60).toString().padStart(2, '0')}`;
        setRefSampleInfo(
          result.sourceDurationSec <= result.durationSec + 0.5
            ? `Using whole clip (${result.durationSec.toFixed(0)} s)`
            : `Auto-picked best ${result.durationSec.toFixed(0)} s starting at ${startStr} of ${sourceMin.toFixed(1)} min`,
        );
      }
    } catch (err) {
      if (!isCurrent()) return;
      setError((err as Error).message || 'Could not analyze that audio.');
      setRefAudioName(null);
    } finally {
      if (isCurrent()) setExtracting(false);
    }
  }, [sampleStrategy]);

  // ── Inline recorder (mic + tab audio) ───────────────────────────
  // Starts a stream from either the mic (getUserMedia) or the tab/screen
  // (getDisplayMedia). When stopped, the audio is auto-saved to the
  // shared Voice Recordings localStorage AND immediately ingested as a
  // cover sample.
  const startInlineRecording = async () => {
    setRecError(null);
    try {
      let stream: MediaStream;
      if (recSource === 'tab') {
        // getDisplayMedia with audio:true captures system / tab audio.
        // Chrome requires video:true to allow audio capture, so we
        // request both and immediately drop the video track.
        // Safari/Firefox don't support audio in getDisplayMedia → caught below.
        const md = navigator.mediaDevices as MediaDevices & {
          getDisplayMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
        };
        if (!md.getDisplayMedia) {
          throw new Error('Tab audio capture is not supported in this browser. Use mic instead.');
        }
        stream = await md.getDisplayMedia({ video: true, audio: true });
        // Drop the video track — we only want audio.
        for (const track of stream.getVideoTracks()) {
          track.stop();
          stream.removeTrack(track);
        }
        if (stream.getAudioTracks().length === 0) {
          throw new Error('No audio in the selected tab. In the share dialog, tick "Share tab audio".');
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      recStreamRef.current = stream;

      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) recChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        try {
          const blob = new Blob(recChunksRef.current, {
            type: recChunksRef.current[0]?.type || mime || 'audio/webm',
          });
          if (blob.size === 0) {
            setRecError('Recording was empty.');
            return;
          }
          // Persist to the shared Voice Recordings SQLite store so it
          // appears in the Voice Recorder app too. FileReader errors are
          // wrapped so a quota/decoder failure surfaces a real message
          // instead of a silently-empty entry in the picker.
          const reader = new FileReader();
          reader.onerror = () => setRecError('Could not read the recording.');
          reader.onload = () => {
            const dataUrl = typeof reader.result === 'string' ? reader.result : '';
            const newRec: VoiceRecording = {
              id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: `${recSource === 'tab' ? 'Tab audio' : 'Recording'} ${new Date().toLocaleTimeString()}`,
              durationMs: Date.now() - recStartRef.current,
              mimeType: blob.type || mime || 'audio/webm',
              audioDataUrl: dataUrl,
              createdAt: Date.now(),
            };
            void (async () => {
              try {
                await insertRecording(newRec);
                setVoiceRecordings((prev) => [newRec, ...prev]);
              } catch (e) {
                console.warn('Recording save failed', e);
                setRecError('Could not save the recording. Try again.');
              }
            })();
            // Auto-feed into cover-sample analyzer.
            setRecOpen(false);
            void ingestSourceAudio(blob, newRec.name);
          };
          reader.readAsDataURL(blob);
        } finally {
          recStreamRef.current?.getTracks().forEach((t) => t.stop());
          recStreamRef.current = null;
        }
      };
      mr.start(250);
      recMediaRecorderRef.current = mr;

      recStartRef.current = Date.now();
      setRecElapsedMs(0);
      setRecActive(true);
      recTickerRef.current = setInterval(() => {
        setRecElapsedMs(Date.now() - recStartRef.current);
      }, 100);
    } catch (e) {
      setRecError((e as Error).message || 'Could not start recording.');
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
      setRecActive(false);
    }
  };

  const stopInlineRecording = () => {
    const mr = recMediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    if (recTickerRef.current) clearInterval(recTickerRef.current);
    setRecActive(false);
  };

  // Cleanup on unmount.
  useEffect(() => () => {
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (recTickerRef.current) clearInterval(recTickerRef.current);
  }, []);

  const handleRefAudioFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      setError('Reference audio is too big. Max 50 MB.');
      return;
    }
    void ingestSourceAudio(f, f.name);
  };

  const handlePickRecording = (rec: VoiceRecording) => {
    setShowRecordingsPicker(false);
    void ingestSourceAudio(rec.audioDataUrl, rec.name);
  };

  // Refresh the voice-recordings list every time the user opens the picker
  // so newly-recorded clips (including those from the standalone Voice
  // Recorder app) show up without an app reload.
  const openRecordingsPicker = () => {
    setShowRecordingsPicker(true);
    void listRecordings().then((recs) => setVoiceRecordings(recs)).catch(() => undefined);
  };

  const clearRefAudio = () => {
    setRefAudioBase64(null);
    setRefAudioName(null);
    setRefSampleInfo(null);
  };

  const cancel = () => {
    abortRef.current?.abort();
    setPhase('idle');
  };

  const insertTemplate = (tpl: string) => {
    setLyrics((cur) => cur ? `${cur}\n${tpl}` : tpl);
  };

  const addStyleChip = (chip: string) => {
    setStyle((s) => s ? `${s}, ${chip.toLowerCase()}` : chip.toLowerCase());
  };

  const surpriseMe = () => {
    const themes = [
      'Late-night coding session, neon city skyline, focus and flow.',
      'Sunday-morning coffee, soft rain, lo-fi piano.',
      'Synthwave anthem about shipping on Friday evening.',
      'Jazz ballad about a forgotten train station at 3am.',
      'Acoustic folk song about a long road trip with old friends.',
      'Cinematic orchestral piece for a heroic underdog scene.',
      'Upbeat pop anthem about finishing a hard project.',
    ];
    setTheme(themes[Math.floor(Math.random() * themes.length)]);
  };

  const deleteTrack = useCallback((id: string) => {
    setGallery((g) => g.filter((track) => track.id !== id));
    // Fire-and-forget — UI already updated; the SQLite write settles in the
    // background. If it fails the next reload re-hydrates from SQLite and
    // the track resurrects, which is the correct fail-safe behaviour.
    void deleteTrackRow(id).catch((e: unknown) => console.warn('Track delete failed:', e));
  }, []);

  // Load a saved track back into the form so the user can edit/remix
  // without retyping. Strips the "(lyrics)" / "(cover)" suffix we add
  // at save time so the title round-trips cleanly. Picks a sensible
  // mode: lyrics-only sheets reopen in lyrics mode; everything else
  // lands in compose mode so the user can hit Create Song again.
  const loadTrack = useCallback((track: SavedTrack) => {
    setLyrics(track.lyricsPreview ?? '');
    setStyle(track.styleTags && track.styleTags !== '—' ? track.styleTags : '');
    const cleanTitle = track.title.replace(/\s*\((lyrics|cover)\)\s*$/, '');
    setSongName(cleanTitle);
    setInstrumental(false);
    if (!track.audioDataUrl) setMode('lyricsOnly');
    else setMode('compose');
  }, []);

  const openLyricsInEditor = useCallback((track: SavedTrack) => {
    const nodeId = mirrorLyricsToVfs(track);
    if (!nodeId) {
      addNotification({
        appId: 'musiccreator',
        appName: 'Music Creator',
        appIcon: 'AlertCircle',
        title: t('musiccreator.notify.noLyricsTitle'),
        message: t('musiccreator.notify.noLyricsBody'),
        isRead: false,
      });
      return;
    }
    dispatch({
      type: 'OPEN_OR_FOCUS_WINDOW',
      appId: 'texteditor',
      args: { editor: { nodeId } },
    });
  }, [mirrorLyricsToVfs, dispatch, addNotification, t]);

  // Generic "drop a VFS node onto the Desktop and add a desktop icon".
  // Both song + lyrics paths funnel through this so the placement /
  // dedupe / notification logic stays in one place.
  const placeDesktopFile = useCallback((
    fileName: string,
    content: string,
    opts: { mimeType: string; refTrackId?: string },
    seed: string,
  ) => {
    const folderId = fsApi.ensureUserFolder('Desktop');
    if (!folderId) return;
    const existing = fsApi.findChildByName(folderId, fileName);
    let nodeId: string;
    if (existing) {
      // Refresh content for text files; audio shortcuts don't carry bytes.
      if (!opts.refTrackId) fsApi.writeFile(existing.id, content);
      nodeId = existing.id;
    } else {
      nodeId = fsApi.createFile(folderId, fileName, content, opts);
      const seedSum = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0);
      const col = (seedSum % 6) + 1; // skip the reserved pods zone
      const row = Math.floor(seedSum / 6) % 4;
      dispatch({
        type: 'ADD_DESKTOP_ICON',
        icon: {
          name: fileName,
          icon: getIconForFileName(fileName),
          fileSystemNodeId: nodeId,
          position: { x: 16 + col * 80, y: 16 + row * 90 },
          isSelected: false,
        },
      });
    }
    addNotification({
      appId: 'musiccreator',
      appName: 'Music Creator',
      appIcon: 'Sparkles',
      title: t('musiccreator.notify.savedToDesktopTitle'),
      message: t('musiccreator.notify.savedToDesktopBody', { name: fileName }),
      isRead: false,
    });
  }, [fsApi, dispatch, addNotification, t]);

  const saveSongToDesktop = useCallback((track: SavedTrack) => {
    if (!track.audioDataUrl) return;
    const baseName = sanitizeFileName(track.title.replace(/\s*\((lyrics|cover)\)\s*$/, ''));
    placeDesktopFile(`${baseName}.mp3`, '', { mimeType: 'audio/mpeg', refTrackId: track.id }, track.id);
  }, [placeDesktopFile]);

  const saveLyricsToDesktop = useCallback((track: SavedTrack) => {
    if (!track.lyricsPreview) return;
    const baseName = sanitizeFileName(track.title.replace(/\s*\((lyrics|cover)\)\s*$/, ''));
    placeDesktopFile(`${baseName}.lyrics.txt`, track.lyricsPreview, { mimeType: 'text/plain' }, `${track.id}-lyrics`);
  }, [placeDesktopFile]);

  const playTrackInPlayer = useCallback((track: SavedTrack) => {
    if (!track.audioDataUrl) return;
    dispatch({
      type: 'OPEN_OR_FOCUS_WINDOW',
      appId: 'musicplayer',
      args: { music: { trackId: track.id } },
    });
  }, [dispatch]);

  // ── DnD: parse a drop and pull a usable string out of it ─────
  // Track payloads carry both the JSON track metadata AND a plain-text
  // mirror of the lyrics, so any text-shaped target can accept either
  // a track or any other text source (notes, snippets, the OS clipboard).
  // Returns null when the drop has nothing useful — callers should fall
  // back to the browser's native drop behaviour by NOT calling
  // preventDefault before invoking us.
  const readTrackPayload = useCallback((e: React.DragEvent): DraggedTrackPayload | null => {
    const raw = e.dataTransfer.getData(MIME_TRACK);
    if (!raw) return null;
    try { return JSON.parse(raw) as DraggedTrackPayload; }
    catch { return null; }
  }, []);

  const handleLyricsDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const payload = readTrackPayload(e);
    if (payload && payload.lyricsPreview) {
      e.preventDefault();
      setLyrics(payload.lyricsPreview);
      const cleanTitle = payload.title.replace(/\s*\((lyrics|cover)\)\s*$/, '');
      if (!songName.trim() && cleanTitle) setSongName(cleanTitle);
      if (!style.trim() && payload.styleTags && payload.styleTags !== '—') setStyle(payload.styleTags);
      return;
    }
    // Fall through to native text/plain drop on the textarea.
  }, [readTrackPayload, songName, style]);

  const handleStyleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const payload = readTrackPayload(e);
    if (payload && payload.styleTags && payload.styleTags !== '—') {
      e.preventDefault();
      setStyle((cur) => cur ? `${cur}, ${payload.styleTags}` : payload.styleTags);
    }
  }, [readTrackPayload]);

  const handleThemeDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const payload = readTrackPayload(e);
    if (payload) {
      e.preventDefault();
      // Theme = creative brief. Use the title + style as a hint.
      const cleanTitle = payload.title.replace(/\s*\((lyrics|cover)\)\s*$/, '');
      const text = payload.styleTags && payload.styleTags !== '—'
        ? `Inspired by "${cleanTitle}" — ${payload.styleTags}`
        : `Inspired by "${cleanTitle}"`;
      setTheme(text);
    }
  }, [readTrackPayload]);

  const handleSongNameDrop = useCallback((e: React.DragEvent<HTMLInputElement>) => {
    const payload = readTrackPayload(e);
    if (payload) {
      e.preventDefault();
      setSongName(payload.title.replace(/\s*\((lyrics|cover)\)\s*$/, ''));
    }
  }, [readTrackPayload]);

  // Indicate to the OS we accept the drop so the cursor changes.
  const acceptDrag = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(MIME_TRACK)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const lyricsCount = lyrics.length;
  const styleCount = style.length;
  const busy = phase !== 'idle';

  // ─── App menu (Music Creator > … in the global top bar) ───
  // Register a per-window shell menu so the macOS-style top bar shows
  // app-specific items: Song > New / Surprise / Open Help, View > Help,
  // Settings, plus the standard Window/Help groups other apps have.
  const shellMenuModel = useMemo(() => ({
    appLabel: 'Music Creator',
    groups: [
      {
        id: 'song',
        label: 'Song',
        items: [
          { id: 'new', label: 'New Song', onSelect: () => { setMode('compose'); setTheme(''); setLyrics(''); setStyle(''); setSongName(''); } },
          { id: 'surprise', label: 'Surprise me…', onSelect: () => surpriseMe() },
          { id: 'mode-cover', label: 'Cover Mode', onSelect: () => setMode('cover') },
          { id: 'mode-lyrics', label: 'Lyrics Only Mode', onSelect: () => setMode('lyricsOnly') },
        ],
      },
      {
        id: 'view',
        label: 'View',
        items: [
          { id: 'open-help', label: 'How it works…', onSelect: () => setHelpOpen(true) },
          { id: 'open-settings', label: 'Music Creator Settings…', onSelect: () => setSettingsOpen(true) },
        ],
      },
      {
        id: 'window',
        label: 'Window',
        items: [
          { id: 'minimize', label: 'Minimize Window', actionId: 'minimize-window' as const, disabled: !currentWindow },
          { id: 'close', label: 'Close Window', actionId: 'close-window' as const, disabled: !currentWindow },
        ],
      },
      {
        id: 'help',
        label: 'Help',
        items: [
          { id: 'juli3ta-help', label: 'Juli3ta Help…', onSelect: () => setHelpOpen(true) },
          { id: 'tytus-help', label: 'Tytus Help', actionId: 'open-help' as const },
        ],
      },
    ],
  }), [currentWindow]);
  useShellMenuRegistration(currentWindow?.id ?? null, shellMenuModel);

  // Single source of truth for the gallery filter. Previously the
  // header counter and the list predicate diverged (counter excluded
  // lyrics body, list included it) — searching "duende" would say
  // "1 / 5" but render all 5 flamenco tracks. Filter on title + style
  // only because lyric-body matches were too noisy in practice.
  const visibleGallery = useMemo(() => {
    const q = gallerySearch.trim().toLowerCase();
    if (!q) return gallery;
    return gallery.filter((g) =>
      g.title.toLowerCase().includes(q)
      || g.styleTags.toLowerCase().includes(q));
  }, [gallery, gallerySearch]);

  // ─── Render ────────────────────────────────────────────

  if (!endpoint) return <EmptyState retrying={resolving} onRetry={resolveNow} />;

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bg-window)' }}>
      {/* ───────── LEFT: Slim "My Work" gallery rail ───────── */}
      {/* Compact 260px sidebar inspired by ApiTester's collection list.
          The big workspace lives to the right; the rail is just for
          navigation between past tracks. */}
      <aside
        className="flex flex-col flex-shrink-0"
        style={{
          width: 260,
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-titlebar)',
        }}
      >
        <div
          className="flex items-center gap-2 px-3 flex-shrink-0"
          style={{
            height: 38,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Sparkles size={13} style={{ color: 'var(--accent-primary)' }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            {t('musiccreator.gallery.title')}
          </div>
          <div className="ml-auto" style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
            {gallerySearch.trim()
              ? `${visibleGallery.length} / ${gallery.length}`
              : t(
                gallery.length === 1
                  ? 'musiccreator.gallery.count.one'
                  : 'musiccreator.gallery.count.other',
                { n: gallery.length },
              )}
          </div>
        </div>

        {/* Search — visible only once the gallery has tracks. Filters
            against title, style tags, and full lyric text so a melody
            line you remember can find the song without scrolling. */}
        {gallery.length > 0 && (
          <div
            className="flex items-center gap-1 px-2 flex-shrink-0"
            style={{
              height: 32,
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-window)',
            }}
          >
            <Search size={11} style={{ color: 'var(--text-disabled)', marginLeft: 4 }} />
            <input
              value={gallerySearch}
              onChange={(e) => setGallerySearch(e.target.value)}
              placeholder={t('musiccreator.gallery.searchPlaceholder')}
              className="flex-1 rounded-input bg-transparent outline-none px-1"
              style={{ fontSize: 11, color: 'var(--text-primary)' }}
            />
            {gallerySearch && (
              <button
                onClick={() => setGallerySearch('')}
                className="opacity-60 hover:opacity-100 px-1"
                title="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )}

        {gallery.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
            <div
              className="flex items-center justify-center rounded-2xl mb-2"
              style={{
                width: 44, height: 44,
                background: 'var(--bg-hover)',
              }}
            >
              <FileMusic size={18} style={{ color: 'var(--text-disabled)' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {t('musiccreator.gallery.empty.title')}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4, maxWidth: 220, lineHeight: 1.4 }}>
              {t('musiccreator.gallery.empty.body')}
            </div>
            <div className="flex items-center gap-1 mt-3" style={{ fontSize: 9, color: 'var(--text-disabled)' }}>
              <Mic size={10} />
              {t('musiccreator.gallery.empty.footer')}
            </div>
          </div>
        ) : visibleGallery.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
            <Search size={18} style={{ color: 'var(--text-disabled)', opacity: 0.5 }} />
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
              {t('musiccreator.gallery.searchEmpty', { q: gallerySearch })}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto invisible-scrollbar p-1.5 flex flex-col gap-0.5">
            {visibleGallery.map((track) => (
              <TrackCard
                key={track.id}
                track={track}
                onDelete={deleteTrack}
                onLoad={loadTrack}
                onOpenLyrics={openLyricsInEditor}
                onSaveSongToDesktop={saveSongToDesktop}
                onSaveLyricsToDesktop={saveLyricsToDesktop}
                onPlayInPlayer={playTrackInPlayer}
              />
            ))}
          </div>
        )}
      </aside>

      {/* ───────── MAIN: Creator workspace ───────── */}
      {/* Sticky header → mode tabs → scrollable form (2-column where it
          helps) → sticky Generate bar. Modals overlay the main pane only,
          mirroring how ApiTester scopes its dialogs. */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header — Juli3ta wordmark + connection + actions */}
        <div
          className="flex items-center gap-3 px-5 flex-shrink-0"
          style={{
            height: 56,
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-titlebar)',
          }}
        >
          <div
            className="flex items-center justify-center rounded-xl flex-shrink-0"
            style={{
              width: 38, height: 38,
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              boxShadow: '0 4px 16px rgba(124, 77, 255, 0.35)',
            }}
          >
            <Disc3 size={20} style={{ color: 'white' }} />
          </div>
          <div className="min-w-0">
            <div
              className="leading-none"
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Juli3ta
            </div>
          </div>
          {/* Right cluster: connection picker + Surprise + Settings + Help.
              All four buttons share the same 32px height and bordered chip
              shape so the row reads as a single coherent toolbar. */}
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            <ConnectionBadge endpoint={endpoint} endpoints={endpoints} onSwitch={switchEndpoint} />
            <button
              onClick={surpriseMe}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 rounded-lg transition-all hover:bg-[var(--bg-hover)] disabled:opacity-40"
              style={{
                height: 32,
                fontSize: 11,
                color: 'var(--text-secondary)',
                background: 'var(--bg-window)',
                border: '1px solid var(--border-subtle)',
              }}
              title={t('musiccreator.header.surpriseTitle')}
            >
              <Shuffle size={12} />
              {t('musiccreator.header.surprise')}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center rounded-lg transition-all hover:bg-[var(--bg-hover)]"
              style={{
                width: 32, height: 32,
                color: 'var(--text-secondary)',
                background: 'var(--bg-window)',
                border: '1px solid var(--border-subtle)',
              }}
              title="Music Creator Settings"
            >
              <Settings2 size={14} />
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              className="flex items-center justify-center rounded-lg transition-all hover:bg-[var(--bg-hover)]"
              style={{
                width: 32, height: 32,
                color: 'var(--text-secondary)',
                background: 'var(--bg-window)',
                border: '1px solid var(--border-subtle)',
              }}
              title={t('julietaHelp.title')}
            >
              <HelpCircle size={14} />
            </button>
          </div>
        </div>

        {/* Mode tabs + primary action — same row. The Create button sits
            at the right edge so the form's primary CTA is always one
            click away regardless of how far the user scrolled. */}
        <div
          className="flex items-center gap-2 px-5 flex-shrink-0"
          style={{
            height: 48,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {([
            { id: 'compose' as Mode, label: '🎵 Song', tip: 'Theme → lyrics → music' },
            { id: 'cover' as Mode,   label: '🎨 Cover', tip: 'Reference audio → restyle' },
            { id: 'lyricsOnly' as Mode, label: '✍️ Lyrics', tip: 'Words only, no audio' },
          ]).map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              disabled={busy}
              title={m.tip}
              className="px-4 rounded-lg transition-all disabled:opacity-50"
              style={{
                height: 32,
                fontSize: 12,
                fontWeight: mode === m.id ? 600 : 500,
                color: mode === m.id ? 'white' : 'var(--text-secondary)',
                background: mode === m.id
                  ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                  : 'var(--bg-titlebar)',
                border: mode === m.id ? '1px solid transparent' : '1px solid var(--border-subtle)',
              }}
            >
              {m.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {busy ? (
              <button
                onClick={cancel}
                className="flex items-center gap-1.5 px-4 rounded-lg transition-all hover:bg-[var(--bg-hover)]"
                style={{
                  height: 32,
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-titlebar)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <Loader2 size={12} className="animate-spin" />
                {t('musiccreator.button.cancel')}
              </button>
            ) : (
              <button
                onClick={generate}
                className="flex items-center gap-1.5 px-4 rounded-lg transition-all hover:scale-[1.02] active:scale-[0.99]"
                style={{
                  height: 32,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'white',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                <Wand2 size={13} />
                {mode === 'cover'
                  ? 'Create Cover'
                  : mode === 'lyricsOnly'
                    ? 'Write Lyrics'
                    : t('musiccreator.button.create')}
              </button>
            )}
          </div>
        </div>

        {/* Scrollable form area */}
        <div className="flex-1 overflow-y-auto invisible-scrollbar">
        <div className="px-6 py-5">

        {/* Cover-mode reference-audio dropper (full width) */}
        {mode === 'cover' && (
          <div
            className="mb-5"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(MIME_TRACK)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(e) => {
              const payload = readTrackPayload(e);
              if (payload && payload.hasAudio) {
                e.preventDefault();
                // Resolve audio bytes by id — payload doesn't carry them.
                void (async () => {
                  const row = await getTrackById(payload.id);
                  if (!row?.audioDataUrl) {
                    setError('Could not load that track’s audio. Try dragging again.');
                    return;
                  }
                  void ingestSourceAudio(row.audioDataUrl, `${payload.title}.mp3`);
                })();
              }
            }}
          >
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Reference audio
            </label>
            {refAudioName ? (
              <div
                className="mt-1 px-3 py-2 rounded-lg"
                style={{
                  background: 'var(--bg-titlebar)',
                  border: `1px solid ${extracting ? 'var(--border-subtle)' : 'var(--accent-primary)'}`,
                }}
              >
                <div className="flex items-center gap-2">
                  {extracting
                    ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    : <FileMusic size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />}
                  <div className="flex-1 truncate" style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                    {refAudioName}
                  </div>
                  <button
                    onClick={clearRefAudio}
                    disabled={busy || extracting}
                    className="p-1 rounded-md transition-all hover:bg-[var(--bg-hover)] disabled:opacity-40"
                    style={{ color: 'var(--text-secondary)' }}
                    title="Remove reference"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {(extracting || refSampleInfo) && (
                  <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 }}>
                    {extracting ? '🔍  Listening for the best part…' : `✨  ${refSampleInfo}`}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 mt-1">
                <button
                  onClick={() => setRecOpen(true)}
                  disabled={busy}
                  className="flex flex-col items-center justify-center gap-1 py-3 rounded-lg transition-all hover:bg-[var(--bg-hover)] disabled:opacity-50"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-titlebar)',
                    border: '1px dashed var(--accent-primary)',
                  }}
                  title="Record new audio (mic or tab)"
                >
                  <Mic size={16} style={{ color: 'var(--accent-primary)' }} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>Record now</span>
                  <span style={{ fontSize: 9, color: 'var(--text-disabled)' }}>mic or tab audio</span>
                </button>
                <button
                  onClick={handleRefAudioPick}
                  disabled={busy}
                  className="flex flex-col items-center justify-center gap-1 py-3 rounded-lg transition-all hover:bg-[var(--bg-hover)] disabled:opacity-50"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-titlebar)',
                    border: '1px dashed var(--border-subtle)',
                  }}
                >
                  <FileMusic size={16} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>Pick file</span>
                  <span style={{ fontSize: 9, color: 'var(--text-disabled)' }}>mp3 · wav · flac</span>
                </button>
                <button
                  onClick={openRecordingsPicker}
                  disabled={busy}
                  className="flex flex-col items-center justify-center gap-1 py-3 rounded-lg transition-all hover:bg-[var(--bg-hover)] disabled:opacity-50 relative"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-titlebar)',
                    border: '1px dashed var(--border-subtle)',
                  }}
                >
                  <FileMusic size={16} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>From library</span>
                  <span style={{ fontSize: 9, color: 'var(--text-disabled)' }}>
                    {voiceRecordings.length} saved
                  </span>
                </button>
              </div>
            )}

            {/* Sample-extraction strategy toggle. Visible whenever we
                don't yet have a sample loaded — picking the strategy
                BEFORE ingesting determines what `ingestSourceAudio` does. */}
            {!refAudioName && (
              <div className="mt-3">
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>
                  Sample strategy
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSampleStrategy('best')}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
                    style={{
                      background: sampleStrategy === 'best' ? 'var(--bg-selected)' : 'var(--bg-titlebar)',
                      border: `1px solid ${sampleStrategy === 'best' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                      color: sampleStrategy === 'best' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <Sparkles size={13} style={{ color: sampleStrategy === 'best' ? 'var(--accent-primary)' : 'var(--text-secondary)' }} />
                    <div className="text-left flex-1">
                      <div style={{ fontSize: 11, fontWeight: 600 }}>Best 30 s</div>
                      <div style={{ fontSize: 9, color: 'var(--text-disabled)' }}>single chorus-like window</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setSampleStrategy('mix')}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
                    style={{
                      background: sampleStrategy === 'mix' ? 'var(--bg-selected)' : 'var(--bg-titlebar)',
                      border: `1px solid ${sampleStrategy === 'mix' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                      color: sampleStrategy === 'mix' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <Layers size={13} style={{ color: sampleStrategy === 'mix' ? 'var(--accent-primary)' : 'var(--text-secondary)' }} />
                    <div className="text-left flex-1">
                      <div style={{ fontSize: 11, fontWeight: 600 }}>Iconic mix</div>
                      <div style={{ fontSize: 9, color: 'var(--text-disabled)' }}>3 best parts crossfaded</div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Inline recorder modal */}
            {recOpen && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={() => !recActive && setRecOpen(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-xl flex flex-col"
                  style={{
                    width: 380,
                    background: 'var(--bg-window)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-lg)',
                  }}
                >
                  <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      Record audio for cover
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                      Capture 1–3 minutes of music for best results. Juli3ta will auto-extract the iconic parts.
                    </div>
                  </div>

                  {/* Source toggle */}
                  <div className="px-5 pt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => !recActive && setRecSource('mic')}
                        disabled={recActive}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
                        style={{
                          background: recSource === 'mic' ? 'var(--bg-selected)' : 'var(--bg-titlebar)',
                          border: `1px solid ${recSource === 'mic' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                          color: 'var(--text-primary)',
                        }}
                      >
                        <Mic size={14} />
                        <div className="text-left flex-1">
                          <div style={{ fontSize: 11, fontWeight: 600 }}>Microphone</div>
                          <div style={{ fontSize: 9, color: 'var(--text-disabled)' }}>laptop or USB mic</div>
                        </div>
                      </button>
                      <button
                        onClick={() => !recActive && setRecSource('tab')}
                        disabled={recActive}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
                        style={{
                          background: recSource === 'tab' ? 'var(--bg-selected)' : 'var(--bg-titlebar)',
                          border: `1px solid ${recSource === 'tab' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                          color: 'var(--text-primary)',
                        }}
                      >
                        <MonitorSpeaker size={14} />
                        <div className="text-left flex-1">
                          <div style={{ fontSize: 11, fontWeight: 600 }}>Tab audio</div>
                          <div style={{ fontSize: 9, color: 'var(--text-disabled)' }}>YouTube, Spotify Web…</div>
                        </div>
                      </button>
                    </div>
                    {recSource === 'tab' && (
                      <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 6, lineHeight: 1.4 }}>
                        💡 In the share dialog, pick a tab playing music and tick <strong>"Share tab audio"</strong>.
                      </div>
                    )}
                  </div>

                  {/* Big record button + timer */}
                  <div className="px-5 py-6 flex flex-col items-center">
                    <div
                      style={{
                        fontSize: 32, fontWeight: 300,
                        color: 'var(--text-primary)',
                        fontVariantNumeric: 'tabular-nums',
                        marginBottom: 16,
                      }}
                    >
                      {Math.floor(recElapsedMs / 60000).toString().padStart(2, '0')}:
                      {Math.floor((recElapsedMs / 1000) % 60).toString().padStart(2, '0')}
                    </div>
                    {!recActive ? (
                      <button
                        onClick={startInlineRecording}
                        className="flex items-center justify-center rounded-full transition-all hover:scale-105"
                        style={{
                          width: 64, height: 64,
                          background: '#ef4444', color: 'white',
                          boxShadow: '0 0 24px rgba(239,68,68,0.4)',
                        }}
                        title="Start recording"
                      >
                        {recSource === 'tab' ? <MonitorSpeaker size={28} /> : <Mic size={28} />}
                      </button>
                    ) : (
                      <button
                        onClick={stopInlineRecording}
                        className="flex items-center justify-center rounded-full transition-all hover:scale-105"
                        style={{
                          width: 64, height: 64,
                          background: '#ef4444', color: 'white',
                          animation: 'pulse 1s infinite',
                        }}
                        title="Stop & analyze"
                      >
                        <Square size={26} />
                      </button>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12 }}>
                      {recActive
                        ? (recSource === 'tab' ? '🔊 Capturing tab audio…' : '🎙️  Recording…')
                        : 'Tap to start'}
                    </div>
                    {recError && (
                      <div
                        className="mt-3 px-3 py-1.5 rounded-md text-center"
                        style={{ background: 'rgba(239,68,68,0.12)', maxWidth: 280 }}
                      >
                        <span style={{ fontSize: 11, color: '#ff8a80' }}>{recError}</span>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div
                    className="px-5 py-3 flex items-center justify-between"
                    style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-titlebar)' }}
                  >
                    <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                      {recActive ? 'Stop to auto-analyze' : 'Saves to your library + uses as cover'}
                    </div>
                    <button
                      onClick={() => !recActive && setRecOpen(false)}
                      disabled={recActive}
                      className="px-3 py-1 rounded-md transition-all hover:bg-[var(--bg-hover)] disabled:opacity-40"
                      style={{ fontSize: 11, color: 'var(--text-secondary)' }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
            <input
              ref={refFileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleRefAudioFile}
              style={{ display: 'none' }}
            />
            <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 6, lineHeight: 1.4 }}>
              💡 Juli3ta will <strong>auto-pick the best 30&nbsp;s</strong> of the clip
              by analyzing energy + steadiness. Long recordings get trimmed to
              the most musical chunk.
            </div>

            {/* Voice recordings picker modal */}
            {showRecordingsPicker && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.5)' }}
                onClick={() => setShowRecordingsPicker(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-xl overflow-hidden flex flex-col"
                  style={{
                    width: 380,
                    maxHeight: 480,
                    background: 'var(--bg-window)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-lg)',
                  }}
                >
                  <div
                    className="px-4 py-3 flex items-center justify-between"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-2">
                      <Mic size={14} style={{ color: 'var(--accent-primary)' }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        Pick a recording
                      </span>
                    </div>
                    <button
                      onClick={() => setShowRecordingsPicker(false)}
                      className="p-1 rounded-md hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Trash2 size={14} style={{ visibility: 'hidden' }} />
                      <span style={{ fontSize: 14, fontWeight: 600 }}>×</span>
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto invisible-scrollbar">
                    {voiceRecordings.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-2">
                        <Mic size={28} style={{ color: 'var(--text-disabled)' }} />
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          No recordings yet
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-disabled)', maxWidth: 280 }}>
                          Open <strong>Voice Recorder</strong>, capture some
                          audio (a melody, a hum, music playing in the room),
                          then come back here.
                        </div>
                      </div>
                    ) : (
                      voiceRecordings.map((rec) => {
                        const sec = rec.durationMs / 1000;
                        const tooShort = sec < 6;
                        return (
                          <button
                            key={rec.id}
                            onClick={() => !tooShort && handlePickRecording(rec)}
                            disabled={tooShort}
                            className="w-full flex items-center gap-3 px-4 py-3 transition-all hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-left"
                            style={{ borderBottom: '1px solid var(--border-subtle)' }}
                          >
                            <div
                              className="flex items-center justify-center rounded-lg flex-shrink-0"
                              style={{
                                width: 36, height: 36,
                                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                              }}
                            >
                              <Mic size={16} style={{ color: 'white' }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="truncate" style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                                {rec.name}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-disabled)' }}>
                                {Math.floor(sec / 60)}:{Math.floor(sec % 60).toString().padStart(2, '0')}
                                {tooShort && ' · too short for cover (need ≥6 s)'}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setShowRecordingsPicker(false); }}
                    className="px-4 py-2 text-center"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-disabled)',
                      borderTop: '1px solid var(--border-subtle)',
                      background: 'var(--bg-titlebar)',
                    }}
                  >
                    Tip: open Voice Recorder to capture more
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Two-column form. Theme + Style + Song name share consistent
            FieldCard scaffolding (label + control + hint at the same
            position) so the rhythm reads as a uniform grid. Lyrics
            spans full-width below because the editor needs the room. */}
        <div
          className="grid gap-4 mb-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        >
          {/* Theme */}
          <FieldCard
            label={t('musiccreator.theme.label')}
            hint={t('musiccreator.theme.hint')}
          >
            <textarea
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              onDragOver={acceptDrag}
              onDrop={handleThemeDrop}
              placeholder={t('musiccreator.theme.placeholder')}
              disabled={busy}
              rows={4}
              className="w-full px-3 py-2 rounded-lg resize-none focus:outline-none focus:ring-2 disabled:opacity-50"
              style={{
                fontSize: 12,
                background: 'var(--bg-window)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            />
          </FieldCard>

          {/* Style — textarea only. The grouped genre palette lives in
              its own full-width card below so Theme + Style stay
              balanced compact text fields and the chip browser gets the
              horizontal real estate it needs. */}
          <FieldCard
            label={t('musiccreator.style.label')}
            counter={`${styleCount} / ${MAX_STYLE}`}
            hint="Type freely or pick from the genre palette below."
          >
            <textarea
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              onDragOver={acceptDrag}
              onDrop={handleStyleDrop}
              placeholder={t('musiccreator.style.placeholder')}
              disabled={busy}
              rows={4}
              className="w-full px-3 py-2 rounded-lg resize-none focus:outline-none disabled:opacity-50"
              style={{
                fontSize: 12,
                background: 'var(--bg-window)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            />
          </FieldCard>
        </div>

        {/* Genre palette — full-width, grouped, collapsible. Default
            collapsed to a compact "current category + browse all" so the
            form rhythm stays tight; expanded shows every group at once.
            5-year-old-friendly: kids can scan all chips when expanded. */}
        <GenrePaletteCard onPick={addStyleChip} disabled={busy} />

        {/* Lyrics — full width so the editor breathes */}
        <FieldCard
          label={t('musiccreator.lyrics.label')}
          counter={`${lyricsCount} / ${MAX_LYRICS}`}
          counterDanger={lyricsCount > MAX_LYRICS}
          className="mb-4"
          headerExtra={
            <label
              htmlFor="juli3ta-instrumental"
              className="flex items-center gap-2 cursor-pointer select-none"
              style={{ fontSize: 11, color: 'var(--text-secondary)' }}
            >
              {t('musiccreator.lyrics.instrumental')}
              <Switch
                id="juli3ta-instrumental"
                checked={instrumental}
                onCheckedChange={setInstrumental}
                disabled={busy}
              />
            </label>
          }
        >
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            onDragOver={acceptDrag}
            onDrop={handleLyricsDrop}
            placeholder={t('musiccreator.lyrics.placeholder')}
            disabled={busy || instrumental}
            rows={8}
            className="w-full px-3 py-2 rounded-lg resize-none focus:outline-none disabled:opacity-50 font-mono"
            style={{
              fontSize: 11,
              background: 'var(--bg-window)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          />
          <div className="flex items-center gap-1 mt-2">
            {LYRIC_TEMPLATES.map((tpl, i) => (
              <button
                key={i}
                onClick={() => insertTemplate(tpl)}
                disabled={busy}
                className="px-2 py-0.5 rounded-md transition-all hover:bg-[var(--bg-hover)] disabled:opacity-40"
                style={{ fontSize: 10, color: 'var(--text-secondary)' }}
                title={t('musiccreator.lyrics.templateTitle')}
              >
                + {t('musiccreator.lyrics.template', { n: i + 1 })}
              </button>
            ))}
          </div>
        </FieldCard>

        {/* Song name */}
        <FieldCard
          label={t('musiccreator.songName.label')}
          className="mb-4"
        >
          <input
            value={songName}
            onChange={(e) => setSongName(e.target.value)}
            onDragOver={acceptDrag}
            onDrop={handleSongNameDrop}
            placeholder={t('musiccreator.songName.placeholder')}
            disabled={busy}
            className="w-full px-3 py-2 rounded-lg focus:outline-none disabled:opacity-50"
            style={{
              fontSize: 12,
              background: 'var(--bg-window)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          />
        </FieldCard>

        {/* Generation errors moved to the bottom progress strip so the
            user looks at one zone for "how is my song doing?". The strip
            below now renders busy / error / idle states. */}

        {/* Persistence warning — fired when a saved track failed to write
            to IndexedDB (denied storage, full disk, private mode). The
            track is still in memory; user just won't see it after reload. */}
        {galleryError && (
          <div
            className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg"
            style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)' }}
          >
            <AlertCircle size={14} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1" style={{ fontSize: 11, color: '#fde68a' }}>{galleryError}</div>
            <button
              onClick={() => setGalleryError(null)}
              className="rounded-md transition-all hover:bg-[var(--bg-hover)]"
              style={{ width: 18, height: 18, color: 'var(--text-secondary)', flexShrink: 0 }}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        </div>{/* /px-6 py-5 */}
        </div>{/* /scrollable form area */}

        {/* Status strip — single zone for "how is my song doing?".
            States:
              busy → bar fills, friendly tip rotates
              error → red bar, error message + dismiss
              idle → hidden, no chrome
            Sits at the very bottom of the form so the user's eye doesn't
            have to hunt for the failure on a 400 / network / abort. */}
        {(busy || error) && (
          <div
            className="flex-shrink-0"
            style={{
              borderTop: '1px solid var(--border-subtle)',
              background: error ? 'rgba(255, 82, 82, 0.06)' : 'var(--bg-titlebar)',
            }}
          >
            <div
              className="overflow-hidden"
              style={{ height: 3, background: 'var(--bg-hover)' }}
            >
              <div
                style={{
                  width: error ? '100%' : `${progress * 100}%`,
                  height: '100%',
                  background: error
                    ? 'linear-gradient(to right, #ff5252, #ff8a80)'
                    : 'linear-gradient(to right, var(--accent-primary), var(--accent-secondary))',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
            <div
              className="flex items-start gap-2 px-5 py-2"
              style={{ fontSize: 11 }}
            >
              {error ? (
                <>
                  <AlertCircle size={13} style={{ color: '#ff5252', flexShrink: 0, marginTop: 2 }} />
                  <div className="flex-1" style={{ color: '#ff8a80', lineHeight: 1.4 }}>
                    {error}
                  </div>
                  <button
                    onClick={() => setError(null)}
                    className="rounded-md transition-all hover:bg-[var(--bg-hover)] flex-shrink-0"
                    style={{ width: 18, height: 18, color: 'var(--text-secondary)' }}
                    title={t('musiccreator.error.dismiss')}
                  >
                    <X size={12} />
                  </button>
                </>
              ) : (
                <>
                  <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {phase === 'lyrics'
                      ? FUN_LYRICS_TIPS[tipIndex % FUN_LYRICS_TIPS.length]
                      : FUN_MUSIC_TIPS[tipIndex % FUN_MUSIC_TIPS.length]}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>{/* /MAIN workspace */}

      {/* In-app help drawer — slides in over both panes. */}
      <JulietaHelp
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onUseRecipe={(recipeTheme, recipeStyle) => {
          setMode('compose');
          setTheme(recipeTheme);
          setStyle(recipeStyle);
        }}
      />

      {/* Settings modal — overlay-style dialog, model overrides per
          endpoint. Same shell-styled pattern as other apps' settings. */}
      {settingsOpen && (
        <SettingsDialog
          settings={creatorSettings}
          endpoints={endpoints}
          onChange={persistSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Settings dialog
// ──────────────────────────────────────────────────────────
//
// Per-endpoint model override editor. Each reachable endpoint gets a
// section showing what was auto-discovered (for context) plus an editable
// override input for music / cover / lyrics. Empty override = use the
// auto-discovered id. Saved through the SQLite settings repo.

interface SettingsDialogProps {
  settings: MusicCreatorSettings;
  endpoints: readonly PodEndpoint[];
  onChange: (next: MusicCreatorSettings) => void | Promise<void>;
  onClose: () => void;
}

function SettingsDialog({ settings, endpoints, onChange, onClose }: SettingsDialogProps) {
  const setOverride = (epUrl: string, slot: keyof ModelOverrides, value: string) => {
    const trimmed = value.trim();
    const prev = settings.overridesByEndpoint[epUrl] ?? {};
    const nextOverrides: ModelOverrides = { ...prev };
    if (trimmed) nextOverrides[slot] = trimmed;
    else delete nextOverrides[slot];
    const next: MusicCreatorSettings = {
      ...settings,
      overridesByEndpoint: {
        ...settings.overridesByEndpoint,
        [epUrl]: nextOverrides,
      },
    };
    void onChange(next);
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl flex flex-col overflow-hidden"
        style={{
          width: 560,
          maxWidth: '90%',
          maxHeight: '85%',
          background: 'var(--bg-window)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-5 flex-shrink-0"
          style={{
            height: 48,
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-titlebar)',
          }}
        >
          <Settings2 size={14} style={{ color: 'var(--accent-primary)' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Music Creator Settings
          </div>
          <button
            onClick={onClose}
            className="ml-auto flex items-center justify-center rounded-md transition-all hover:bg-[var(--bg-hover)]"
            style={{ width: 24, height: 24, color: 'var(--text-secondary)' }}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto invisible-scrollbar">
          <div className="px-5 py-4">
            <div className="mb-4">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                Model mapping
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Pick a model id per endpoint. Each dropdown lists every id
                the gateway exposes via <code style={{ margin: '0 4px', color: 'var(--accent-primary)' }}>/v1/models</code>,
                filtered to the right shape for that slot.
              </div>
              <ul
                style={{
                  fontSize: 10,
                  color: 'var(--text-disabled)',
                  lineHeight: 1.5,
                  marginTop: 6,
                  paddingLeft: 16,
                  listStyle: 'disc',
                }}
              >
                <li>
                  <strong style={{ color: 'var(--text-secondary)' }}>Music / Cover</strong> — sent in the
                  <code style={{ margin: '0 4px' }}>/music/generations</code> body.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-secondary)' }}>Lyrics</strong> — usually leave on Auto.
                  The <code style={{ margin: '0 4px' }}>/music/lyrics</code> endpoint runs minimax's
                  internal lyrics generator server-side (no enumerable id). Only
                  override if your gateway exposes a separate <code>lyrics_generation</code> alias.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-secondary)' }}>Lyrics fallback</strong> — chat model used
                  when <code style={{ margin: '0 4px' }}>/music/lyrics</code> errors (quota, upstream 502).
                </li>
              </ul>
            </div>

            {endpoints.length === 0 ? (
              <div
                className="flex items-center gap-2 px-3 py-3 rounded-lg"
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-titlebar)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <AlertCircle size={14} style={{ color: '#fbbf24' }} />
                No reachable endpoints yet — connect a Tytus pod or start
                local switchAILocal, then come back.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {endpoints.map((ep) => {
                  const ov = settings.overridesByEndpoint[ep.url] ?? {};
                  const slots: Array<{
                    key: keyof ModelOverrides;
                    label: string;
                    discovered: string | null;
                    kind: 'music' | 'cover' | 'lyrics' | 'chat';
                  }> = [
                    { key: 'music',        label: 'Music',          discovered: ep.models.music,        kind: 'music' as const },
                    { key: 'cover',        label: 'Cover',          discovered: ep.models.cover,        kind: 'cover' as const },
                    { key: 'lyrics',       label: 'Lyrics',         discovered: ep.models.lyrics,       kind: 'lyrics' as const },
                    { key: 'lyricsBackup', label: 'Lyrics fallback', discovered: ep.models.lyricsBackup, kind: 'chat' as const },
                  ];
                  // Filter the dropdown options by slot kind so users
                  // pick from the right pool: music slots see music ids,
                  // the chat-fallback slot only sees chat-shaped ids.
                  const isMusicy = (id: string) =>
                    /music|cover/i.test(id);
                  const optionsForSlot = (kind: 'music' | 'cover' | 'lyrics' | 'chat'): readonly string[] => {
                    if (kind === 'chat') {
                      return ep.models.allIds.filter((id) => !/music|cover|tts|stt|transcribe|whisper|embed|image/i.test(id));
                    }
                    return ep.models.allIds.filter((id) => isMusicy(id));
                  };
                  return (
                    <div
                      key={ep.podId}
                      className="rounded-lg p-3"
                      style={{
                        background: 'var(--bg-titlebar)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="rounded-full"
                          style={{
                            width: 6, height: 6,
                            background: endpointStatusColor(ep),
                            boxShadow: `0 0 6px ${endpointStatusColor(ep)}`,
                          }}
                        />
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {ep.label}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                          {ep.url} · {ep.models.allIds.length} models
                        </span>
                      </div>
                      <div className="grid gap-2" style={{ gridTemplateColumns: '120px 1fr' }}>
                        {slots.map((s) => {
                          const options = optionsForSlot(s.kind);
                          const currentValue = ov[s.key] ?? '';
                          return (
                            <Fragment key={s.key}>
                              <div
                                className="flex items-center"
                                style={{ fontSize: 11, color: 'var(--text-secondary)' }}
                              >
                                {s.label}
                              </div>
                              <select
                                value={currentValue}
                                onChange={(e) => setOverride(ep.url, s.key, e.target.value)}
                                className="w-full px-2 py-1 rounded-md focus:outline-none"
                                style={{
                                  height: 28,
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  background: 'var(--bg-window)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-primary)',
                                  appearance: 'auto',
                                }}
                              >
                                <option value="">
                                  {s.discovered
                                    ? `Auto · ${s.discovered}`
                                    : s.kind === 'lyrics'
                                      // /music/lyrics has a server-side
                                      // lyrics generator built in — no
                                      // model param needed for the auto
                                      // path. Override only if the
                                      // gateway exposes a separate id.
                                      ? 'Auto · server-side (no model param)'
                                      : options.length === 0
                                        ? '(no models match)'
                                        : 'Auto · (no preferred match — pick one)'}
                                </option>
                                {options.length > 0 && (
                                  <optgroup label="Available models">
                                    {options.map((id) => (
                                      <option key={id} value={id}>{id}</option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 flex-shrink-0"
          style={{
            height: 48,
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-titlebar)',
          }}
        >
          <button
            onClick={onClose}
            className="px-4 rounded-lg transition-all hover:bg-[var(--bg-hover)]"
            style={{
              height: 30,
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'var(--bg-window)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
