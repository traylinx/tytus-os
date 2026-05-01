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
  Pencil, Image as ImageIcon, Upload, RefreshCw, ChevronUp,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import JulietaHelp from './JulietaHelp';
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
  renameTrack as renameTrackRow,
  updateTrackCover as updateTrackCoverRow,
  updateTrackStyle as updateTrackStyleRow,
  updateTrackLyrics as updateTrackLyricsRow,
  updateTrackSpecs as updateTrackSpecsRow,
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
  // JSON-serialized TrackSpecs. Empty string = no specs were set
  // when this track was generated. Always a string at the row layer
  // so the SQLite repo doesn't need to handle null vs empty.
  specsJson: string;
  // Optional per-track cover art (base64 data URL). Empty string =
  // no cover yet — UI falls back to the default Disc3 gradient
  // glyph. Auto-generation is deferred to a Host API verb post-
  // extraction; today the field is plumbed but never set inline.
  coverDataUrl: string;
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
  cover: string | null;          // music-cover / restyle (audio style transfer)
  lyrics: string | null;         // dedicated /music/lyrics model id
  lyricsBackup: string | null;   // chat model used when `lyrics` errors
  // Image-generation model id for album-cover-art creation. Populated
  // by the `/v1/models` regex matcher; null if the endpoint doesn't
  // expose one. The cover-art generator gracefully degrades to "no
  // auto art" when this is null — track is still saved.
  image: string | null;
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

// Curated 19-family / ~220-genre hierarchy. Sourced from the canonical
// genre spec (popular families × representative subgenres, including
// Flamenco palos and avant-garde) so the palette roughly mirrors how
// streaming services organise their catalogues. Two non-genre groups
// stay at the end (Mood, Kids/Holiday) because creators reach for those
// as descriptors more than as genres.
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
    label: 'Flamenco',
    chips: [
      'Flamenco', 'Bulerías', 'Soleá', 'Alegrías', 'Seguiriyas',
      'Tangos (flamenco)', 'Tientos', 'Fandangos (flamenco)', 'Sevillanas',
      'Tarantas', 'Malagueñas', 'Granaínas',
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
    label: 'Reggaeton-Adjacent Urban Latin',
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
      'Experimental', 'Avant-garde', 'Musique concrète', 'Electroacoustic music',
      'Minimalism', 'Drone music', 'Noise music', 'Harsh noise',
      'Free improvisation', 'Free jazz', 'Industrial', 'Power electronics',
      'IDM (Intelligent dance music)', 'Math rock', 'No wave',
      'Experimental rock', 'Avant-pop', 'Experimental pop', 'Vaporwave',
      'Deconstructed club', 'Glitch', 'Sound art', 'Tape music',
      'Soundscape composition',
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

// ──────────────────────────────────────────────────────────
// Track specs — structured controls that compile into the
// Style prompt before submission. Mirrors the canonical
// track_specs_schema (subset: detection-only audio_features
// and abstract texture/melody fields are intentionally out).
// All fields optional; an empty TrackSpecs compiles to "".
// ──────────────────────────────────────────────────────────

type TempoClass = 'very_slow' | 'slow' | 'medium' | 'fast' | 'very_fast';
type TimeSignature = '3/4' | '4/4' | '6/8' | '7/8' | '5/4' | 'other';
type RhythmFeel = 'straight' | 'swing' | 'shuffled' | 'syncopated' | 'polyrhythmic' | 'free';
type GroovePattern = 'four_on_the_floor' | 'halftime' | 'doubletime' | 'broken_beat' | 'backbeat' | 'free';
type SongForm = 'verse_chorus' | 'aaba' | 'drop_based' | 'loop_based' | 'through_composed' | 'strophic';
type KeyName = 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'Gb' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';
type MusicalMode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'phrygian' | 'lydian' | 'locrian';
type DynamicRange = 'narrow' | 'medium' | 'wide';
type CrescendoShape = 'none' | 'gradual' | 'sudden';
type Intensity = 'low' | 'medium' | 'high';
type EraRef = '60s' | '70s' | '80s' | '90s' | '2000s' | '2010s' | '2020s' | 'timeless';
type CulturalRegion = 'global' | 'us_uk' | 'latin' | 'afrobeats_scene' | 'kpop_scene' | 'jpop_scene' | 'caribbean' | 'middle_east' | 'asia_other' | 'europe_other';
type VocalGender = 'male' | 'female' | 'mixed' | 'other' | 'none';

interface TrackSpecs {
  structure?: {
    tempo_bpm?: number;
    tempo_class?: TempoClass;
    time_signature?: TimeSignature;
    rhythm_feel?: RhythmFeel;
    groove_pattern?: GroovePattern;
    song_form?: SongForm;
    length_seconds?: number;
  };
  tonal?: {
    key?: KeyName;
    mode?: MusicalMode;
  };
  instrumentation?: {
    primary_instruments?: string[];
    has_vocals?: boolean;
    vocal_style?: string[];
    vocal_gender?: VocalGender;
    vocal_processing?: string[];
    language_iso639_1?: string;
  };
  dynamics?: {
    overall_dynamic_range?: DynamicRange;
    has_big_drops?: boolean;
    crescendo_shape?: CrescendoShape;
  };
  mood?: {
    primary_moods?: string[];
    emotional_intensity?: Intensity;
    occasion_tags?: string[];
  };
  context?: {
    era_reference?: EraRef;
    cultural_region?: CulturalRegion;
    explicit_lyrics?: boolean;
    intended_use?: string[];
  };
  // Free-form user direction for lyrics: mood, perspective, taboo
  // lines, references, "make it bilingual", etc. Surfaced as its own
  // textarea on the form (not a chip in the SpecsCard) and threaded
  // into the lyrics LLM prompt as `User intent: ...`. Lives in
  // TrackSpecs so it round-trips for free via specsJson — no schema
  // bump needed.
  intent?: string;
}

// Option lists used by the panel UI. Kept inline (not exported) because
// they're tightly coupled to the prompt-compile logic below — changing
// an enum here means both the chip and the resulting prose update.
const TEMPO_CLASSES: readonly TempoClass[] = ['very_slow', 'slow', 'medium', 'fast', 'very_fast'];
const TIME_SIGS: readonly TimeSignature[] = ['3/4', '4/4', '6/8', '7/8', '5/4', 'other'];
const RHYTHM_FEELS: readonly RhythmFeel[] = ['straight', 'swing', 'shuffled', 'syncopated', 'polyrhythmic', 'free'];
const GROOVES: readonly GroovePattern[] = ['four_on_the_floor', 'halftime', 'doubletime', 'broken_beat', 'backbeat', 'free'];
const SONG_FORMS: readonly SongForm[] = ['verse_chorus', 'aaba', 'drop_based', 'loop_based', 'through_composed', 'strophic'];
const KEYS: readonly KeyName[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MODES: readonly MusicalMode[] = ['major', 'minor', 'dorian', 'mixolydian', 'phrygian', 'lydian', 'locrian'];
const DYNAMIC_RANGES: readonly DynamicRange[] = ['narrow', 'medium', 'wide'];
const CRESCENDOS: readonly CrescendoShape[] = ['none', 'gradual', 'sudden'];
const INTENSITIES: readonly Intensity[] = ['low', 'medium', 'high'];
const ERAS: readonly EraRef[] = ['60s', '70s', '80s', '90s', '2000s', '2010s', '2020s', 'timeless'];
const CULTURAL_REGIONS: readonly CulturalRegion[] = ['global', 'us_uk', 'latin', 'afrobeats_scene', 'kpop_scene', 'jpop_scene', 'caribbean', 'middle_east', 'asia_other', 'europe_other'];
const VOCAL_GENDERS: readonly VocalGender[] = ['male', 'female', 'mixed', 'other', 'none'];
const PRIMARY_INSTRUMENTS: readonly string[] = [
  'drums_acoustic', 'drum_machine', 'percussion', 'bass_electric', 'bass_synth',
  'bass_upright', 'electric_guitar', 'acoustic_guitar', 'piano', 'keys_synth',
  'organ', 'strings', 'brass', 'woodwinds', 'synth_pad', 'synth_lead',
  'pluck_synth', 'fx', 'lead_vocal', 'choir',
];
const VOCAL_STYLES: readonly string[] = ['sung', 'rap', 'spoken_word', 'chant', 'choir', 'vocoder'];
const VOCAL_PROCESSING: readonly string[] = [
  'dry', 'reverb', 'delay', 'autotune_light', 'autotune_heavy', 'distortion',
  'chorus', 'double_tracked',
];
const PRIMARY_MOODS: readonly string[] = [
  'happy', 'uplifting', 'dark', 'melancholic', 'dreamy', 'chill', 'epic',
  'romantic', 'energetic', 'aggressive',
];
const OCCASION_TAGS: readonly string[] = [
  'party', 'club', 'study', 'sleep', 'workout', 'background', 'focus',
  'film_trailer', 'game', 'kids', 'holiday_christmas',
];
const INTENDED_USES: readonly string[] = [
  'background', 'featured_listen', 'sync_film', 'sync_ad', 'game', 'live_show_intro',
];

// Renders snake_case enum values as natural English ("four on the floor",
// "spoken word"). Kept here so both the prompt compile and the panel
// labels share one capitalization / spacing rule.
const humanize = (raw: string): string => raw.replace(/_/g, ' ');

// Synthesize a short title from whatever the user gave us. Best-effort,
// pure (no AI). Order:
//   1. First non-tag line of lyrics that looks like a hook (4+ words,
//      not all caps, no [Section] markers).
//   2. First 6 words of the theme.
//   3. First 6 words of the style.
//   4. "Untitled".
// Used as the last-resort fallback when both songName and the lyrics
// model's song_title field are empty / literally "Untitled".
const synthesizeTitleLocal = (
  lyrics: string,
  theme: string,
  style: string,
): string => {
  const cleanLine = (s: string) => s.trim().replace(/^[-••\d.)(]+\s*/, '').trim();
  const words = (s: string, n: number) => cleanLine(s).split(/\s+/).slice(0, n).join(' ');
  if (lyrics) {
    const candidate = lyrics
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('[') && !l.startsWith('(') && l.split(/\s+/).length >= 3);
    if (candidate) {
      const trimmed = words(candidate, 6).replace(/[,.!?;:—-]+$/, '').trim();
      if (trimmed.length >= 3) return trimmed;
    }
  }
  if (theme.trim()) {
    const t = words(theme, 6).replace(/[,.!?;:—-]+$/, '').trim();
    if (t.length >= 3) return t;
  }
  if (style.trim()) {
    const s = words(style, 4).replace(/[,.!?;:—-]+$/, '').trim();
    if (s.length >= 3) return s;
  }
  return 'Untitled';
};

// Pure function — turn a TrackSpecs into a single-line prompt suffix
// suitable for appending to the user's free-text Style. Empty in →
// empty out, so callers don't need to special-case the "no specs" path.
const compileSpecsToText = (s: TrackSpecs): string => {
  const lines: string[] = [];

  // Structure
  const structure: string[] = [];
  if (s.structure?.tempo_bpm) structure.push(`${s.structure.tempo_bpm} BPM`);
  else if (s.structure?.tempo_class) structure.push(`${humanize(s.structure.tempo_class)} tempo`);
  if (s.structure?.time_signature && s.structure.time_signature !== 'other') {
    structure.push(`${s.structure.time_signature} time`);
  }
  if (s.structure?.rhythm_feel) structure.push(`${s.structure.rhythm_feel} feel`);
  if (s.structure?.groove_pattern) structure.push(`${humanize(s.structure.groove_pattern)} groove`);
  if (s.structure?.song_form) structure.push(`${humanize(s.structure.song_form)} form`);
  if (s.structure?.length_seconds) structure.push(`~${s.structure.length_seconds}s`);
  if (structure.length) lines.push(structure.join(', '));

  // Key
  if (s.tonal?.key) {
    const k = s.tonal.mode ? `${s.tonal.key} ${s.tonal.mode}` : s.tonal.key;
    lines.push(`Key: ${k}`);
  }

  // Instruments
  if (s.instrumentation?.primary_instruments?.length) {
    lines.push(`Instruments: ${s.instrumentation.primary_instruments.map(humanize).join(', ')}`);
  }

  // Vocals
  if (s.instrumentation?.has_vocals === false) {
    lines.push('Instrumental, no vocals');
  } else if (
    s.instrumentation?.has_vocals
    || s.instrumentation?.vocal_style?.length
    || s.instrumentation?.vocal_gender
    || s.instrumentation?.vocal_processing?.length
  ) {
    const v: string[] = [];
    if (s.instrumentation.vocal_gender && s.instrumentation.vocal_gender !== 'none') {
      v.push(s.instrumentation.vocal_gender);
    }
    if (s.instrumentation.vocal_style?.length) {
      v.push(s.instrumentation.vocal_style.map(humanize).join('/'));
    } else if (v.length === 0) {
      v.push('vocals');
    }
    let line = v.join(' ');
    if (s.instrumentation.vocal_processing?.length) {
      line += ` with ${s.instrumentation.vocal_processing.map(humanize).join(' + ')}`;
    }
    lines.push(line);
  }
  if (s.instrumentation?.language_iso639_1) {
    lines.push(`Language: ${s.instrumentation.language_iso639_1}`);
  }

  // Dynamics
  const dyn: string[] = [];
  if (s.dynamics?.overall_dynamic_range) dyn.push(`${s.dynamics.overall_dynamic_range} dynamics`);
  if (s.dynamics?.crescendo_shape && s.dynamics.crescendo_shape !== 'none') {
    dyn.push(`${s.dynamics.crescendo_shape} crescendo`);
  }
  if (s.dynamics?.has_big_drops) dyn.push('big drops');
  if (dyn.length) lines.push(dyn.join(', '));

  // Mood
  if (s.mood?.primary_moods?.length) {
    lines.push(`Mood: ${s.mood.primary_moods.join(', ')}`);
  }
  if (s.mood?.emotional_intensity) lines.push(`${s.mood.emotional_intensity} intensity`);
  if (s.mood?.occasion_tags?.length) {
    lines.push(`For: ${s.mood.occasion_tags.map(humanize).join(', ')}`);
  }

  // Context
  const ctx: string[] = [];
  if (s.context?.era_reference) ctx.push(`${s.context.era_reference} era`);
  if (s.context?.cultural_region && s.context.cultural_region !== 'global') {
    ctx.push(`${humanize(s.context.cultural_region)} scene`);
  }
  if (s.context?.intended_use?.length) {
    ctx.push(`use: ${s.context.intended_use.map(humanize).join('/')}`);
  }
  if (s.context?.explicit_lyrics) ctx.push('explicit lyrics');
  if (ctx.length) lines.push(ctx.join(', '));

  return lines.join('. ');
};

// Named lyric structures. Each carries a `skeleton` (the raw text
// the user gets when they click the chip — instant scaffolding for
// hand-writing) AND a `prompt` (the structural constraint sent to
// the lyrics-generation LLM when this template is the active one).
//
// Picking a template before clicking "Write Lyrics" makes the model
// produce lyrics that actually fit the structure — much better than
// the model picking its own form and the user re-templating after.
//
// Keys/structures sourced from common songwriting forms (verse-
// chorus is ~70% of charts, AABA is the standard for ballads /
// jazz, drop-based fits EDM / pop dance, narrative is for storytelling
// folk / rap, hook-loop is for trap / hip-hop).
interface LyricTemplate {
  id: string;
  label: string;
  description: string;
  skeleton: string;
  prompt: string;
}

const LYRIC_TEMPLATES: readonly LyricTemplate[] = [
  {
    id: 'verse_chorus',
    label: 'Verse-Chorus',
    description: 'Pop / rock standard — radio-friendly, repeating chorus.',
    skeleton: '[Verse 1]\n\n\n[Chorus]\n\n\n[Verse 2]\n\n\n[Chorus]\n\n\n[Bridge]\n\n\n[Chorus]\n\n\n[Outro]\n',
    prompt: 'Use the standard verse-chorus form: [Verse 1] (4 lines, set up the story), [Chorus] (4 lines, the hook with the song title or central image, repeated identically each time), [Verse 2] (4 lines, deepen or twist the story), [Chorus] (same as before), [Bridge] (2-4 lines, contrast — new perspective or emotional turn), [Chorus] (final repeat), [Outro] (1-2 lines, resolution).',
  },
  {
    id: 'aaba',
    label: 'AABA Ballad',
    description: 'Storytelling / jazz — three matching verses with a contrasting bridge.',
    skeleton: '[Verse A]\n\n\n[Verse A2]\n\n\n[Bridge B]\n\n\n[Verse A3]\n',
    prompt: 'Use the AABA form (Tin Pan Alley / classic ballad): [Verse A] 8 lines establishing scene + mood, [Verse A2] 8 lines same melody-shape, advances the story, [Bridge B] 8 lines contrasting key/melody/perspective — the emotional climb, [Verse A3] 8 lines returning to the original feel for resolution. Maintain consistent rhyme scheme across the A sections (typically AABB or ABAB).',
  },
  {
    id: 'drop',
    label: 'Drop / EDM',
    description: 'Build-up → drop → repeat — for dance, EDM, pop dance.',
    skeleton: '[Intro]\n\n\n[Verse]\n\n\n[Pre-Chorus / Build]\n\n\n[Drop / Hook]\n\n\n[Verse 2]\n\n\n[Pre-Chorus / Build]\n\n\n[Drop / Hook]\n\n\n[Outro]\n',
    prompt: 'Use the drop-based EDM form: [Intro] 1-2 atmospheric lines, [Verse] 4 lines low energy, [Pre-Chorus / Build] 2-4 lines ramping up tension with shorter phrases, [Drop / Hook] 2-4 short repeating lines (the chant — designed to be screamed at a festival), [Verse 2] same shape as Verse 1 with story progression, [Pre-Chorus / Build] same, [Drop / Hook] (identical repeat), [Outro] 1-2 lines fading. Keep the Drop simple, percussive, easy to repeat.',
  },
  {
    id: 'narrative',
    label: 'Narrative',
    description: 'Story-first — folk, country, rap, story-rap, country.',
    skeleton: '[Verse 1 — setup]\n\n\n[Verse 2 — rising action]\n\n\n[Hook / Refrain]\n\n\n[Verse 3 — climax]\n\n\n[Hook / Refrain]\n\n\n[Verse 4 — resolution]\n\n\n[Final Hook]\n',
    prompt: 'Use a narrative arc form: each verse advances the story (setup → rising action → climax → resolution). [Verse 1 — setup] 4-6 lines introducing characters and stakes, [Verse 2 — rising action] 4-6 lines escalating, [Hook / Refrain] 2-4 lines stating the song\'s core truth or feeling, [Verse 3 — climax] 4-6 lines at maximum tension, [Hook / Refrain] (repeat), [Verse 4 — resolution] 4-6 lines after the climax — what changed, what was learned, [Final Hook]. The hook should feel different in meaning each time it returns even though the words repeat.',
  },
  {
    id: 'hook_loop',
    label: 'Hook-Loop',
    description: 'Trap / hip-hop / rap — short hook, two verses, post-hook.',
    skeleton: '[Hook]\n\n\n[Verse 1]\n\n\n[Hook]\n\n\n[Verse 2]\n\n\n[Hook]\n\n\n[Post-Hook / Outro]\n',
    prompt: 'Use the hook-loop trap form: [Hook] 4 short, repeatable lines (this is the heart — written FIRST, designed to loop), [Verse 1] 12-16 lines with internal rhyme and triplet flow, [Hook] (identical repeat), [Verse 2] 12-16 lines escalating energy or content, [Hook] (identical repeat), [Post-Hook / Outro] 2-4 lines — sometimes ad-libs or a tag. Verses should rhyme densely (multisyllabic, internal). Keep the Hook 4 lines max — repetition is the engine.',
  },
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
  // Older serialized payloads predate SCHEMA_V5 — coerce missing
  // specsJson into an empty string so the row insert satisfies the
  // NOT NULL column. Same shape regardless of source.
  const normalize = (t: Partial<SavedTrack>): SavedTrack => ({
    id: t.id ?? `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: t.title ?? 'Untitled',
    styleTags: t.styleTags ?? '',
    lyricsPreview: t.lyricsPreview ?? '',
    durationMs: t.durationMs ?? 0,
    bitrate: t.bitrate ?? 0,
    sampleRate: t.sampleRate ?? 0,
    sizeBytes: t.sizeBytes ?? 0,
    createdAt: t.createdAt ?? Date.now(),
    audioDataUrl: t.audioDataUrl ?? '',
    specsJson: t.specsJson ?? '',
    coverDataUrl: t.coverDataUrl ?? '',
  });

  // Phase 1: drain localStorage (the very-first prototype storage).
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const track of parsed as Partial<SavedTrack>[]) {
          try { await insertTrackRow(normalize(track)); } catch { /* skip */ }
        }
      }
      localStorage.removeItem(LEGACY_LS_KEY);
    }
  } catch (e) {
    console.warn('Legacy localStorage gallery migration failed:', e);
  }

  // Phase 2: drain IndexedDB (the brief intermediate storage).
  try {
    const tracks = await new Promise<Partial<SavedTrack>[]>((resolve) => {
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
          resolve((getAll.result ?? []) as Partial<SavedTrack>[]);
        };
        getAll.onerror = () => { db.close(); resolve([]); };
      };
      req.onerror = () => resolve([]);
    });
    for (const track of tracks) {
      try { await insertTrackRow(normalize(track)); } catch { /* skip */ }
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
  music: null, cover: null, lyrics: null, lyricsBackup: null, image: null, allIds: [],
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

  // Image-gen model. Priority order matters because switchAILocal's
  // `ail-image` alias on the local gateway routes to BFL/FLUX which
  // has its own credit pool (and can 402 out independently of MiniMax),
  // while `minimax:image-01` calls the user's MiniMax token plan
  // directly. Always prefer the MiniMax path first, fall through to
  // BFL/DALL-E/FLUX/SDXL if MiniMax isn't on this endpoint.
  const image = findIn(ids, [
    /(^|[/:])minimax:image-01$/,            // local switchAILocal canonical
    /(^|[/:])image-01$/,                     // bare alias (no provider prefix)
    /(^|[/:])minimax:image$/,
    /(^|[/:])minimax:cover-art$/,
    /(^|[/:])ail-image$/,                    // remote AIL pod alias
    /(^|[/:])dall-?e/i,
    /(^|[/:])flux/i,
    /(^|[/:])sdxl/i,
    /image[-_:]?(gen|01)/i,
    /image/i,
    /diffusion/i,
  ]);

  return { music, cover, lyrics, lyricsBackup, image, allIds: ids };
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
// Once we know a URL is browser-unreachable we stop probing it for a
// while so the console stays clean on every daemon-state re-render.
// TTL'd (60s) so a pod that comes online later or has its CORS
// header fixed mid-session can recover without a full app reload.
const CORS_BLOCK_TTL_MS = 60_000;
const corsBlocked = new Map<string, number>(); // url → expires-at (ms)

const probeAndDiscover = async (
  cand: PodEndpoint,
  signal: AbortSignal,
): Promise<{ ok: boolean; models: DiscoveredModels }> => {
  const blockedUntil = corsBlocked.get(cand.url);
  if (blockedUntil !== undefined) {
    if (Date.now() < blockedUntil) {
      return { ok: false, models: NO_MODELS };
    }
    // TTL expired — clear and re-probe.
    corsBlocked.delete(cand.url);
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
    if (name === 'TypeError') corsBlocked.set(cand.url, Date.now() + CORS_BLOCK_TTL_MS);
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

// Retryable HTTP statuses for ALL gateway calls. Borrowed from the
// lyrics path which had this set first (now also imposed on music,
// image, and chat-fallback paths so failures fall through consistently).
// 402 Payment Required (one upstream provider out of credits — try the
// next id, e.g. switchAILocal routes `ail-image` → BFL/FLUX which can
// 402 while `minimax:image-01` still has quota), 408 Request Timeout,
// 425 Too Early, 429 Too Many, 500/502/503/504 transient gateway
// errors. Hard 4xx (400/401/403/404) are NOT here — those are config
// bugs that retrying won't fix.
const RETRYABLE_GATEWAY_STATUSES = new Set([402, 408, 425, 429, 500, 502, 503, 504]);

// Error subclass that carries the HTTP status. Lets the multi-model
// fallback loop tell "retryable" (try next model) from "fatal" (throw
// immediately) without parsing the message string.
class GatewayError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = 'GatewayError';
    this.status = status;
    this.body = body;
  }
}

// Iterate a list of model ids, calling `attempt(modelId)` for each.
// Retryable HTTP errors (RETRYABLE_GATEWAY_STATUSES) and TypeError
// (network/CORS flap) fall through to the next id. AbortError throws
// immediately so user-driven cancels never burn extra models. Hard
// errors throw immediately.
//
// `kind` is just for the "all models exhausted" message ("music",
// "image", "lyrics", "chat assist"). Empty input => throws synchronously.
const tryWithModelFallback = async <T,>(
  modelIds: readonly string[],
  attempt: (modelId: string) => Promise<T>,
  kind: string,
): Promise<T> => {
  if (modelIds.length === 0) {
    throw new Error(`No ${kind}-capable models available on this endpoint.`);
  }
  let lastErr: unknown = null;
  for (const id of modelIds) {
    try {
      return await attempt(id);
    } catch (e) {
      // Cancel always wins — never burn the rest of the pool.
      if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') {
        throw e;
      }
      // Network errors (TypeError on fetch) → try next.
      if (e instanceof TypeError) { lastErr = e; continue; }
      // Gateway errors with a retryable status → try next.
      if (e instanceof GatewayError && RETRYABLE_GATEWAY_STATUSES.has(e.status)) {
        lastErr = e;
        continue;
      }
      // Anything else (hard 4xx, parse error, validation throw) is fatal —
      // retrying won't help and a different model would just burn quota.
      throw e;
    }
  }
  const lastMsg = (lastErr as Error)?.message ?? 'unknown';
  throw new Error(`All ${kind} models exhausted. Last error: ${lastMsg}. Wait for the rate limit to reset, or pick a different endpoint in Settings.`);
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
  // Build a chat-model pool: lyricsBackup first, then any other
  // chat-shaped id from /v1/models. Excludes audio/embed/image/rerank
  // ids so the loop doesn't waste calls on non-text models.
  const isChatty = (id: string) =>
    !/music|cover|tts|stt|transcribe|whisper|embed|image|diffusion|dall-?e|flux|sdxl|rerank/i.test(id);
  const chatSeen = new Set<string>();
  const chatPool: string[] = [];
  const pushChat = (id: string | null | undefined) => {
    if (id && !chatSeen.has(id)) { chatSeen.add(id); chatPool.push(id); }
  };
  pushChat(endpoint.models.lyricsBackup);
  endpoint.models.allIds.filter(isChatty).forEach(pushChat);
  if (chatPool.length === 0) {
    throw new Error(
      `Lyrics endpoint failed and no chat backup model is available for ${endpoint.label}. Pick one in Music Creator Settings.`,
    );
  }
  const sys = `You are a songwriter. Given a theme, write a complete singable song.
Respond with VALID JSON ONLY in exactly this shape, nothing else:
{
  "song_title": "Short catchy title",
  "style_tags": "comma, separated, style, hints",
  "lyrics": "[Verse]\\nFour lines\\n\\n[Chorus]\\nFour lines\\n\\n[Verse]\\nFour lines\\n\\n[Chorus]\\nFour lines\\n\\n[Bridge]\\nTwo lines\\n\\n[Outro]\\nTwo lines"
}`;
  const parsed = await tryWithModelFallback(chatPool, async (modelId) => {
    // Some gateways/models reject `response_format: json_object` (older
    // MiniMax aliases, Hermes). On a fatal 400 with that param we retry
    // the SAME model without it before falling through to the next id.
    const baseBody: Record<string, unknown> = {
      model: modelId,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Theme: ${prompt}` },
      ],
      temperature: 0.85,
    };
    const sendChat = async (withJsonMode: boolean): Promise<LyricsResponse> => {
      const fallbackTimeout = withTimeout(signal, LYRICS_TIMEOUT_MS);
      let resp: Response;
      try {
        resp = await fetch(`${endpoint.url}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${endpoint.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            withJsonMode
              ? { ...baseBody, response_format: { type: 'json_object' } }
              : baseBody,
          ),
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
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new GatewayError(resp.status, errBody, `Lyrics fallback HTTP ${resp.status}: ${errBody.slice(0, 300)}`);
      }
      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!content) {
        throw new GatewayError(502, '', 'Lyrics fallback returned empty content');
      }
      const stripped = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      let p: LyricsResponse;
      try {
        p = JSON.parse(stripped) as LyricsResponse;
      } catch {
        // Treat parse failure as 502 so the multi-model loop tries the
        // next chat id rather than dying on one model's prose habit.
        console.warn('[callLyrics] non-JSON fallback content:', content.slice(0, 400));
        throw new GatewayError(502, content.slice(0, 200), `Lyrics fallback returned non-JSON content: ${content.slice(0, 200)}`);
      }
      if (!p.lyrics) {
        throw new GatewayError(502, '', 'Lyrics fallback JSON missing "lyrics" field');
      }
      return p;
    };
    try {
      return await sendChat(true);
    } catch (e) {
      // 400 with json mode → retry without it ONCE on the same model.
      // Don't downgrade other 4xx (401/403/404 are real config errors).
      if (e instanceof GatewayError && e.status === 400 && /response_format|json_object/i.test(e.body)) {
        console.warn('[callLyrics] model rejected json_object, retrying without:', modelId);
        return await sendChat(false);
      }
      throw e;
    }
  }, 'chat-lyrics');
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
  // Model pool for the multi-model fallback. Primary first, then any
  // other music-shaped ids on the endpoint that aren't the cover model
  // (the cover model only works with audio_base64). For restyle, prefer
  // cover-shaped ids; the regular music model is the last-resort fallback
  // since it ignores audio_base64. Without a list at all, the call fails
  // with a friendly "no music model" error.
  const isMusicy = (id: string) =>
    /music/i.test(id) && !/cover/i.test(id);
  const isCoverModel = (id: string) => /cover/i.test(id);
  const seen = new Set<string>();
  const pushUniq = (acc: string[], id: string | null | undefined) => {
    if (id && !seen.has(id)) { seen.add(id); acc.push(id); }
  };
  const modelIds: string[] = [];
  if (isCover) {
    pushUniq(modelIds, endpoint.models.cover);
    endpoint.models.allIds.filter(isCoverModel).forEach((id) => pushUniq(modelIds, id));
    pushUniq(modelIds, endpoint.models.music);
  } else {
    pushUniq(modelIds, endpoint.models.music);
    endpoint.models.allIds.filter(isMusicy).forEach((id) => pushUniq(modelIds, id));
  }
  if (modelIds.length === 0) {
    throw new Error(
      isCover
        ? `This endpoint (${endpoint.label}) doesn't expose a music-cover model. Try a different connection.`
        : `This endpoint (${endpoint.label}) doesn't expose a music model. Try a different connection.`,
    );
  }
  return tryWithModelFallback(modelIds, async (modelId) => {
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
      throw new GatewayError(r.status, errBody, `Music HTTP ${r.status}: ${errBody.slice(0, 300)}`);
    }
    const json = await r.json() as MusicResponse;
    // Validate inside the helper so multi-model fallback can retry on
    // empty/malformed responses (some gateways 200-respond with no audio
    // when an upstream flaps).
    if (!json?.data?.audio || typeof json.data.audio !== 'string' || json.data.audio.length < 100) {
      throw new GatewayError(502, '', 'Music gen returned no audio data — gateway accepted the call but upstream returned nothing.');
    }
    return json;
  }, isCover ? 'music-cover' : 'music');
};

// ──────────────────────────────────────────────────────────
// Image generation — album-cover art for tracks
// ──────────────────────────────────────────────────────────
//
// Two pure functions:
//   - deriveCoverPrompt(title, theme, style) — a dependable auto-prompt
//     when the user hasn't typed their own. Squeezes the song's identity
//     into a short, image-friendly description ("album cover art for a
//     <style> song titled '<title>'. Mood: <theme excerpt>. <visual
//     style hint>.").
//   - callImageGen(endpoint, prompt, signal) — POSTs to /v1/images/
//     generations, accepts a few common response shapes (b64_json, url,
//     {data:{image}}), returns a base64 data URL ready to drop into <img>
//     or persist to coverDataUrl. Fails soft: throws with a clear message
//     on HTTP error / unparseable body so the caller can choose to swallow
//     and save the track without art.

const IMAGE_TIMEOUT_MS = 60_000;

const deriveCoverPrompt = (title: string, theme: string, style: string): string => {
  const cleanTitle = title.trim().replace(/\s*\((lyrics|cover|restyle)\)\s*$/, '') || 'a song';
  const styleHint = style.trim().split(/[,;\n]/).slice(0, 3).join(', ').trim();
  // Theme excerpt — keep it short and treat it as a mood hint, not a
  // literal scene. Image models can't reliably draw a 4-sentence story.
  const themeExcerpt = theme.trim().split(/[.!?\n]/)[0]?.slice(0, 140).trim() ?? '';
  const parts: string[] = [
    `Square album cover art for a song titled "${cleanTitle}".`,
  ];
  if (styleHint) parts.push(`Genre: ${styleHint}.`);
  if (themeExcerpt) parts.push(`Mood: ${themeExcerpt}.`);
  parts.push('Editorial, expressive, vivid colors, no text, no words, no logos, no lyrics overlay.');
  return parts.join(' ');
};

const callImageGen = async (
  endpoint: PodEndpoint,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> => {
  // Build the same primary-then-pool fallback list the music path uses.
  // Image-shaped ids are anything matching image|diffusion|dall-?e|flux|sdxl.
  const isImagey = (id: string) =>
    /image|diffusion|dall-?e|flux|sdxl/i.test(id);
  const seen = new Set<string>();
  const modelIds: string[] = [];
  const pushUniq = (id: string | null | undefined) => {
    if (id && !seen.has(id)) { seen.add(id); modelIds.push(id); }
  };
  pushUniq(endpoint.models.image);
  endpoint.models.allIds.filter(isImagey).forEach(pushUniq);
  if (modelIds.length === 0) {
    throw new Error(`This endpoint (${endpoint.label}) doesn't expose an image-generation model. Pick one in Music Creator Settings → Cover art, or upload your own image.`);
  }
  return tryWithModelFallback(modelIds, async (modelId) => {
    const timeout = withTimeout(signal, IMAGE_TIMEOUT_MS);
    // MiniMax-compatible body shape (verified 2026-05-01 against both
    // local switchAILocal `minimax:image-01` and remote AIL pod
    // `ail-image` — both reject `response_format: 'b64_json'` with
    // status_code 2013 and require `aspect_ratio` over `size`).
    // For OpenAI-/BFL-/SDXL-style models we send a hybrid body: every
    // gateway we've tested ignores unknown fields, so including BOTH
    // `aspect_ratio` and `size` plus `response_format: 'base64'` works
    // for MiniMax while OpenAI-compat models still see what they need.
    const isMinimaxShape = /minimax|ail-image|image-01/i.test(modelId);
    const body: Record<string, unknown> = isMinimaxShape
      ? {
          model: modelId,
          prompt,
          aspect_ratio: '1:1',
          response_format: 'base64',
        }
      : {
          model: modelId,
          prompt,
          size: '1024x1024',
          n: 1,
          response_format: 'b64_json',
        };
    let resp: Response;
    try {
      resp = await fetch(`${endpoint.url}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${endpoint.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: timeout.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'TimeoutError') {
        throw new Error(`Cover-art request timed out after ${IMAGE_TIMEOUT_MS / 1000}s.`);
      }
      throw e;
    } finally {
      timeout.dispose();
    }
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new GatewayError(resp.status, errBody, `Cover-art HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
    }
    // Common shapes seen in the wild:
    //   { data: { image_base64: ["..."] } }         (MiniMax — verified)
    //   { data: { image: "<base64>" } }              (some MiniMax aliases)
    //   { data: [ { b64_json: "..." } ] }            (OpenAI canonical)
    //   { data: [ { url: "https://..." } ] }         (URL-only path)
    //   { image: "<base64>" }                         (bare)
    //   { images: [ { b64_json: ... } ] }             (multi-image)
    // Plus the MiniMax error envelope {data: null, base_resp: {status_code, status_msg}}
    // where status_code !== 0 means failure even on HTTP 200.
    const json = await resp.json() as Record<string, unknown>;
    // MiniMax error envelope first — turns "200 with empty data" into a
    // retryable 502 so the multi-model loop walks past it.
    const baseResp = json.base_resp as { status_code?: number; status_msg?: string } | undefined;
    if (baseResp && typeof baseResp.status_code === 'number' && baseResp.status_code !== 0) {
      throw new GatewayError(502, baseResp.status_msg ?? '', `Cover-art ${modelId} rejected: ${baseResp.status_msg ?? 'status_code=' + baseResp.status_code}`);
    }
    const tryB64 = (v: unknown): string | null => {
      if (typeof v !== 'string' || !v.length) return null;
      return v.startsWith('data:') ? v : `data:image/png;base64,${v}`;
    };
    const tryUrl = (v: unknown): string | null =>
      typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null;

    const dataField = json.data;
    // MiniMax canonical: { data: { image_base64: ["..."] } } — array of
    // base64 strings under data.image_base64. Hit this first because
    // it's what both local minimax:image-01 and remote ail-image return.
    if (dataField && typeof dataField === 'object' && !Array.isArray(dataField)) {
      const inner = dataField as Record<string, unknown>;
      const arr = inner.image_base64;
      if (Array.isArray(arr) && arr[0]) {
        const out = tryB64(arr[0]);
        if (out) return out;
      }
      const direct = tryB64(inner.image) ?? tryB64(inner.b64_json) ?? tryUrl(inner.url);
      if (direct) return direct;
      // Some MiniMax variants put url(s) in image_url / image_urls.
      const urlArr = inner.image_url ?? inner.image_urls;
      if (Array.isArray(urlArr) && urlArr[0]) {
        const out = tryUrl(urlArr[0]);
        if (out) return out;
      }
    }
    // OpenAI canonical: { data: [ { b64_json | url } ] }.
    if (Array.isArray(dataField) && dataField[0]) {
      const first = dataField[0] as Record<string, unknown>;
      const out = tryB64(first.b64_json) ?? tryB64(first.image_base64) ?? tryUrl(first.url);
      if (out) return out;
      throw new GatewayError(502, '', 'Cover-art response missing b64_json/url in data[0]');
    }
    const bare = tryB64(json.image) ?? tryB64(json.b64_json);
    if (bare) return bare;
    const imagesField = json.images;
    if (Array.isArray(imagesField) && imagesField[0]) {
      const first = imagesField[0] as Record<string, unknown>;
      const img = tryB64(first.b64_json) ?? tryB64(first.image) ?? tryUrl(first.url);
      if (img) return img;
    }
    // Unparseable response — treat as 502 so the next image model gets a
    // shot. If every image model is broken we surface the last error.
    throw new GatewayError(502, '', `Cover-art response shape not recognised: ${JSON.stringify(json).slice(0, 200)}`);
  }, 'image');
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
// Shared player — single <audio> element at workspace level,
// surfaced both to the bottom MiniPlayer and to inline TrackCard
// play buttons. Replaces the previous per-card private audio
// element so two tracks can't play simultaneously and the
// transport stays consistent across UI surfaces.
// ──────────────────────────────────────────────────────────

interface PlayerState {
  trackId: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
}

interface PlayerControls {
  state: PlayerState;
  queue: SavedTrack[];
  play: (track: SavedTrack) => void;
  pause: () => void;
  toggle: (track?: SavedTrack) => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  next: () => void;
  prev: () => void;
}

// usePlayer takes the queue + the audio ref as parameters so the
// consumer owns the ref (React rules disallow surfacing refs from
// hook return values through render). The hook only exposes plain
// state + control functions; the consumer mounts <audio ref={...} />.
function usePlayer(queue: SavedTrack[], audioRef: React.MutableRefObject<HTMLAudioElement | null>): PlayerControls {
  const [state, setState] = useState<PlayerState>({
    trackId: null, playing: false, positionMs: 0, durationMs: 0, volume: 1,
  });

  const play = useCallback((track: SavedTrack) => {
    if (!track.audioDataUrl) return;
    const a = audioRef.current;
    if (!a) return;
    if (state.trackId !== track.id) {
      a.src = track.audioDataUrl;
      setState((s) => ({ ...s, trackId: track.id, positionMs: 0, durationMs: track.durationMs || 0 }));
    }
    void a.play().catch(() => { /* user gesture race; ignore */ });
  }, [state.trackId, audioRef]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, [audioRef]);

  const toggle = useCallback((track?: SavedTrack) => {
    // If a different track is requested, switch to it.
    if (track && state.trackId !== track.id) {
      play(track);
      return;
    }
    // Same track (or no track passed) — flip play/pause.
    if (state.playing) pause();
    else if (state.trackId) {
      void audioRef.current?.play().catch(() => { /* ignore */ });
    } else if (track) {
      play(track);
    }
  }, [state.trackId, state.playing, play, pause, audioRef]);

  const seek = useCallback((ms: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, ms / 1000);
  }, [audioRef]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    if (audioRef.current) audioRef.current.volume = clamped;
    setState((s) => ({ ...s, volume: clamped }));
  }, [audioRef]);

  const playable = useMemo(() => queue.filter((t) => t.audioDataUrl), [queue]);

  const next = useCallback(() => {
    if (!state.trackId || playable.length === 0) return;
    const idx = playable.findIndex((t) => t.id === state.trackId);
    if (idx < 0) return;
    const n = playable[(idx + 1) % playable.length];
    if (n) play(n);
  }, [state.trackId, playable, play]);

  const prev = useCallback(() => {
    if (!state.trackId || playable.length === 0) return;
    const idx = playable.findIndex((t) => t.id === state.trackId);
    if (idx < 0) return;
    const p = playable[(idx - 1 + playable.length) % playable.length];
    if (p) play(p);
  }, [state.trackId, playable, play]);

  // Bridge audio element events back into React state. The element
  // is mounted by the consumer (MusicCreator workspace) — we attach
  // the listeners once it's in the DOM.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setState((s) => ({ ...s, positionMs: a.currentTime * 1000 }));
    const onMeta = () => setState((s) => ({
      ...s,
      durationMs: Number.isFinite(a.duration) ? a.duration * 1000 : s.durationMs,
    }));
    const onPlay = () => setState((s) => ({ ...s, playing: true }));
    const onPause = () => setState((s) => ({ ...s, playing: false }));
    const onEnd = () => {
      // Auto-advance when there are >= 2 playable tracks; otherwise
      // stop at the end without resetting trackId so the MiniPlayer
      // stays visible with a "0:00" cursor for replay.
      if (playable.length >= 2) {
        const idx = playable.findIndex((t) => t.id === state.trackId);
        if (idx >= 0 && idx + 1 < playable.length) {
          play(playable[idx + 1]);
          return;
        }
      }
      setState((s) => ({ ...s, playing: false, positionMs: 0 }));
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnd);
    };
  }, [playable, state.trackId, play, audioRef]);

  return { state, queue, play, pause, toggle, seek, setVolume, next, prev };
}

// ──────────────────────────────────────────────────────────
// MiniPlayer — bottom transport bar. Hidden until a track is
// queued; once visible it stays so the user can scrub / replay
// without re-opening a TrackCard. Same gradient + chrome as
// the rest of the workspace so it reads as Tytus, not Spotify.
// ──────────────────────────────────────────────────────────

// Inline toggle that uses Tytus accent colours directly. The shadcn
// Switch we tried first depended on theme tokens (--primary, --input)
// that don't exist in this project — its track was rendering
// transparent against bg-window so the metadata strip looked broken.
// This one always shows: white thumb, accent track when on, hover-bg
// track when off, hard-coded so it never disappears regardless of
// background.
function TytusToggle({
  checked, onChange, disabled, id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="relative shrink-0 rounded-full transition-all disabled:opacity-40"
      style={{
        width: 30,
        height: 16,
        background: checked
          ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
          : 'var(--bg-hover)',
        border: '1px solid var(--border-subtle)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        className="absolute rounded-full transition-transform"
        style={{
          top: 1,
          left: 1,
          width: 12,
          height: 12,
          background: 'white',
          transform: checked ? 'translateX(14px)' : 'translateX(0)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  );
}

// One-shape AI assist button — used by every "ask the LLM to fill
// this for me" surface (Theme/Style/Lyrics). Same accent gradient
// as Create / Generate so the user reads them all as "this kicks
// off an AI action". Spinner replaces the sparkles glyph in flight.
function AIAssistButton({
  label, tooltip, onClick, busy, disabled,
}: {
  label: string;
  tooltip: string;
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-2 py-0.5 rounded-md transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: 'white',
        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
        border: '1px solid transparent',
      }}
      title={tooltip}
    >
      {busy
        ? <Loader2 size={10} className="animate-spin" />
        : <Sparkles size={10} />}
      {busy ? '…' : label}
    </button>
  );
}

// Single avatar component used by every track surface. Renders
// cover art when the track has one, otherwise a uniform Disc3
// gradient glyph. Centralizing this keeps the cards / table
// rows / mini-player consistent the moment cover generation
// lands post-extraction (Host API verb).
function TrackAvatar({
  track, size, iconSize, radius,
}: {
  track: SavedTrack;
  size: number;
  iconSize: number;
  radius: number;
}) {
  if (track.coverDataUrl) {
    return (
      <img
        src={track.coverDataUrl}
        alt=""
        className="flex-shrink-0"
        style={{
          width: size,
          height: size,
          borderRadius: radius <= 6 ? 'var(--radius-md)' : 'var(--radius-xl)',
          objectFit: 'cover',
        }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius <= 6 ? 'var(--radius-md)' : 'var(--radius-xl)',
        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
      }}
    >
      <Disc3 size={iconSize} style={{ color: 'white' }} />
    </div>
  );
}

function MiniPlayer({ player, allTracks }: { player: PlayerControls; allTracks: SavedTrack[] }) {
  const { state, toggle, next, prev, seek, setVolume, queue } = player;
  // Try the queue first (typically === visibleGallery so prev/next
  // line up with what the user sees), then fall back to the full
  // gallery so the player doesn't disappear when the user types in
  // the search box and the active track is filtered out.
  const track = queue.find((t) => t.id === state.trackId)
    ?? allTracks.find((t) => t.id === state.trackId)
    ?? null;
  if (!track) return null;

  const dur = state.durationMs > 0 ? state.durationMs : track.durationMs;
  const pos = Math.min(state.positionMs, dur || 0);
  const pct = dur > 0 ? (pos / dur) * 100 : 0;

  // Click-to-scrub on the progress track. Translate pixel offset →
  // ms so the seek operates in the same unit the hook expects.
  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, ratio)) * dur);
  };

  return (
    <div
      className="flex-shrink-0 flex items-center gap-3 px-4"
      style={{
        height: 64,
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-titlebar)',
      }}
    >
      {/* Album avatar — uses cover art when present, otherwise the
          Disc3 gradient glyph that matches the rest of the workspace.
          Cover-generation pipeline lands post-extraction; the field
          is plumbed today so this UI lights up the moment one's set. */}
      <TrackAvatar track={track} size={40} iconSize={18} radius={6} />

      <div className="flex flex-col min-w-0" style={{ width: 180 }}>
        <div className="truncate" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {track.title}
        </div>
        <div className="truncate" style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
          {track.styleTags && track.styleTags !== '—' ? track.styleTags : '—'}
        </div>
      </div>

      {/* Transport — prev / play-pause / next. Play-pause is the
          accent gradient pill; others are subtle. */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={prev}
          className="flex items-center justify-center rounded-md transition-all hover:bg-[var(--bg-hover)]"
          style={{ width: 28, height: 28, color: 'var(--text-secondary)' }}
          title="Previous"
        >
          <Play size={12} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button
          onClick={() => toggle()}
          className="flex items-center justify-center rounded-full transition-transform hover:scale-105"
          style={{
            width: 32, height: 32,
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          }}
          title={state.playing ? 'Pause' : 'Play'}
        >
          {state.playing
            ? <Pause size={13} style={{ color: 'white' }} />
            : <Play size={13} style={{ color: 'white', marginLeft: 1 }} />}
        </button>
        <button
          onClick={next}
          className="flex items-center justify-center rounded-md transition-all hover:bg-[var(--bg-hover)]"
          style={{ width: 28, height: 28, color: 'var(--text-secondary)' }}
          title="Next"
        >
          <Play size={12} />
        </button>
      </div>

      {/* Scrubber — click-to-seek; current position fills with the
          accent gradient. Times sit on either side. */}
      <span
        className="flex-shrink-0 tabular-nums"
        style={{ fontSize: 10, color: 'var(--text-disabled)', minWidth: 36, textAlign: 'right' }}
      >
        {formatTime(pos)}
      </span>
      <div
        onClick={onScrub}
        className="flex-1 rounded-full overflow-hidden cursor-pointer"
        style={{ height: 4, background: 'var(--bg-hover)' }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'linear-gradient(to right, var(--accent-primary), var(--accent-secondary))',
            transition: 'width 0.15s linear',
          }}
        />
      </div>
      <span
        className="flex-shrink-0 tabular-nums"
        style={{ fontSize: 10, color: 'var(--text-disabled)', minWidth: 36 }}
      >
        {formatTime(dur)}
      </span>

      {/* Volume — slim slider, doesn't crowd the transport.
          Range input gets accent styling via accent-color. */}
      <div className="flex items-center gap-1.5 flex-shrink-0" style={{ width: 100 }}>
        <MonitorSpeaker size={12} style={{ color: 'var(--text-disabled)', flexShrink: 0 }} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
        />
      </div>
    </div>
  );
}

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

// Standardised "field block" wrapper used by every form section.
// Flat layout — no per-field card chrome. Sections sit on the form
// background separated by spacing only, like Apple Music's edit
// dialog. The cards-in-cards look the user flagged ("too much boxes
// in boxes") came from every FieldCard rendering its own bordered
// container; this version is just label + control + hint.
//
// Genre Palette + Track Specs DO get their own chrome (they render
// their own outer divs, not via FieldCard) because they're distinct
// interactive surfaces, not single-control fields.
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
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <label
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-disabled)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {label}
        </label>
        {(headerExtra || counter) && (
          <div className="flex items-center gap-3">
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
        <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 8 }}>
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

// ──────────────────────────────────────────────────────────
// Track Specs panel — collapsible structured controls that
// compile into the Style prompt at submission time. Sits
// just below the Style textarea so the relationship is
// visible: text field for free prose, panel for structured
// hints, both fold into one prompt before AIL.
// ──────────────────────────────────────────────────────────

interface TrackSpecsCardProps {
  specs: TrackSpecs;
  onChange: (next: TrackSpecs) => void;
  disabled?: boolean;
  // AI-driven "fill in the blanks" hook — when present, renders an
  // Optimize button in the panel header that calls an LLM with the
  // current Theme + Style + Lyrics + existing specs and returns a
  // proposed full TrackSpecs object. Workspace owns the call so the
  // panel stays presentation-only.
  onOptimize?: () => void;
  optimizing?: boolean;
}

function TrackSpecsCard({ specs, onChange, disabled, onOptimize, optimizing }: TrackSpecsCardProps) {
  const [open, setOpen] = useState(false);
  const compiled = useMemo(() => compileSpecsToText(specs), [specs]);
  const hasAny = compiled.length > 0;

  // Helper: shallow-merge a sub-object update so callers don't repeat
  // the spread boilerplate. `null` removes the sub-object entirely.
  const patch = useCallback(
    <K extends keyof TrackSpecs>(key: K, value: TrackSpecs[K] | null) => {
      const next = { ...specs };
      if (value === null) delete next[key];
      else next[key] = value;
      onChange(next);
    },
    [specs, onChange],
  );

  const reset = () => onChange({});

  return (
    <div
      className="rounded-xl"
      style={{
        background: 'var(--bg-titlebar)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 flex-1 hover:opacity-90 text-left"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <Layers size={14} style={{ color: 'var(--text-secondary)' }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Track Specs
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
            {hasAny ? 'compiled into Style on generate' : 'optional structured controls'}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {/* AI Optimize — fills the entire panel from theme/style/
              lyrics via an LLM call. Only rendered when the workspace
              wired in the callback (gated on having an LLM endpoint). */}
          {onOptimize && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOptimize(); if (!open) setOpen(true); }}
              disabled={disabled || optimizing}
              className="flex items-center gap-1 px-2 py-1 rounded-md transition-all disabled:opacity-40 hover:scale-105"
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'white',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                border: '1px solid transparent',
              }}
              title="Use AI to fill optimal specs from your theme + style + lyrics"
            >
              {optimizing
                ? <Loader2 size={11} className="animate-spin" />
                : <Sparkles size={11} />}
              {optimizing ? 'Optimizing…' : 'AI Optimize'}
            </button>
          )}
          {hasAny && !open && (
            <span
              className="px-2 py-0.5 rounded-full"
              style={{
                fontSize: 9,
                background: 'var(--accent-primary)',
                color: 'white',
                fontWeight: 600,
              }}
            >
              {countSetSpecs(specs)} set
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center justify-center"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', width: 18, height: 18 }}
          >
            <ChevronDown
              size={14}
              style={{
                color: 'var(--text-secondary)',
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            />
          </button>
        </div>
      </div>

      {open && (
        <div
          className="px-3 pb-3 pt-0"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {/* Live preview of the compiled suffix — gives the user a clear
              sense of what their selections will inject into the prompt. */}
          {hasAny && (
            <div
              className="rounded-lg p-2 mt-3 mb-3"
              style={{
                background: 'var(--bg-window)',
                border: '1px dashed var(--border-subtle)',
                fontSize: 10,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: 'var(--text-disabled)', fontWeight: 600 }}>preview · </span>
              {compiled}
            </div>
          )}

          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {/* Structure */}
            <SpecsSection label="Structure">
              <SpecsRow label="Tempo (BPM)">
                <NumberInput
                  value={specs.structure?.tempo_bpm}
                  onChange={(v) => patch('structure', { ...specs.structure, tempo_bpm: v })}
                  min={40}
                  max={260}
                  placeholder="120"
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Tempo class">
                <EnumSelect
                  value={specs.structure?.tempo_class}
                  options={TEMPO_CLASSES}
                  onChange={(v) => patch('structure', { ...specs.structure, tempo_class: v as TempoClass | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Time signature">
                <EnumSelect
                  value={specs.structure?.time_signature}
                  options={TIME_SIGS}
                  onChange={(v) => patch('structure', { ...specs.structure, time_signature: v as TimeSignature | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Rhythm feel">
                <EnumSelect
                  value={specs.structure?.rhythm_feel}
                  options={RHYTHM_FEELS}
                  onChange={(v) => patch('structure', { ...specs.structure, rhythm_feel: v as RhythmFeel | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Groove">
                <EnumSelect
                  value={specs.structure?.groove_pattern}
                  options={GROOVES}
                  onChange={(v) => patch('structure', { ...specs.structure, groove_pattern: v as GroovePattern | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Form">
                <EnumSelect
                  value={specs.structure?.song_form}
                  options={SONG_FORMS}
                  onChange={(v) => patch('structure', { ...specs.structure, song_form: v as SongForm | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Length (s)">
                <NumberInput
                  value={specs.structure?.length_seconds}
                  onChange={(v) => patch('structure', { ...specs.structure, length_seconds: v })}
                  min={10}
                  max={600}
                  placeholder="180"
                  disabled={disabled}
                />
              </SpecsRow>
            </SpecsSection>

            {/* Key */}
            <SpecsSection label="Key">
              <SpecsRow label="Pitch">
                <EnumSelect
                  value={specs.tonal?.key}
                  options={KEYS}
                  onChange={(v) => patch('tonal', { ...specs.tonal, key: v as KeyName | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Mode">
                <EnumSelect
                  value={specs.tonal?.mode}
                  options={MODES}
                  onChange={(v) => patch('tonal', { ...specs.tonal, mode: v as MusicalMode | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
            </SpecsSection>

            {/* Dynamics */}
            <SpecsSection label="Dynamics">
              <SpecsRow label="Range">
                <EnumSelect
                  value={specs.dynamics?.overall_dynamic_range}
                  options={DYNAMIC_RANGES}
                  onChange={(v) => patch('dynamics', { ...specs.dynamics, overall_dynamic_range: v as DynamicRange | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Crescendo">
                <EnumSelect
                  value={specs.dynamics?.crescendo_shape}
                  options={CRESCENDOS}
                  onChange={(v) => patch('dynamics', { ...specs.dynamics, crescendo_shape: v as CrescendoShape | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Big drops">
                <BoolToggle
                  value={specs.dynamics?.has_big_drops}
                  onChange={(v) => patch('dynamics', { ...specs.dynamics, has_big_drops: v })}
                  disabled={disabled}
                />
              </SpecsRow>
            </SpecsSection>

            {/* Context */}
            <SpecsSection label="Context">
              <SpecsRow label="Era">
                <EnumSelect
                  value={specs.context?.era_reference}
                  options={ERAS}
                  onChange={(v) => patch('context', { ...specs.context, era_reference: v as EraRef | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Region">
                <EnumSelect
                  value={specs.context?.cultural_region}
                  options={CULTURAL_REGIONS}
                  onChange={(v) => patch('context', { ...specs.context, cultural_region: v as CulturalRegion | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Intensity">
                <EnumSelect
                  value={specs.mood?.emotional_intensity}
                  options={INTENSITIES}
                  onChange={(v) => patch('mood', { ...specs.mood, emotional_intensity: v as Intensity | undefined })}
                  disabled={disabled}
                />
              </SpecsRow>
              <SpecsRow label="Explicit lyrics">
                <BoolToggle
                  value={specs.context?.explicit_lyrics}
                  onChange={(v) => patch('context', { ...specs.context, explicit_lyrics: v })}
                  disabled={disabled}
                />
              </SpecsRow>
            </SpecsSection>
          </div>

          {/* Multi-select chip groups — full-width rows below the grid. */}
          <div className="mt-4 flex flex-col gap-3">
            <ChipMultiSelect
              label="Primary instruments"
              options={PRIMARY_INSTRUMENTS}
              selected={specs.instrumentation?.primary_instruments ?? []}
              onChange={(arr) => patch('instrumentation', { ...specs.instrumentation, primary_instruments: arr.length ? arr : undefined })}
              disabled={disabled}
            />
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <SpecsSection label="Vocals">
                <SpecsRow label="Has vocals">
                  <BoolTriToggle
                    value={specs.instrumentation?.has_vocals}
                    onChange={(v) => patch('instrumentation', { ...specs.instrumentation, has_vocals: v })}
                    disabled={disabled}
                  />
                </SpecsRow>
                <SpecsRow label="Gender">
                  <EnumSelect
                    value={specs.instrumentation?.vocal_gender}
                    options={VOCAL_GENDERS}
                    onChange={(v) => patch('instrumentation', { ...specs.instrumentation, vocal_gender: v as VocalGender | undefined })}
                    disabled={disabled}
                  />
                </SpecsRow>
                <SpecsRow label="Language (ISO)">
                  <TextInput
                    value={specs.instrumentation?.language_iso639_1 ?? ''}
                    onChange={(v) => patch('instrumentation', { ...specs.instrumentation, language_iso639_1: v.trim() || undefined })}
                    placeholder="en, es, ja…"
                    maxLength={5}
                    disabled={disabled}
                  />
                </SpecsRow>
              </SpecsSection>
              <ChipMultiSelect
                label="Vocal style"
                options={VOCAL_STYLES}
                selected={specs.instrumentation?.vocal_style ?? []}
                onChange={(arr) => patch('instrumentation', { ...specs.instrumentation, vocal_style: arr.length ? arr : undefined })}
                disabled={disabled}
              />
              <ChipMultiSelect
                label="Vocal processing"
                options={VOCAL_PROCESSING}
                selected={specs.instrumentation?.vocal_processing ?? []}
                onChange={(arr) => patch('instrumentation', { ...specs.instrumentation, vocal_processing: arr.length ? arr : undefined })}
                disabled={disabled}
              />
            </div>
            <ChipMultiSelect
              label="Primary moods"
              options={PRIMARY_MOODS}
              selected={specs.mood?.primary_moods ?? []}
              onChange={(arr) => patch('mood', { ...specs.mood, primary_moods: arr.length ? arr : undefined })}
              disabled={disabled}
            />
            <ChipMultiSelect
              label="Occasion tags"
              options={OCCASION_TAGS}
              selected={specs.mood?.occasion_tags ?? []}
              onChange={(arr) => patch('mood', { ...specs.mood, occasion_tags: arr.length ? arr : undefined })}
              disabled={disabled}
            />
            <ChipMultiSelect
              label="Intended use"
              options={INTENDED_USES}
              selected={specs.context?.intended_use ?? []}
              onChange={(arr) => patch('context', { ...specs.context, intended_use: arr.length ? arr : undefined })}
              disabled={disabled}
            />
          </div>

          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={reset}
              disabled={disabled || !hasAny}
              className="px-2 py-1 rounded-md transition-all hover:bg-[var(--bg-hover)] disabled:opacity-30"
              style={{ fontSize: 10, color: 'var(--text-disabled)', background: 'transparent', border: 'none' }}
            >
              Clear all specs
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Header for one logical section inside the specs panel. Flat —
// no border or background of its own; the outer panel chrome owns
// all the box-drawing. Spotify/Apple-Music-style label-then-rows
// instead of card-in-card.
function SpecsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--text-disabled)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SpecsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0, minWidth: 90 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// Small uniform select used by every enum row in the panel. Empty
// option clears the field (renders as undefined in the spec object).
function EnumSelect({
  value, options, onChange, disabled,
}: {
  value: string | undefined;
  options: readonly string[];
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      disabled={disabled}
      className="w-full px-2 py-1 rounded-md focus:outline-none disabled:opacity-50"
      style={{
        fontSize: 10,
        background: 'var(--bg-titlebar)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-primary)',
      }}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>{humanize(o)}</option>
      ))}
    </select>
  );
}

function NumberInput({
  value, onChange, min, max, placeholder, disabled,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      placeholder={placeholder}
      className="w-full px-2 py-1 rounded-md focus:outline-none disabled:opacity-50"
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') { onChange(undefined); return; }
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        onChange(n);
      }}
      disabled={disabled}
      style={{
        fontSize: 10,
        background: 'var(--bg-titlebar)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-primary)',
      }}
    />
  );
}

function TextInput({
  value, onChange, placeholder, maxLength, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-2 py-1 rounded-md focus:outline-none disabled:opacity-50"
      style={{
        fontSize: 10,
        background: 'var(--bg-titlebar)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-primary)',
      }}
    />
  );
}

// Two-state checkbox: undefined ↔ true. Used for "Big drops",
// "Explicit lyrics" — features users either care about or don't.
function BoolToggle({
  value, onChange, disabled,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      checked={!!value}
      onChange={(e) => onChange(e.target.checked ? true : undefined)}
      disabled={disabled}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
    />
  );
}

// Three-state toggle: undefined → 'yes' → 'no' → undefined. Used for
// has_vocals where "no vocals" is meaningfully different from
// "unspecified" and we want both expressible without two checkboxes.
function BoolTriToggle({
  value, onChange, disabled,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  disabled?: boolean;
}) {
  const next = value === undefined ? true : value === true ? false : undefined;
  const label = value === undefined ? 'auto' : value ? 'yes' : 'no';
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      disabled={disabled}
      className="px-2 py-0.5 rounded-full"
      style={{
        fontSize: 10,
        background: value === true ? 'var(--accent-primary)' : value === false ? '#555' : 'var(--bg-titlebar)',
        color: value === undefined ? 'var(--text-secondary)' : 'white',
        border: '1px solid var(--border-subtle)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function ChipMultiSelect({
  label, options, selected, onChange, disabled,
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onChange: (arr: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (opt: string) => {
    if (selected.includes(opt)) onChange(selected.filter((s) => s !== opt));
    else onChange([...selected, opt]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--text-disabled)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
        {selected.length > 0 && (
          <span style={{ marginLeft: 6, color: 'var(--accent-primary)' }}>
            · {selected.length}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              disabled={disabled}
              className="flex items-center gap-1 px-2 py-1 rounded-full transition-all hover:opacity-90 disabled:opacity-40"
              style={{
                fontSize: 10,
                background: active ? 'var(--accent-primary)' : 'var(--bg-titlebar)',
                color: active ? 'white' : 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {active && <Check size={10} />}
              {humanize(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Counts how many spec fields are set so the collapsed header can show
// a meaningful badge. Walks one level deep — sub-objects with no truthy
// fields don't count.
function countSetSpecs(s: TrackSpecs): number {
  // `intent` lives on TrackSpecs for round-trip convenience but it's
  // surfaced in the Lyrics Direction textarea, NOT as a chip in the
  // Track Specs panel. Counting it here would make the panel's
  // "N set" badge increment when the user types lyrics direction,
  // which is misleading. Strip it from the count.
  const { intent: _intent, ...rest } = s;
  void _intent;
  let n = 0;
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const v of Object.values(obj as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) { if (v.length) n += 1; continue; }
      if (typeof v === 'object') { walk(v); continue; }
      if (v === '' || v === false) continue;
      n += 1;
    }
  };
  walk(rest);
  return n;
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
  onRename: (id: string, title: string) => void;
  onEditCover: (track: SavedTrack) => void;
  // Shared player — cards no longer own audio elements; they
  // surface play/pause via the workspace-level player so only
  // one track plays at a time and the MiniPlayer stays in sync.
  player: PlayerControls;
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

// ──────────────────────────────────────────────────────────
// TrackTable — Apple-Music-style compact list view of the
// gallery. Toggleable from the rail header (Layers icon = cards,
// FileMusic icon = list). Each row reads like a Songs-tab line:
// title · style · duration · created. Click row = play; menu
// kebab opens the same actions as TrackCard.
// ──────────────────────────────────────────────────────────

interface TrackTableProps {
  tracks: SavedTrack[];
  player: PlayerControls;
  onLoad: (track: SavedTrack) => void;
  onOpenLyrics: (track: SavedTrack) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

function TrackTable({ tracks, player, onLoad, onOpenLyrics, onDelete, onRename }: TrackTableProps) {
  const { t } = useI18n();
  return (
    <div className="flex-1 overflow-y-auto invisible-scrollbar">
      {/* Header row — small caps column labels. Duration + Created
          align right so the numbers form a clean trailing column. */}
      <div
        className="grid items-center gap-2 px-2 sticky top-0 z-10"
        style={{
          gridTemplateColumns: '20px 1fr 60px 56px 18px',
          height: 22,
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--text-disabled)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          background: 'var(--bg-titlebar)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span></span>
        <span>Title</span>
        <span style={{ textAlign: 'right' }}>Time</span>
        <span style={{ textAlign: 'right' }}>Added</span>
        <span></span>
      </div>
      {tracks.map((track) => (
        <TrackTableRow
          key={track.id}
          track={track}
          player={player}
          onLoad={onLoad}
          onOpenLyrics={onOpenLyrics}
          onDelete={onDelete}
          onRename={onRename}
          translate={t}
        />
      ))}
    </div>
  );
}

function TrackTableRow({
  track, player, onLoad, onOpenLyrics, onDelete, onRename, translate,
}: {
  track: SavedTrack;
  player: PlayerControls;
  onLoad: (track: SavedTrack) => void;
  onOpenLyrics: (track: SavedTrack) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  translate: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [hover, setHover] = useState(false);
  // Inline rename state. `editing` is the buffer the input edits;
  // committing on Enter / blur calls onRename, Escape discards.
  const [editing, setEditing] = useState<string | null>(null);
  const isActive = player.state.trackId === track.id;
  const playing = isActive && player.state.playing;
  const commitRename = () => {
    if (editing === null) return;
    const next = editing.trim();
    setEditing(null);
    if (next && next !== track.title) onRename(track.id, next);
  };
  // Static date label — formats to "MMM d" so the column reads
  // like Apple Music's "Date Added". Avoids Date.now() in render
  // (impure) and the table doesn't need real-time relative times.
  const dateLabel = new Date(track.createdAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  });

  // Drag handler — same slim payload as TrackCard so the same drop
  // targets accept rows from either view. Reuses MIME_TRACK so a
  // table row can be dragged into the cover field, desktop, etc.
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
    if (track.lyricsPreview) e.dataTransfer.setData('text/plain', track.lyricsPreview);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable
      onDragStart={handleDragStart}
      onClick={() => track.audioDataUrl ? player.toggle(track) : onOpenLyrics(track)}
      className="grid items-center gap-2 px-2 cursor-pointer transition-colors"
      style={{
        gridTemplateColumns: '20px 1fr 60px 56px 18px',
        height: 30,
        fontSize: 11,
        background: isActive
          ? 'var(--bg-selected)'
          : hover ? 'var(--bg-hover)' : 'transparent',
        color: 'var(--text-primary)',
      }}
      title={track.audioDataUrl ? (playing ? 'Click to pause' : 'Click to play') : 'Click to open lyrics'}
    >
      {/* Play / pause indicator. Active row shows pause; hover on
          inactive shows play; otherwise a music note glyph. */}
      <div className="flex items-center justify-center" style={{ color: isActive ? 'var(--accent-primary)' : 'var(--text-disabled)' }}>
        {track.audioDataUrl ? (
          playing ? <Pause size={11} /> : (hover ? <Play size={11} /> : <Music2 size={11} />)
        ) : (
          <NotebookText size={11} />
        )}
      </div>
      <div className="min-w-0">
        {editing !== null ? (
          // Inline rename editor — Enter commits, Escape cancels, blur
          // also commits so the user can click anywhere else and not
          // lose the edit. autoFocus + onClick.stopPropagation so the
          // row's own click handler (play/toggle) doesn't fire.
          <input
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setEditing(null);
            }}
            onBlur={commitRename}
            maxLength={200}
            className="w-full px-1 py-0 rounded-md focus:outline-none focus:ring-1"
            style={{
              fontSize: 11,
              fontWeight: isActive ? 600 : 500,
              background: 'var(--bg-window)',
              border: '1px solid var(--accent-primary)',
              color: 'var(--text-primary)',
            }}
          />
        ) : (
          <>
            <div
              className="truncate"
              style={{ fontWeight: isActive ? 600 : 500 }}
              // Stop CLICK from bubbling to the row so a double-click
              // doesn't toggle play+pause before the rename input
              // opens. The row's outer onClick = play/pause; without
              // this, the first click of a double-click fires the
              // play handler and pauses/resumes the active track
              // every time the user wants to rename.
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(track.title);
              }}
              title="Double-click to rename"
            >
              {track.title || translate('musiccreator.track.untitled')}
            </div>
            {track.styleTags && track.styleTags !== '—' && (
              <div className="truncate" style={{ fontSize: 9, color: 'var(--text-disabled)' }}>
                {track.styleTags}
              </div>
            )}
          </>
        )}
      </div>
      <span className="tabular-nums" style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-disabled)' }}>
        {track.durationMs > 0 ? formatTime(track.durationMs) : '—'}
      </span>
      <span style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-disabled)' }}>
        {dateLabel}
      </span>
      {/* Inline kebab menu — same actions as TrackCard but rendered
          inline because the table row already carries the click target.
          Opens via context menu so we don't need the portal/positioning
          dance in this denser view. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          // Cycle through three core actions inline. For full action
          // surface, users still have the cards view + its kebab.
          if (e.shiftKey) onOpenLyrics(track);
          else if (e.altKey) onDelete(track.id);
          else onLoad(track);
        }}
        className="flex items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-selected)]"
        style={{ width: 18, height: 18, color: 'var(--text-disabled)' }}
        title="Click: load into form · Shift-click: open lyrics · Alt-click: delete"
      >
        <MoreVertical size={11} />
      </button>
    </div>
  );
}

// Sidebar-friendly compact track row. Used inside the slim 260px gallery
// rail — the bigger 2-column TrackCard layout doesn't fit there.
function TrackCard({
  track, onDelete, onLoad, onOpenLyrics,
  onSaveSongToDesktop, onSaveLyricsToDesktop, onPlayInPlayer, onRename, onEditCover, player,
}: TrackCardProps) {
  const { t } = useI18n();
  const kebabRef = useRef<HTMLButtonElement | null>(null);
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Inline rename state. Same shape as TrackTableRow — `editing`
  // is the input buffer; null = not editing. Keeps the kebab menu
  // and double-click-to-rename in sync.
  const [editing, setEditing] = useState<string | null>(null);
  const commitRename = () => {
    if (editing === null) return;
    const next = editing.trim();
    setEditing(null);
    if (next && next !== track.title) onRename(track.id, next);
  };
  // Derive playback state from the shared player so visuals stay
  // in sync no matter who triggers play (card / mini-player / kebab).
  const isActive = player.state.trackId === track.id;
  const playing = isActive && player.state.playing;
  const progress = isActive && player.state.durationMs > 0
    ? player.state.positionMs / player.state.durationMs
    : 0;

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

  // Toggle delegates to the shared player. If this card's track
  // isn't the one playing, requesting play swaps the source and
  // any previously playing track is paused automatically.
  const toggle = () => player.toggle(track);

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
            className="relative flex items-center justify-center flex-shrink-0 transition-transform hover:scale-105 group"
            style={{ width: 36, height: 36 }}
            title={playing ? 'Pause' : 'Play'}
          >
            {/* Cover art (or gradient fallback) sits behind a subtle
                play/pause overlay. Hover dims the cover to keep the
                control affordance visible even when art is dark. */}
            <TrackAvatar track={track} size={36} iconSize={14} radius={6} />
            <span
              className="absolute inset-0 flex items-center justify-center rounded-md transition-opacity"
              style={{
                background: track.coverDataUrl
                  ? 'rgba(0, 0, 0, 0.35)'
                  : 'transparent',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {playing
                ? <Pause size={14} style={{ color: 'white' }} />
                : <Play size={14} style={{ color: 'white', marginLeft: 1 }} />}
            </span>
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
          {editing !== null ? (
            <input
              autoFocus
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setEditing(null);
              }}
              onBlur={commitRename}
              maxLength={200}
              className="w-full px-1.5 py-0.5 rounded-md focus:outline-none focus:ring-1"
              style={{
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--bg-window)',
                border: '1px solid var(--accent-primary)',
                color: 'var(--text-primary)',
              }}
            />
          ) : (
            <div
              className="truncate"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(track.title);
              }}
              title="Double-click to rename"
            >
              {track.title || t('musiccreator.track.untitled')}
            </div>
          )}
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
          <TrackMenuItem icon={<Pencil size={14} />} label="Rename" onClick={callMenu(() => setEditing(track.title))} />
          <TrackMenuItem icon={<ImageIcon size={14} />} label="Edit cover art" onClick={callMenu(() => onEditCover(track))} />
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
      {/* Audio element lives at workspace level (shared player) — the
          card no longer mounts its own <audio>, so multiple cards
          can never sound at once. */}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// CoverArtModal — edit album-cover art for a saved track
// ──────────────────────────────────────────────────────────
//
// Opens from the TrackCard kebab. Same affordances as the inline
// CoverArtPanel: thumbnail preview + Edit prompt textarea +
// Regenerate / Upload / Clear / Save / Cancel. Lives as a real
// dialog (overlay + portal) so it scopes to the workspace pane
// rather than competing with the form.
function CoverArtModal({
  track, endpoint, onSave, onClose,
}: {
  track: SavedTrack;
  endpoint: PodEndpoint | null;
  onSave: (id: string, coverDataUrl: string) => void;
  onClose: () => void;
}) {
  const [draftCover, setDraftCover] = useState(track.coverDataUrl);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // AbortController for in-flight image gen. A modal close mid-gen
  // aborts so the resolved promise doesn't setDraftCover on an
  // unmounted component, and the user's quota isn't burned for an
  // image they'll never see.
  const abortRef = useRef<AbortController | null>(null);
  const cleanTitle = track.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, '');
  const placeholder = deriveCoverPrompt(cleanTitle, '', track.styleTags || '');

  // Esc-to-close while not busy. Mounted as a document listener while
  // the modal is open. Skipped when busy because aborting mid-gen is
  // the user's responsibility (close still aborts via the ref below).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Abort any in-flight gen on unmount. Without this, a user closes
  // the modal during regenerate → the promise still resolves and
  // tries to setDraftCover on a dead component.
  useEffect(() => () => abortRef.current?.abort(), []);

  const onRegenerate = async () => {
    if (!endpoint) {
      setErr('Connect to a pod to generate cover art.');
      return;
    }
    if (!endpoint.models.image) {
      setErr(`This endpoint (${endpoint.label}) has no image model. Pick one in Music Creator Settings → Cover art.`);
      return;
    }
    if (busy) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setBusy(true);
    setErr(null);
    try {
      const finalPrompt = (prompt.trim() || placeholder).slice(0, 1500);
      const out = await callImageGen(endpoint, finalPrompt, signal);
      if (signal.aborted) return;
      setDraftCover(out);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setErr((e as Error).message || 'Cover-art generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const onUpload = (file: File) => {
    setErr(null);
    if (!file.type.startsWith('image/')) {
      setErr('That file is not an image.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setErr('Image is too big (limit 4 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setErr('Could not read that image.');
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') setDraftCover(result);
    };
    reader.readAsDataURL(file);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[4000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-2xl"
        style={{
          width: 480,
          maxWidth: 'calc(100vw - 48px)',
          background: 'var(--bg-window)',
          border: '1px solid var(--border-default)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <ImageIcon size={14} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Cover Art — {cleanTitle || 'Untitled'}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-md hover:bg-[var(--bg-hover)] flex items-center justify-center"
            style={{ width: 24, height: 24, color: 'var(--text-secondary)' }}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-3">
            <div
              className="rounded-lg overflow-hidden flex-shrink-0 relative"
              style={{
                width: 140,
                height: 140,
                background: draftCover
                  ? `url(${draftCover}) center/cover no-repeat`
                  : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {!draftCover && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <ImageIcon size={36} style={{ color: 'white', opacity: 0.85 }} />
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                  <Loader2 size={24} className="animate-spin" style={{ color: 'white' }} />
                </div>
              )}
            </div>
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              <button
                onClick={onRegenerate}
                disabled={busy || !endpoint?.models.image}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg disabled:opacity-40"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'white',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                  border: '1px solid transparent',
                  cursor: (busy || !endpoint?.models.image) ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {draftCover ? 'Regenerate' : 'Generate'}
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg disabled:opacity-40 hover:bg-[var(--bg-hover)]"
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-titlebar)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <Upload size={12} />
                Upload
              </button>
              {draftCover && (
                <button
                  onClick={() => setDraftCover('')}
                  disabled={busy}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg disabled:opacity-40 hover:bg-[var(--bg-hover)]"
                  style={{
                    fontSize: 12,
                    color: 'var(--text-disabled)',
                    background: 'var(--bg-titlebar)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <X size={12} />
                  Clear
                </button>
              )}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Prompt
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={placeholder}
              disabled={busy}
              rows={3}
              className="w-full px-3 py-2 rounded-lg resize-none focus:outline-none disabled:opacity-50"
              style={{
                fontSize: 11,
                background: 'var(--bg-window)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          {err && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{
                fontSize: 11,
                color: '#ff8a80',
                background: 'rgba(255,82,82,0.06)',
                border: '1px solid rgba(255,82,82,0.18)',
              }}
            >
              <AlertCircle size={12} style={{ flexShrink: 0 }} />
              {err}
            </div>
          )}
        </div>
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg ml-auto disabled:opacity-40 hover:bg-[var(--bg-hover)]"
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'var(--bg-titlebar)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(track.id, draftCover); onClose(); }}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg disabled:opacity-40"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'white',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              border: '1px solid transparent',
            }}
          >
            Save
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────
// SongCardModal — read-mostly preview card opened by clicking
// the cover thumbnail in the form. Shows the big cover plus
// every metadata field (title, mode, theme, style, lyrics
// direction, specs summary, lyrics) so the user can sanity-
// check what's about to be saved without scrolling the form.
// ──────────────────────────────────────────────────────────
//
// Actions live inline so the user can act on what they see:
//   • Regenerate / Generate cover via the same callImageGen path
//   • Upload a custom file
//   • Clear the cover
//   • Close (Esc / overlay click / button)
//
// Pure presentation otherwise — text fields are read-only here;
// the user edits them in the form behind the modal.
interface SongCardModalProps {
  songName: string;
  mode: 'compose' | 'restyle' | 'lyricsOnly';
  theme: string;
  style: string;
  intent: string;
  lyrics: string;
  specs: TrackSpecs;
  coverDataUrl: string;
  coverPrompt: string;
  endpoint: PodEndpoint | null;
  busy: boolean;
  onRegenerate: () => void;
  onUpload: (file: File) => void;
  onClear: () => void;
  onClose: () => void;
}

function SongCardModal({
  songName, mode, theme, style, intent, lyrics, specs,
  coverDataUrl, coverPrompt: _coverPrompt,
  endpoint, busy,
  onRegenerate, onUpload, onClear, onClose,
}: SongCardModalProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const specsSummary = useMemo(() => compileSpecsToText(specs), [specs]);
  const setCount = useMemo(() => countSetSpecs(specs), [specs]);

  // Esc-to-close. Mounted as a document listener for the modal lifetime.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const modeLabel = mode === 'restyle' ? 'Restyle' : mode === 'lyricsOnly' ? 'Lyrics only' : 'Song';
  const cleanTitle = (songName.trim().replace(/\s*\((lyrics|cover|restyle)\)\s*$/, '')) || 'Untitled';

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <div
        style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-disabled)',
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
        {children}
      </div>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[4000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-2xl flex flex-col"
        style={{
          width: 720,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 48px)',
          background: 'var(--bg-window)',
          border: '1px solid var(--border-default)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <Disc3 size={14} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Song Card
          </span>
          <span
            className="px-2 py-0.5 rounded-full"
            style={{
              fontSize: 10,
              color: 'var(--accent-secondary)',
              background: 'rgba(168, 85, 247, 0.12)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {modeLabel}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-md hover:bg-[var(--bg-hover)] flex items-center justify-center"
            style={{ width: 24, height: 24, color: 'var(--text-secondary)' }}
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body — scrolls when the lyrics push past the viewport. */}
        <div className="flex-1 overflow-y-auto invisible-scrollbar p-5 flex gap-5">
          {/* Big cover. 320×320 — the focal element. Uses the same
              data URL pattern as everywhere else; falls back to the
              gradient + ImageIcon placeholder when no cover. */}
          <div
            className="rounded-lg overflow-hidden flex-shrink-0 relative"
            style={{
              width: 320,
              height: 320,
              background: coverDataUrl
                ? `url(${coverDataUrl}) center/cover no-repeat`
                : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            {!coverDataUrl && (
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon size={64} style={{ color: 'white', opacity: 0.7 }} />
              </div>
            )}
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                <Loader2 size={28} className="animate-spin" style={{ color: 'white' }} />
              </div>
            )}
          </div>

          {/* Metadata column */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {cleanTitle}
              </div>
              {style.trim() && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {style.trim()}
                </div>
              )}
            </div>

            {/* Cover-art actions — top of the metadata column so they're
                visible without scrolling when lyrics are long. */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRegenerate}
                disabled={busy || !endpoint?.models.image}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-40"
                style={{
                  fontSize: 11, fontWeight: 600, color: 'white',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                  border: '1px solid transparent',
                  cursor: (busy || !endpoint?.models.image) ? 'not-allowed' : 'pointer',
                }}
                title={endpoint?.models.image ? 'Generate cover art' : 'No image model available'}
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {coverDataUrl ? 'Regenerate' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[var(--bg-hover)]"
                style={{
                  fontSize: 11, color: 'var(--text-secondary)',
                  background: 'var(--bg-titlebar)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <Upload size={11} />
                Upload
              </button>
              {coverDataUrl && (
                <button
                  type="button"
                  onClick={onClear}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[var(--bg-hover)]"
                  style={{
                    fontSize: 11, color: 'var(--text-disabled)',
                    background: 'var(--bg-titlebar)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <X size={11} />
                  Clear
                </button>
              )}
            </div>

            {theme.trim() && (
              <Section label="Theme">{theme.trim()}</Section>
            )}
            {intent.trim() && (
              <Section label="Lyrics Direction">{intent.trim()}</Section>
            )}
            {setCount > 0 && specsSummary && (
              <Section label={`Track Specs (${setCount} set)`}>{specsSummary}</Section>
            )}
            {lyrics.trim() && (
              <Section label="Lyrics">
                <div
                  className="rounded-md px-3 py-2 invisible-scrollbar"
                  style={{
                    maxHeight: 220,
                    overflowY: 'auto',
                    background: 'var(--bg-titlebar)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: 12, lineHeight: 1.5,
                    whiteSpace: 'pre-wrap', fontFamily: 'inherit',
                  }}
                >
                  {lyrics}
                </div>
              </Section>
            )}
            {!theme.trim() && !intent.trim() && setCount === 0 && !lyrics.trim() && (
              <div style={{ fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic' }}>
                No metadata yet — fill in the form behind this card and click Create Song.
              </div>
            )}
          </div>
        </div>

        {/* Hidden file input so the modal's Upload button works without
            mounting yet another visible <input>. Mirrors the form's. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────

// Mode "restyle" is the song-cover / style-transfer flow (formerly
// "cover"). Renamed because users were confusing it with album cover
// art — Restyle takes a reference audio clip and re-sings the song in
// that style. The album-art panel is a separate first-class feature.
type Mode = 'compose' | 'restyle' | 'lyricsOnly';

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
  // Active lyric template — when set, the generation flow appends
  // its `prompt` to the lyrics-write call so the model produces
  // lyrics that fit the chosen song form. null = let the model
  // pick its own structure (current default behavior).
  const [activeTemplate, setActiveTemplate] = useState<LyricTemplate | null>(null);
  const [style, setStyle] = useState('');
  const [songName, setSongName] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  // Cover-art state. coverDataUrl is the live preview (base64 data URL
  // or '' for no art). coverPrompt is the user-overridable prompt; when
  // empty, deriveCoverPrompt() is used at gen time. coverAuto controls
  // whether the next Create Song auto-generates art (default ON, user
  // can opt out per-session). coverBusy is the spinner flag.
  const [coverDataUrl, setCoverDataUrl] = useState('');
  const [coverPrompt, setCoverPrompt] = useState('');
  const [coverAuto, setCoverAuto] = useState(true);
  const [coverBusy, setCoverBusy] = useState(false);
  // Which saved row the form currently represents. Set by loadTrack,
  // cleared by "New Song". Lets cover regenerate / upload / clear
  // write back to the same row in SQLite + gallery so the sidebar
  // thumbnail updates live instead of staying stale until reload.
  // Null means "not editing a saved row" — no write-back happens.
  const [loadedTrackId, setLoadedTrackId] = useState<string | null>(null);
  // Structured spec controls — empty-by-default; `compileSpecsToText`
  // returns "" when no fields are set, so the request flow doesn't need
  // to special-case "no specs".
  const [specs, setSpecs] = useState<TrackSpecs>({});
  // True while the AI Optimize button is in flight. Used to disable
  // the button + show a spinner; cleared in finally so a failed call
  // doesn't leave the button stuck.
  const [optimizingSpecs, setOptimizingSpecs] = useState(false);

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
  // Cover-art file picker — separate from refFileInputRef (audio).
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  // Local UI state — collapse/expand the prompt textarea.
  const [coverPromptOpen, setCoverPromptOpen] = useState(false);
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
  // 'cards' (current rich rail) or 'list' (Apple-Music-style table).
  const [galleryView, setGalleryView] = useState<'cards' | 'list'>('cards');
  // Persisted user prefs — model overrides, preferred pod, etc.
  const [creatorSettings, setCreatorSettings] = useState<MusicCreatorSettings>(DEFAULT_CREATOR_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          migrateLegacyTracksToSqlite(),
          migrateLegacyRecordingsToSqlite(),
        ]);
      } catch (e) {
        console.warn('[Juli3ta] Legacy migration failed (non-fatal):', e);
      }
      // Each load is wrapped independently so a transient error in one
      // (e.g. a stale schema after a worker restart) doesn't blank the
      // others. Tracks are by far the most visible — if listTracks
      // throws despite the repo's defensive fallback, surface the error
      // to the gallery banner so the user sees "something went wrong"
      // instead of a silent empty rail.
      const [loadedRes, prefsRes, recsRes] = await Promise.allSettled([
        listTracks(),
        loadCreatorSettings(),
        listRecordings(),
      ]);
      if (cancelled) return;
      if (loadedRes.status === 'fulfilled') {
        setGallery(loadedRes.value);
      } else {
        console.error('[Juli3ta] listTracks failed:', loadedRes.reason);
        setGalleryError('Could not load saved tracks — try reloading the app. Your data is still in SQLite.');
      }
      if (prefsRes.status === 'fulfilled') setCreatorSettings(prefsRes.value);
      if (recsRes.status === 'fulfilled') setVoiceRecordings(recsRes.value);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist a new track to SQLite, then prepend to in-memory state. If
  // the write fails (DB not ready, OPFS denied), DON'T pollute the
  // gallery with a row that won't survive a reload — surface the error
  // and return false so the caller can skip side effects (VFS mirroring,
  // success notification). If the user wants to keep an in-flight result
  // visible, they can retry from the form (lyrics/audio still in state).
  const saveTrack = useCallback(async (track: SavedTrack): Promise<boolean> => {
    try {
      await insertTrackRow(track);
      setGalleryError(null);
      setGallery((g) => [track, ...g]);
      return true;
    } catch (e) {
      const msg = (e as Error).message || 'Database write failed';
      setGalleryError(`Couldn't save "${track.title}" — ${msg}. Try again or check the console.`);
      return false;
    }
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
  // AI-assist controller — separate from `abortRef` because Cancel
  // (Generate) shouldn't kill an Inspire/Suggest/Polish/Optimize that
  // happens to be running, and vice versa. Each AI assist call grabs
  // its signal off this ref; the unmount cleanup aborts both refs.
  const aiAbortRef = useRef<AbortController | null>(null);
  // Forward-ref handles for callbacks declared later in the component
  // body. Lets earlier callbacks (regenerateCover, etc.) call
  // setTrackCover without TDZ-on-render from a deps array. The ref
  // is patched in a useEffect once the real callback is in scope.
  const setTrackCoverRef = useRef<((id: string, cover: string) => void) | null>(null);
  // In-flight guard. Tracks a generation across the brief window between
  // a click and React rendering the Cancel button. Without this a fast
  // double-click fires two parallel `callLyrics` requests — the second
  // abort cancels the JS promise but the server already accepted both.
  const generatingRef = useRef(false);

  useEffect(() => () => {
    abortRef.current?.abort();
    aiAbortRef.current?.abort();
  }, []);

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
    const fileName = `${sanitizeFileName(track.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, ''))}.lyrics.txt`;
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
    const fileName = `${sanitizeFileName(track.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, ''))}.mp3`;
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
    // Restyle preflight — validate BEFORE any network call so we don't
    // burn lyrics/cover quota only to tell the user mid-flight that
    // they forgot the reference audio. (The same check runs again
    // post-lyrics for defence-in-depth, but this one is the first
    // gate.)
    if (mode === 'restyle' && !refAudioBase64) {
      setError('Restyle needs a reference audio file. Drop one in below.');
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
          image: overrides.image || endpoint.models.image,
          allIds: endpoint.models.allIds,
        },
      };

      // Compile structured Track Specs into a prose suffix once per
      // generate. Empty when no fields are set; otherwise reads like
      // "120 BPM, 4/4 time. Key: A minor. Instruments: piano, drums.".
      const specsText = compileSpecsToText(specs);

      // Step 1: lyrics (skip if user supplied their own). The lyrics
      // prompt is the user's free-text Theme plus the compiled specs
      // so the songwriter sees the same constraints the music model
      // will (mood/era/intensity all matter for lyric tone).
      let useLyrics = lyrics.trim();
      let resolvedTitle = songName.trim();
      let resolvedStyle = style.trim();
      let generatedLyrics: Awaited<ReturnType<typeof callLyrics>> | null = null;

      if (!useLyrics && !instrumental) {
        if (!theme.trim() && !(specs.intent ?? '').trim()) {
          setError(t('musiccreator.error.noInput'));
          return;
        }
        setPhase('lyrics');
        // Compose the lyrics prompt: theme + user intent + specs + (optional)
        // song form constraint. The User intent block is the user's free
        // direction (perspective, mood, language, taboo lines) — surfaced
        // separately so the model treats it as instruction, not subject.
        // activeTemplate?.prompt steers the model to produce lyrics that
        // actually fit the selected structure instead of the model picking
        // its own form by default.
        const promptParts: string[] = [];
        if (theme.trim()) promptParts.push(theme.trim());
        const intent = (specs.intent ?? '').trim();
        if (intent) promptParts.push(`User intent (must respect): ${intent}`);
        if (specsText) promptParts.push(`Musical context: ${specsText}`);
        if (activeTemplate) promptParts.push(`Structure: ${activeTemplate.prompt}`);
        const themePrompt = promptParts.join('\n\n');
        generatedLyrics = await callLyrics(effectiveEndpoint, themePrompt, controller.signal);
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
        // The chat-fallback path returns the literal string "Untitled"
        // when the model didn't fill song_title — treat that as missing
        // so we fall through to local synthesis below.
        if (resolvedTitle === 'Untitled') resolvedTitle = '';
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

      // Final title resolution. By the time we get here every save path
      // needs a real title — `resolvedTitle` may still be empty if the
      // user supplied lyrics, the lyrics fallback returned no song_title,
      // or instrumental mode skipped lyrics entirely. Synthesize a short
      // local title from lyrics → theme → style so the gallery never
      // shows "Untitled" except when the user had nothing at all.
      if (!resolvedTitle.trim()) {
        resolvedTitle = synthesizeTitleLocal(useLyrics, theme, resolvedStyle || style);
        if (resolvedTitle && resolvedTitle !== 'Untitled' && !songName.trim()) {
          setSongName(resolvedTitle);
        }
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
          specsJson: countSetSpecs(specs) > 0 ? JSON.stringify(specs) : '',
          // Lyric sheets keep whatever cover art the user attached in
          // the form (uploaded or pre-generated) — image autogen during
          // Write Lyrics is skipped to keep the call cheap.
          coverDataUrl: coverDataUrl,
        };
        const sheetSaved = await saveTrack(sheetTrack);
        // Only mirror to the VFS when the SQLite write succeeded —
        // otherwise we'd ship a `.lyrics.txt` whose refTrackId points
        // at a non-existent row, leaving a ghost shortcut after reload.
        if (sheetSaved) mirrorLyricsToVfs(sheetTrack);
        setPhase('idle');
        setProgress(0);
        return;
      }

      // Restyle mode requires a reference-audio upload.
      if (mode === 'restyle' && !refAudioBase64) {
        setError('Restyle needs a reference audio file. Drop one in below.');
        setPhase('idle');
        return;
      }

      // Step 2: music (or restyle) + cover art in parallel. Cover art
      // is opt-out (coverAuto) and only kicks in when the endpoint has
      // an image model and the user hasn't already supplied / generated
      // one. Failures are swallowed — the song saves without art rather
      // than aborting the whole flow. Music is the gating call: its
      // success/failure decides whether we save the row at all.
      setPhase('song');
      const musicPrompt = [resolvedStyle, specsText].filter((p) => p && p.length > 0).join('. ');
      const musicPromise = callMusic(
        effectiveEndpoint,
        {
          lyrics: useLyrics,
          prompt: musicPrompt || undefined,
          instrumental,
          refAudioBase64: mode === 'restyle' ? refAudioBase64 ?? undefined : undefined,
        },
        controller.signal,
      );
      const wantsAutoCover = coverAuto
        && !coverDataUrl
        && !!effectiveEndpoint.models.image;
      // Capture the user's pre-existing cover (from upload or prior
      // gen) so a failed auto-gen falls back to it instead of blanking.
      const existingCover = coverDataUrl;
      const coverPromise: Promise<string> = wantsAutoCover
        ? callImageGen(
            effectiveEndpoint,
            (coverPrompt.trim() || deriveCoverPrompt(resolvedTitle, theme, resolvedStyle || style)).slice(0, 1500),
            controller.signal,
          ).catch((e: Error) => {
            // User-driven cancel (Cancel button or unmount) shouldn't
            // surface as a "Cover-art skipped" warning — that would
            // misattribute their action as a system failure. Re-throw
            // so the outer catch's AbortError handler swallows it.
            if (e.name === 'AbortError') throw e;
            // Real image-gen failure is non-fatal. Surface a soft
            // warning so the user knows why the track has no cover,
            // but let the song save go through. Return whatever cover
            // they had before so an upload doesn't get clobbered.
            console.warn('[Juli3ta] Cover-art generation failed:', e);
            setGalleryError(`Cover-art skipped: ${e.message}`);
            return existingCover;
          })
        : Promise.resolve(existingCover);
      // allSettled instead of all so we can short-circuit cover when
      // music rejects — otherwise the cover request keeps burning the
      // image quota and its eventual catch fires a phantom banner long
      // after the user has dismissed the music error and moved on.
      const settled = await Promise.allSettled([musicPromise, coverPromise]);
      const musicResult = settled[0];
      const coverResult = settled[1];
      if (musicResult.status === 'rejected') {
        // Cover may still be in flight (or just rejected). The shared
        // controller.signal has already been used by both calls, so a
        // user cancel kills both; for a music-side failure we abort
        // the controller now to short-circuit the cover.
        controller.abort();
        throw musicResult.reason;
      }
      const song = musicResult.value;
      const finalCoverDataUrl = coverResult.status === 'fulfilled'
        ? coverResult.value
        : existingCover;

      // Validate the response shape before assuming success. Some
      // gateways return 200 with an empty/error body when an upstream
      // fails — callMusic now validates internally and throws, so this
      // is a defence-in-depth check that should never fire.
      if (!song?.data?.audio || typeof song.data.audio !== 'string' || song.data.audio.length < 100) {
        const traceId = song?.trace_id ? ` (trace ${song.trace_id})` : '';
        throw new Error(`Music gen returned no audio data${traceId}. Try again or pick a different model in Settings.`);
      }

      const audioDataUrl = `data:audio/mpeg;base64,${song.data.audio}`;
      const titleSuffix = mode === 'restyle' ? ' (restyle)' : '';
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
        specsJson: countSetSpecs(specs) > 0 ? JSON.stringify(specs) : '',
        coverDataUrl: finalCoverDataUrl,
      };
      // Reflect the freshly-generated cover in the form so the user
      // sees the same art the saved row carries. Always sync (even
      // when finalCoverDataUrl === '') so a swallowed auto-gen failure
      // doesn't leave the form showing stale art that doesn't match
      // what's saved.
      setCoverDataUrl(finalCoverDataUrl);

      console.info('[Juli3ta] Saving generated song:', { id: newTrack.id, title: newTrack.title, durationMs: newTrack.durationMs, sizeBytes: newTrack.sizeBytes });
      const saved = await saveTrack(newTrack);
      // Only run the side effects (VFS mirrors, success notification)
      // when the row actually landed in SQLite. Otherwise the user
      // would see a "Song ready" toast next to a yellow "couldn't save"
      // banner, plus orphan shortcuts in Files.
      if (saved) {
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
      }
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
    endpoint, theme, lyrics, songName, style, specs, activeTemplate, instrumental, mode, refAudioBase64, t,
    saveTrack, creatorSettings, mirrorAudioToVfs, mirrorLyricsToVfs, addNotification,
    coverAuto, coverDataUrl, coverPrompt,
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

  // Generic chat-completions assistant. Every AI button on this
  // workspace routes through this. Defensive design:
  //  - 429 on the primary chat model → fall through to other chat-
  //    capable models in `endpoint.models.allIds` until one
  //    succeeds (so a daily-quota cap on `ail-compound` doesn't
  //    block the entire app).
  //  - No automatic retry on empty content — that doubled the
  //    request rate and burned through quotas during dev. The
  //    empty case now throws a clear error and the user re-clicks
  //    if they want another roll.
  //  - Tries multiple response shapes (some MiniMax/legacy chat-
  //    compat APIs expose `text` or `delta.content` instead of
  //    `message.content`).
  //  - Single in-flight request per button (callers gate on aiBusy).
  const callAIAssist = useCallback(async (
    systemPrompt: string,
    userPayload: unknown,
    opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
  ): Promise<string> => {
    if (!endpoint) throw new Error('No endpoint connected');

    // Pull text out of whatever shape the upstream returns.
    type ChoiceLike = {
      message?: { content?: string | null };
      delta?: { content?: string | null };
      text?: string | null;
    };
    const extractContent = (data: unknown): string => {
      const d = data as { choices?: ChoiceLike[]; output_text?: string };
      const c = d.choices?.[0];
      const candidates: Array<string | null | undefined> = [
        c?.message?.content,
        c?.delta?.content,
        c?.text,
        d.output_text,
      ];
      for (const v of candidates) {
        if (typeof v === 'string' && v.trim().length > 0) return v.trim();
      }
      return '';
    };

    // Build the chat-model pool the same way the lyrics fallback does
    // (lyricsBackup first, then anything chat-shaped). Excludes
    // music/cover/tts/stt/embed/image/diffusion/rerank.
    const isChatty = (id: string) =>
      !/music|cover|tts|stt|transcribe|whisper|embed|image|diffusion|dall-?e|flux|sdxl|rerank/i.test(id);
    const seen = new Set<string>();
    const tryOrder: string[] = [];
    const pushUniq = (id: string | null | undefined) => {
      if (id && !seen.has(id)) { seen.add(id); tryOrder.push(id); }
    };
    pushUniq(endpoint.models.lyricsBackup);
    endpoint.models.allIds.filter(isChatty).forEach(pushUniq);
    if (tryOrder.length === 0) {
      throw new Error('No chat model available on this endpoint. Pick a different connection in Settings.');
    }

    const userMsg = typeof userPayload === 'string' ? userPayload : JSON.stringify(userPayload);
    const baseTemp = opts?.temperature ?? 0.5;
    const maxTokens = Math.max(opts?.maxTokens ?? 800, 400);
    // Per-call wall-clock cap. Lyrics path uses 60s; chat assists are
    // shorter prompts so 45s is comfortable but doesn't let a stuck
    // gateway lock the AI button forever (the original bug).
    const ASSIST_TIMEOUT_MS = 45_000;

    return tryWithModelFallback(tryOrder, async (modelId) => {
      const t = withTimeout(opts?.signal, ASSIST_TIMEOUT_MS);
      let r: Response;
      try {
        r = await fetch(`${endpoint.url}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${endpoint.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMsg },
            ],
            temperature: baseTemp,
            max_tokens: maxTokens,
          }),
          signal: t.signal,
        });
      } catch (e) {
        if ((e as Error).name === 'TimeoutError') {
          throw new Error(`AI assist timed out after ${ASSIST_TIMEOUT_MS / 1000}s.`);
        }
        throw e;
      } finally {
        t.dispose();
      }
      if (!r.ok) {
        const errBody = await r.text().catch(() => '');
        throw new GatewayError(r.status, errBody, `AI assist HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const rawJson = await r.json();
      const content = extractContent(rawJson);
      if (!content) {
        // Empty content gets retried as a 502 so the next chat model
        // gets a shot — same shape as a transient gateway error.
        console.warn('[Juli3ta] empty AI assist content from', modelId, rawJson);
        throw new GatewayError(502, '', `Model "${modelId}" returned empty content`);
      }
      return content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }, 'chat-assist');
  }, [endpoint]);

  // AI-driven Track Specs optimizer. Sends the current Theme + Style
  // + Lyrics + existing specs JSON to a chat-completions model on the
  // active endpoint and asks for an optimal full TrackSpecs JSON
  // back. Merges the response into the specs panel — user can still
  // edit any field after, and Clear All resets to empty.
  const optimizeSpecs = useCallback(async () => {
    if (!endpoint) return;
    setOptimizingSpecs(true);
    setError(null);
    try {
      const sys = `You are a music-production assistant. Given a theme, style, and (optionally) lyrics, return ONE JSON object that fills in optimal Track Specs for the song.

Output schema (every field optional, OMIT fields you can't infer confidently):
{
  "structure": {
    "tempo_bpm": 40-260,
    "tempo_class": "very_slow"|"slow"|"medium"|"fast"|"very_fast",
    "time_signature": "3/4"|"4/4"|"6/8"|"7/8"|"5/4"|"other",
    "rhythm_feel": "straight"|"swing"|"shuffled"|"syncopated"|"polyrhythmic"|"free",
    "groove_pattern": "four_on_the_floor"|"halftime"|"doubletime"|"broken_beat"|"backbeat"|"free",
    "song_form": "verse_chorus"|"aaba"|"drop_based"|"loop_based"|"through_composed"|"strophic",
    "length_seconds": 10-600
  },
  "tonal": { "key": "C"|"Db"|...|"B", "mode": "major"|"minor"|"dorian"|"mixolydian"|"phrygian"|"lydian"|"locrian" },
  "instrumentation": {
    "primary_instruments": ["drums_acoustic","drum_machine","percussion","bass_electric","bass_synth","bass_upright","electric_guitar","acoustic_guitar","piano","keys_synth","organ","strings","brass","woodwinds","synth_pad","synth_lead","pluck_synth","fx","lead_vocal","choir"],
    "has_vocals": true|false,
    "vocal_style": ["sung"|"rap"|"spoken_word"|"chant"|"choir"|"vocoder"],
    "vocal_gender": "male"|"female"|"mixed"|"other"|"none",
    "vocal_processing": ["dry"|"reverb"|"delay"|"autotune_light"|"autotune_heavy"|"distortion"|"chorus"|"double_tracked"],
    "language_iso639_1": "en"|"es"|...
  },
  "dynamics": {
    "overall_dynamic_range": "narrow"|"medium"|"wide",
    "has_big_drops": true|false,
    "crescendo_shape": "none"|"gradual"|"sudden"
  },
  "mood": {
    "primary_moods": ["happy"|"uplifting"|"dark"|"melancholic"|"dreamy"|"chill"|"epic"|"romantic"|"energetic"|"aggressive"],
    "emotional_intensity": "low"|"medium"|"high",
    "occasion_tags": ["party"|"club"|"study"|"sleep"|"workout"|"background"|"focus"|"film_trailer"|"game"|"kids"|"holiday_christmas"]
  },
  "context": {
    "era_reference": "60s"|"70s"|"80s"|"90s"|"2000s"|"2010s"|"2020s"|"timeless",
    "cultural_region": "global"|"us_uk"|"latin"|"afrobeats_scene"|"kpop_scene"|"jpop_scene"|"caribbean"|"middle_east"|"asia_other"|"europe_other",
    "explicit_lyrics": true|false,
    "intended_use": ["background"|"featured_listen"|"sync_film"|"sync_ad"|"game"|"live_show_intro"]
  }
}

Return ONLY the JSON. No markdown, no explanation, no code fences.`;
      aiAbortRef.current?.abort();
      aiAbortRef.current = new AbortController();
      const stripped = await callAIAssist(sys, {
        theme: theme || null,
        style: style || null,
        lyrics: lyrics ? lyrics.slice(0, 1500) : null,
        existing_specs: countSetSpecs(specs) > 0 ? specs : null,
      }, { temperature: 0.4, signal: aiAbortRef.current.signal });
      let parsed: TrackSpecs;
      try {
        parsed = JSON.parse(stripped) as TrackSpecs;
      } catch {
        throw new Error(`Optimize returned non-JSON: ${stripped.slice(0, 160)}`);
      }
      // Preserve the user's free-form lyrics intent — the optimizer's
      // schema doesn't include it, so a naive overwrite would wipe
      // whatever the user typed in the Lyrics Direction field.
      setSpecs((prev) => ({ ...parsed, intent: prev.intent }));
    } catch (e) {
      setError((e as Error).message || 'Optimize failed.');
    } finally {
      setOptimizingSpecs(false);
    }
  }, [endpoint, theme, style, lyrics, specs, callAIAssist]);

  // Three text-driven AI assists. Each shares the same in-flight ref
  // so a single button at a time is active and we can show a spinner
  // on whichever is running. callAIAssist normalizes the chat call.
  const [aiBusy, setAiBusy] = useState<null | 'theme' | 'style' | 'lyrics'>(null);

  // Cover-art regenerate. Uses coverPrompt if set, otherwise derives
  // one from title/theme/style. Same multi-model fallback discipline
  // as the lyrics path: if image is rate-limited we surface the error
  // so the user can retry, but we don't auto-retry (to avoid quota
  // multipliers like the 100-request burst we hit on lyrics retry).
  const regenerateCover = useCallback(async () => {
    if (!endpoint) return;
    if (!endpoint.models.image) {
      setError(`This endpoint (${endpoint.label}) doesn't expose an image model. Pick one in Settings → Cover art, or upload your own image.`);
      return;
    }
    // Concurrency guard — rapid double-clicks would otherwise fire
    // parallel image calls and last-writer-wins clobbers coverDataUrl.
    if (coverBusy) return;
    // Reuse aiAbortRef so the unmount cleanup also kills any in-flight
    // image gen, and a second click cancels the previous request
    // instead of layering a new one on top.
    aiAbortRef.current?.abort();
    aiAbortRef.current = new AbortController();
    const signal = aiAbortRef.current.signal;
    setCoverBusy(true);
    setError(null);
    try {
      const finalPrompt = (coverPrompt.trim() || deriveCoverPrompt(songName, theme, style)).slice(0, 1500);
      const out = await callImageGen(endpoint, finalPrompt, signal);
      if (signal.aborted) return;
      setCoverDataUrl(out);
      // Sync to the saved row + gallery if this form represents a
      // loaded track. Without this, regenerate updates the form
      // preview but the sidebar thumbnail stays stale until reload.
      // Routed through the ref because setTrackCover is declared
      // later in the component body — direct deps would TDZ.
      if (loadedTrackId) {
        setTrackCoverRef.current?.(loadedTrackId, out);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message || 'Cover-art generation failed.');
    } finally {
      setCoverBusy(false);
    }
  }, [endpoint, coverPrompt, songName, theme, style, coverBusy, loadedTrackId]);

  // Upload-from-disk handler. Reads the file as a base64 data URL and
  // shoves it straight into coverDataUrl so the user can ship a custom
  // image without burning the AI quota. ≤4 MB cap to keep the SQLite
  // row size reasonable (audio data URLs already dominate).
  const handleCoverUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image. Pick a PNG/JPG/WebP.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('Cover image is too big (limit 4 MB). Try a smaller file.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read that image file.');
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && result.startsWith('data:image/')) {
        setCoverDataUrl(result);
        // Sync to the saved row if this form represents a loaded track
        // (same logic as regenerateCover) so an upload also updates
        // the sidebar thumbnail without a reload.
        if (loadedTrackId) {
          setTrackCoverRef.current?.(loadedTrackId, result);
        }
      }
    };
    reader.readAsDataURL(file);
  }, [loadedTrackId]);

  const inspireTheme = useCallback(async () => {
    if (aiBusy) return;
    setAiBusy('theme');
    setError(null);
    try {
      const sys = `You are a creative songwriter. Given a Style description (genre, mood, instrumentation hints), write a vivid one-paragraph THEME for the song — a setting, a story arc, an emotional core. Keep it 2-4 sentences, evocative but specific. Plain prose only, no headers, no markdown, no quotes.`;
      aiAbortRef.current?.abort();
      aiAbortRef.current = new AbortController();
      const out = await callAIAssist(sys, {
        style: style || 'pop',
        existing_theme: theme || null,
      }, { temperature: 0.85, maxTokens: 200, signal: aiAbortRef.current.signal });
      setTheme(out);
    } catch (e) {
      setError((e as Error).message || 'Theme inspiration failed.');
    } finally {
      setAiBusy(null);
    }
  }, [aiBusy, callAIAssist, style, theme]);

  const suggestStyle = useCallback(async () => {
    if (aiBusy) return;
    setAiBusy('style');
    setError(null);
    try {
      const sys = `You are a music-production assistant. Given a song THEME, propose a Style description: a comma-separated list of genre + mood + tempo + instrument cues (8-12 tags). Plain text, lowercase, comma-separated, no headers, no markdown, no surrounding prose. Example: "indie folk, acoustic, melancholic, 80 bpm, fingerpicked guitar, soft female vocals, reverb-heavy".`;
      aiAbortRef.current?.abort();
      aiAbortRef.current = new AbortController();
      const out = await callAIAssist(sys, {
        theme: theme || 'a quiet evening',
        existing_style: style || null,
      }, { temperature: 0.7, maxTokens: 120, signal: aiAbortRef.current.signal });
      setStyle(out.replace(/^["']|["']$/g, ''));
    } catch (e) {
      setError((e as Error).message || 'Style suggestion failed.');
    } finally {
      setAiBusy(null);
    }
  }, [aiBusy, callAIAssist, theme, style]);

  const polishLyrics = useCallback(async () => {
    if (aiBusy) return;
    if (!lyrics.trim()) {
      setError('Nothing to polish — write some lyrics first.');
      return;
    }
    setAiBusy('lyrics');
    setError(null);
    try {
      const sys = `You are a senior songwriter. Polish the user's lyrics for flow, rhyme, imagery, and structural balance. Preserve the user's intent and language. Keep [Verse], [Chorus], [Bridge], [Intro], [Outro], [Inst] section markers if present (or add appropriate ones). Return ONLY the polished lyrics — no commentary, no markdown, no quotes.`;
      aiAbortRef.current?.abort();
      aiAbortRef.current = new AbortController();
      const out = await callAIAssist(sys, {
        style: style || null,
        lyrics,
      }, { temperature: 0.6, maxTokens: 1200, signal: aiAbortRef.current.signal });
      if (out.length > MAX_LYRICS) {
        setError(`Polished lyrics exceeded ${MAX_LYRICS} chars (${out.length}). Trimming the original first might help.`);
        return;
      }
      setLyrics(out);
    } catch (e) {
      setError((e as Error).message || 'Lyrics polish failed.');
    } finally {
      setAiBusy(null);
    }
  }, [aiBusy, callAIAssist, style, lyrics]);

  // (insertTemplate retired — LYRIC_TEMPLATES are now structured
  // {skeleton, prompt} objects and the click handler lives in the
  // template-chip render so it can also flip activeTemplate.)

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

  // Rename a saved track inline. Optimistic UI: in-memory gallery
  // updates first so the row reflects the new name immediately; the
  // SQLite write settles in the background. If the write fails, surface
  // a banner — the next reload would resurrect the old name otherwise
  // and the user would silently lose the edit.
  const renameTrack = useCallback(async (id: string, nextTitle: string) => {
    const trimmed = nextTitle.trim().slice(0, 200) || 'Untitled';
    setGallery((g) => g.map((tr) => (tr.id === id ? { ...tr, title: trimmed } : tr)));
    try {
      await renameTrackRow(id, trimmed);
      setGalleryError(null);
    } catch (e) {
      const msg = (e as Error).message || 'Database write failed';
      setGalleryError(`Couldn't rename track — ${msg}.`);
    }
  }, []);

  // Update a saved track's album-cover-art. Same optimistic pattern as
  // renameTrack — UI updates immediately, DB settles in the background.
  // Empty string = clear the cover (revert to gradient placeholder).
  const setTrackCover = useCallback(async (id: string, nextCover: string) => {
    setGallery((g) => g.map((tr) => (tr.id === id ? { ...tr, coverDataUrl: nextCover } : tr)));
    try {
      await updateTrackCoverRow(id, nextCover);
      setGalleryError(null);
    } catch (e) {
      const msg = (e as Error).message || 'Database write failed';
      setGalleryError(`Couldn't save cover art — ${msg}.`);
    }
  }, []);
  // Patch the forward ref so earlier callbacks can call setTrackCover
  // without dep-array TDZ. Layout effect so the ref is current before
  // the next paint that could trigger a click.
  useEffect(() => {
    setTrackCoverRef.current = setTrackCover;
  }, [setTrackCover]);

  // Update style_tags / lyrics_preview / specs_json on a saved row.
  // Same optimistic pattern: in-memory gallery first, then DB. Used by
  // the form's auto-save effect when editing a loaded track.
  const setTrackStyle = useCallback(async (id: string, nextStyle: string) => {
    setGallery((g) => g.map((tr) => (tr.id === id ? { ...tr, styleTags: nextStyle || '—' } : tr)));
    try {
      await updateTrackStyleRow(id, nextStyle);
      setGalleryError(null);
    } catch (e) {
      const msg = (e as Error).message || 'Database write failed';
      setGalleryError(`Couldn't save style — ${msg}.`);
    }
  }, []);

  const setTrackLyrics = useCallback(async (id: string, nextLyrics: string) => {
    setGallery((g) => g.map((tr) => (tr.id === id ? { ...tr, lyricsPreview: nextLyrics } : tr)));
    try {
      await updateTrackLyricsRow(id, nextLyrics);
      setGalleryError(null);
    } catch (e) {
      const msg = (e as Error).message || 'Database write failed';
      setGalleryError(`Couldn't save lyrics — ${msg}.`);
    }
  }, []);

  const setTrackSpecs = useCallback(async (id: string, nextSpecsJson: string) => {
    setGallery((g) => g.map((tr) => (tr.id === id ? { ...tr, specsJson: nextSpecsJson } : tr)));
    try {
      await updateTrackSpecsRow(id, nextSpecsJson);
      setGalleryError(null);
    } catch (e) {
      const msg = (e as Error).message || 'Database write failed';
      setGalleryError(`Couldn't save specs — ${msg}.`);
    }
  }, []);

  // Auto-persist form edits when a saved track is loaded. Without this,
  // the user types a new title (or edits style/lyrics/specs) and only
  // the in-memory form state changes — reopening the track in the player
  // (or any other app reading from SQLite) shows the OLD values.
  // Compares against the live gallery row, debounces 600ms so we don't
  // hammer the DB on every keystroke, and skips writes that are no-ops.
  useEffect(() => {
    if (!loadedTrackId) return;
    const id = loadedTrackId;
    const handle = setTimeout(() => {
      // Read the current gallery row at fire-time, not at effect-setup,
      // so a save that already landed isn't re-triggered by stale state.
      const row = gallery.find((t) => t.id === id);
      if (!row) return;
      const titleNext = songName.trim() || row.title;
      const styleNext = style.trim();
      const specsNext = countSetSpecs(specs) > 0 ? JSON.stringify(specs) : '';
      // Normalise the placeholder dash that loadTrack maps to '' so the
      // round-trip ('—' → '' → '—') doesn't trigger a phantom write.
      const rowStyleNorm = row.styleTags === '—' ? '' : (row.styleTags || '');
      if (row.title !== titleNext) void renameTrack(id, titleNext);
      if (rowStyleNorm !== styleNext) void setTrackStyle(id, styleNext);
      if ((row.lyricsPreview || '') !== lyrics) void setTrackLyrics(id, lyrics);
      if ((row.specsJson || '') !== specsNext) void setTrackSpecs(id, specsNext);
    }, 600);
    return () => clearTimeout(handle);
  }, [loadedTrackId, songName, style, lyrics, specs, gallery, renameTrack, setTrackStyle, setTrackLyrics, setTrackSpecs]);

  // Modal state: which saved track's cover the user is editing. Null
  // means closed. Keeping state at the parent so a re-render of the
  // sidebar (e.g. after rename) doesn't wipe the modal.
  const [coverEditTrack, setCoverEditTrack] = useState<SavedTrack | null>(null);

  // Form-side song-card preview. Opens when the user clicks the cover
  // thumbnail in the form. Read-mostly view of the WIP track (title,
  // theme, style, lyrics direction, specs, lyrics) plus the same cover
  // actions the panel offers. Lives at parent scope so re-renders from
  // form edits don't dismount it.
  const [songCardOpen, setSongCardOpen] = useState(false);

  // Load a saved track back into the form so the user can edit/remix
  // without retyping. Strips the "(lyrics)" / "(cover)" suffix we add
  // at save time so the title round-trips cleanly. Picks a sensible
  // mode: lyrics-only sheets reopen in lyrics mode; everything else
  // lands in compose mode so the user can hit Create Song again.
  const loadTrack = useCallback((track: SavedTrack) => {
    setLyrics(track.lyricsPreview ?? '');
    setStyle(track.styleTags && track.styleTags !== '—' ? track.styleTags : '');
    const cleanTitle = track.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, '');
    setSongName(cleanTitle);
    setInstrumental(false);
    // Round-trip the structured specs panel. Treat parse errors
    // as "no specs" rather than throwing — older tracks predate
    // SCHEMA_V5 so the column is empty and that's fine.
    if (track.specsJson) {
      try { setSpecs(JSON.parse(track.specsJson) as TrackSpecs); }
      catch { setSpecs({}); }
    } else {
      setSpecs({});
    }
    // Hydrate cover-art state. coverDataUrl rides on the track row; the
    // prompt isn't persisted (it can drift from the title), so we leave
    // it empty and the Edit prompt textarea will show the freshly-derived
    // auto-prompt as its placeholder.
    setCoverDataUrl(track.coverDataUrl ?? '');
    setCoverPrompt('');
    setLoadedTrackId(track.id);
    // Stale form state from a previous mode shouldn't bleed into this
    // load. Clear errors and the restyle-only ref-audio triplet so the
    // user doesn't see a "Restyle needs a reference audio" banner on a
    // freshly loaded compose track. Active template + instrumental are
    // reset because the loaded track's lyrics already encode the form.
    setError(null);
    setActiveTemplate(null);
    setInstrumental(false);
    setRefAudioBase64(null);
    setRefAudioName(null);
    setRefSampleInfo(null);
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
    const baseName = sanitizeFileName(track.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, ''));
    placeDesktopFile(`${baseName}.mp3`, '', { mimeType: 'audio/mpeg', refTrackId: track.id }, track.id);
  }, [placeDesktopFile]);

  const saveLyricsToDesktop = useCallback((track: SavedTrack) => {
    if (!track.lyricsPreview) return;
    const baseName = sanitizeFileName(track.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, ''));
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
      const cleanTitle = payload.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, '');
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
      const cleanTitle = payload.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, '');
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
      setSongName(payload.title.replace(/\s*\((lyrics|cover|restyle)\)\s*$/, ''));
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
          { id: 'new', label: 'New Song', onSelect: () => {
            // Cancel any in-flight generation so we don't end up saving
            // a track for an abandoned form. Both refs cover music+chat
            // and AI-assist paths.
            abortRef.current?.abort();
            aiAbortRef.current?.abort();
            generatingRef.current = false;
            setMode('compose');
            setTheme('');
            setLyrics('');
            setStyle('');
            setSongName('');
            setSpecs({});
            setActiveTemplate(null);
            setInstrumental(false);
            setCoverDataUrl('');
            setCoverPrompt('');
            setCoverPromptOpen(false);
            setRefAudioBase64(null);
            setRefAudioName(null);
            setRefSampleInfo(null);
            setError(null);
            setGalleryError(null);
            setPhase('idle');
            setProgress(0);
            setAiBusy(null);
            setCoverBusy(false);
            setOptimizingSpecs(false);
            setLoadedTrackId(null);
          } },
          { id: 'surprise', label: 'Surprise me…', onSelect: () => surpriseMe() },
          { id: 'mode-restyle', label: 'Restyle Mode', onSelect: () => setMode('restyle') },
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

  // Player owns one <audio> element shared by every play surface
  // (TrackCard, TrackTable row, MiniPlayer). The ref is created here
  // (consumer owns refs per React strict rules) and passed both to
  // the hook (which attaches event listeners) and the <audio> JSX
  // mounted at the bottom of the workspace. Passing the visible
  // gallery as the queue means prev/next walks whatever the user
  // currently sees — search-filtered or not.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const player = usePlayer(visibleGallery, audioRef);

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
          <div className="ml-auto flex items-center gap-2">
            <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
              {gallerySearch.trim()
                ? `${visibleGallery.length} / ${gallery.length}`
                : t(
                  gallery.length === 1
                    ? 'musiccreator.gallery.count.one'
                    : 'musiccreator.gallery.count.other',
                  { n: gallery.length },
                )}
            </span>
            {/* View toggle — cards (default rich rail) vs list (Apple
                Music-style table). Persists in component state only;
                each open of the workspace starts in cards mode. */}
            <div
              className="flex rounded-md overflow-hidden flex-shrink-0"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <button
                onClick={() => setGalleryView('cards')}
                className="flex items-center justify-center transition-all"
                style={{
                  width: 22, height: 22,
                  background: galleryView === 'cards' ? 'var(--bg-hover)' : 'transparent',
                  color: galleryView === 'cards' ? 'var(--text-primary)' : 'var(--text-disabled)',
                }}
                title="Cards"
              >
                <Layers size={11} />
              </button>
              <button
                onClick={() => setGalleryView('list')}
                className="flex items-center justify-center transition-all"
                style={{
                  width: 22, height: 22,
                  background: galleryView === 'list' ? 'var(--bg-hover)' : 'transparent',
                  color: galleryView === 'list' ? 'var(--text-primary)' : 'var(--text-disabled)',
                }}
                title="List"
              >
                <FileMusic size={11} />
              </button>
            </div>
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
            {galleryView === 'list' ? (
              <TrackTable
                tracks={visibleGallery}
                player={player}
                onLoad={loadTrack}
                onOpenLyrics={openLyricsInEditor}
                onDelete={deleteTrack}
                onRename={renameTrack}
              />
            ) : (
              visibleGallery.map((track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  onDelete={deleteTrack}
                  onLoad={loadTrack}
                  onOpenLyrics={openLyricsInEditor}
                  onSaveSongToDesktop={saveSongToDesktop}
                  onSaveLyricsToDesktop={saveLyricsToDesktop}
                  onPlayInPlayer={playTrackInPlayer}
                  onRename={renameTrack}
                  onEditCover={setCoverEditTrack}
                  player={player}
                />
              ))
            )}
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
          {/* Mode tabs. "Restyle" replaced "Cover" because users were
              confusing it with album cover art (which is now a separate
              first-class panel below). Wand icon reads as "transform"
              not "image". */}
          {([
            { id: 'compose' as Mode, icon: <Music2 size={13} />, label: 'Song', tip: 'Theme → lyrics → music' },
            { id: 'restyle' as Mode, icon: <Wand2 size={13} />, label: 'Restyle', tip: 'Re-sing your song in the style of a reference track' },
            { id: 'lyricsOnly' as Mode, icon: <NotebookText size={13} />, label: 'Lyrics', tip: 'Words only, no audio' },
          ]).map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              disabled={busy}
              title={m.tip}
              className="flex items-center gap-1.5 px-4 rounded-lg transition-all disabled:opacity-50"
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
              {m.icon}
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
                {mode === 'restyle'
                  ? 'Restyle Song'
                  : mode === 'lyricsOnly'
                    ? 'Write Lyrics'
                    : t('musiccreator.button.create')}
              </button>
            )}
          </div>
        </div>

        {/* Metadata strip — Song Name + Instrumental toggle. They're
            track metadata, not content — pinning them to the top means
            the form area below is purely about composition (theme,
            style, genre, specs, lyrics). Reclaims ~80px of scrolling
            real estate the old per-field cards used. */}
        <div
          className="flex items-center gap-3 px-5 flex-shrink-0"
          style={{
            height: 40,
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-window)',
          }}
        >
          <label
            htmlFor="juli3ta-song-name"
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--text-disabled)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              flexShrink: 0,
            }}
          >
            {t('musiccreator.songName.label')}
          </label>
          <input
            id="juli3ta-song-name"
            value={songName}
            onChange={(e) => setSongName(e.target.value)}
            onDragOver={acceptDrag}
            onDrop={handleSongNameDrop}
            placeholder={t('musiccreator.songName.placeholder')}
            disabled={busy}
            className="flex-1 px-2.5 py-1 rounded-md focus:outline-none focus:ring-1 disabled:opacity-50"
            style={{
              fontSize: 12,
              background: 'var(--bg-titlebar)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              minWidth: 0,
            }}
          />
          {/* Instrumental toggle — pinned next to Song Name because
              it's a generation-wide knob, not a per-field setting.
              Hidden in lyrics-only mode where vocals are required
              by definition (toggling it would only confuse). Uses
              the in-house TytusToggle because the shadcn Switch
              renders transparent on bg-window backgrounds. */}
          {mode !== 'lyricsOnly' && (
            <label
              htmlFor="juli3ta-instrumental"
              className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0"
              style={{ fontSize: 11, color: 'var(--text-secondary)' }}
            >
              {t('musiccreator.lyrics.instrumental')}
              <TytusToggle
                id="juli3ta-instrumental"
                checked={instrumental}
                onChange={setInstrumental}
                disabled={busy}
              />
            </label>
          )}
        </div>

        {/* Status bar — unified zone for progress, tips, and errors.
            Sits between the action toolbar and the form so the user
            looks at one slim band for "what is the app doing right
            now?". Apple-Music-inspired layout, but uses the same
            bg-titlebar / accent gradient as the rest of Tytus OS so
            it visually disappears into the chrome when idle. */}
        {(busy || error || galleryError) && (
          <div
            className="flex-shrink-0"
            style={{
              borderBottom: '1px solid var(--border-subtle)',
              background: error
                ? 'rgba(255, 82, 82, 0.06)'
                : galleryError
                  ? 'rgba(251, 191, 36, 0.06)'
                  : 'var(--bg-titlebar)',
            }}
          >
            {busy && (
              <div className="overflow-hidden" style={{ height: 2, background: 'var(--bg-hover)' }}>
                <div
                  style={{
                    width: `${progress * 100}%`,
                    height: '100%',
                    background: 'linear-gradient(to right, var(--accent-primary), var(--accent-secondary))',
                    transition: 'width 0.25s ease',
                  }}
                />
              </div>
            )}
            <div className="flex items-center gap-2 px-5" style={{ height: 30, fontSize: 11 }}>
              {error ? (
                <>
                  <AlertCircle size={12} style={{ color: '#ff5252', flexShrink: 0 }} />
                  <span className="flex-1 truncate" style={{ color: '#ff8a80' }} title={error}>
                    {error}
                  </span>
                  <button
                    onClick={() => setError(null)}
                    className="rounded-md transition-all hover:bg-[var(--bg-hover)] flex-shrink-0 flex items-center justify-center"
                    style={{ width: 18, height: 18, color: 'var(--text-secondary)' }}
                    title={t('musiccreator.error.dismiss')}
                  >
                    <X size={11} />
                  </button>
                </>
              ) : busy ? (
                <>
                  <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                  <span className="flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                    {phase === 'lyrics'
                      ? FUN_LYRICS_TIPS[tipIndex % FUN_LYRICS_TIPS.length]
                      : FUN_MUSIC_TIPS[tipIndex % FUN_MUSIC_TIPS.length]}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-disabled)', flexShrink: 0 }}>
                    {phase === 'lyrics' ? 'Step 1 / 2 · Lyrics' : 'Step 2 / 2 · Music'}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle size={12} style={{ color: '#fbbf24', flexShrink: 0 }} />
                  <span className="flex-1 truncate" style={{ color: '#fde68a' }} title={galleryError ?? ''}>
                    {galleryError}
                  </span>
                  <button
                    onClick={() => setGalleryError(null)}
                    className="rounded-md transition-all hover:bg-[var(--bg-hover)] flex-shrink-0 flex items-center justify-center"
                    style={{ width: 18, height: 18, color: 'var(--text-secondary)' }}
                    title="Dismiss"
                  >
                    <X size={11} />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Scrollable form area */}
        <div className="flex-1 overflow-y-auto invisible-scrollbar">
        <div className="px-6 py-5">

        {/* Restyle-mode reference-audio dropper (full width) */}
        {mode === 'restyle' && (
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
          className="grid gap-5 mb-5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        >
          {/* Theme */}
          <FieldCard
            label={t('musiccreator.theme.label')}
            hint={t('musiccreator.theme.hint')}
            headerExtra={
              <AIAssistButton
                label="Inspire"
                tooltip="Use AI to write a theme based on your Style"
                onClick={inspireTheme}
                busy={aiBusy === 'theme'}
                disabled={busy || aiBusy !== null}
              />
            }
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
            headerExtra={
              <AIAssistButton
                label="Suggest"
                tooltip="Use AI to suggest a Style from your Theme"
                onClick={suggestStyle}
                busy={aiBusy === 'style'}
                disabled={busy || aiBusy !== null}
              />
            }
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

        {/* Genre palette + Track Specs — full-width interactive
            surfaces. Hidden in Lyrics-only mode because lyrics
            generation doesn't use musical structure or chip-driven
            genre cues; that mode is laser-focused on theme → text. */}
        {mode !== 'lyricsOnly' && (
          <div className="flex flex-col gap-4 mb-5">
            <GenrePaletteCard onPick={addStyleChip} disabled={busy} />
            <TrackSpecsCard
              specs={specs}
              onChange={setSpecs}
              disabled={busy}
              onOptimize={optimizeSpecs}
              optimizing={optimizingSpecs}
            />
          </div>
        )}

        {/* Cover Art — first-class album-cover panel. Auto checkbox =
            generate at save time using title + theme + style. Edit
            prompt = user-overridable. Regenerate / Upload / Clear are
            the manual escape hatches. Lives in its own card so the
            user reads it as "this is the album cover", not Restyle
            (which is now the audio style-transfer mode). */}
        <FieldCard
          label="Cover Art"
          hint={endpoint?.models.image
            ? 'Auto-generated when you create the song. Override the prompt or upload your own image.'
            : 'No image model on this endpoint — pick one in Settings → Cover art, or upload your own image below.'}
          className="mb-5"
          headerExtra={
            <label className="flex items-center gap-2 cursor-pointer select-none" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Auto-generate
              <TytusToggle
                checked={coverAuto}
                onChange={setCoverAuto}
                disabled={busy || !endpoint?.models.image}
              />
            </label>
          }
        >
          <div className="flex gap-3">
            {/* Thumbnail. 88px square — matches the sidebar rail aesthetic
                without dominating the form. Click → upload (cheap path);
                gradient placeholder when no art yet. */}
            <button
              type="button"
              onClick={() => setSongCardOpen(true)}
              disabled={busy}
              className="relative flex-shrink-0 rounded-lg overflow-hidden transition-all hover:opacity-90 disabled:opacity-50"
              style={{
                width: 88,
                height: 88,
                background: coverDataUrl
                  ? `url(${coverDataUrl}) center/cover no-repeat`
                  : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                border: '1px solid var(--border-subtle)',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
              title="Open song card — big cover preview + metadata"
            >
              {!coverDataUrl && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <ImageIcon size={28} style={{ color: 'white', opacity: 0.85 }} />
                </div>
              )}
              {coverBusy && (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.5)' }}
                >
                  <Loader2 size={20} className="animate-spin" style={{ color: 'white' }} />
                </div>
              )}
            </button>
            {/* Action stack — Generate / Upload / Clear / Edit prompt.
                Wraps so the form stays usable on narrow windows. */}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={regenerateCover}
                  disabled={busy || coverBusy || !endpoint?.models.image}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'white',
                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                    border: '1px solid transparent',
                    cursor: (busy || coverBusy || !endpoint?.models.image) ? 'not-allowed' : 'pointer',
                  }}
                  title={endpoint?.models.image ? 'Generate cover art from the prompt below' : 'No image model available'}
                >
                  {coverBusy
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Sparkles size={11} />}
                  {coverDataUrl ? 'Regenerate' : 'Generate'}
                </button>
                <button
                  type="button"
                  onClick={() => coverFileInputRef.current?.click()}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 hover:bg-[var(--bg-hover)]"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-titlebar)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="Upload your own image (PNG/JPG/WebP, max 4 MB)"
                >
                  <Upload size={11} />
                  Upload
                </button>
                {coverDataUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setCoverDataUrl('');
                      // Mirror to the saved row when editing an
                      // existing track — a Clear inside the form
                      // should reach the sidebar immediately.
                      if (loadedTrackId) {
                        setTrackCoverRef.current?.(loadedTrackId, '');
                      }
                    }}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 hover:bg-[var(--bg-hover)]"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-disabled)',
                      background: 'var(--bg-titlebar)',
                      border: '1px solid var(--border-subtle)',
                    }}
                    title="Remove the cover and fall back to the gradient placeholder"
                  >
                    <X size={11} />
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCoverPromptOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all hover:bg-[var(--bg-hover)] ml-auto"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-disabled)',
                    background: 'transparent',
                    border: '1px solid transparent',
                  }}
                  title="Edit the cover-art prompt"
                >
                  {coverPromptOpen ? <ChevronUp size={11} /> : <Pencil size={11} />}
                  {coverPromptOpen ? 'Hide prompt' : 'Edit prompt'}
                </button>
              </div>
              {/* Prompt textarea — collapsible. Placeholder = the
                  derived auto-prompt so the user can see what we'd
                  send if they typed nothing. Editing here only affects
                  manual Generate / Regenerate; the auto-at-save path
                  re-derives at save time so a stale prompt doesn't
                  surprise the user after they edited the title. */}
              {coverPromptOpen && (
                <textarea
                  value={coverPrompt}
                  onChange={(e) => setCoverPrompt(e.target.value)}
                  placeholder={deriveCoverPrompt(songName, theme, style)}
                  disabled={busy}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg resize-none focus:outline-none disabled:opacity-50"
                  style={{
                    fontSize: 11,
                    background: 'var(--bg-window)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
              )}
            </div>
          </div>
          {/* Hidden file input wired to both the thumbnail and Upload
              button. Resets value after each pick so the same file can
              be selected twice in a row (browser quirk). */}
          <input
            ref={coverFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCoverUpload(file);
              e.target.value = '';
            }}
          />
        </FieldCard>

        {/* Lyrics Direction — free-form intent prompt. Sits above the
            lyrics editor because it's about HOW the lyrics should read
            (perspective, language, taboo lines, cultural references)
            whereas Theme is the WHAT. Persists per-track via the specs
            blob (no schema bump needed) so reloading a track restores
            the direction it was generated with. Hidden in cover mode
            because cover-of-existing-track flow doesn't write lyrics. */}
        {mode !== 'restyle' && !instrumental && (
          <FieldCard
            label="Lyrics Direction"
            hint="Free-form direction for the lyrics — perspective, language, taboo lines, references. Sent to the AI alongside Theme and the song form below."
            className="mb-5"
            counter={(specs.intent ?? '').length > 0 ? `${(specs.intent ?? '').length} chars` : undefined}
          >
            <textarea
              value={specs.intent ?? ''}
              onChange={(e) => setSpecs((s) => ({ ...s, intent: e.target.value }))}
              placeholder='e.g. "first-person, mostly Spanish with one English chorus, mention rain, no clichés"'
              disabled={busy}
              rows={2}
              className="w-full px-3 py-2 rounded-lg resize-none focus:outline-none disabled:opacity-50"
              style={{
                fontSize: 11,
                background: 'var(--bg-window)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            />
          </FieldCard>
        )}

        {/* Lyrics — full width so the editor breathes. The Instrumental
            toggle moved to the workspace metadata strip (below mode tabs)
            so Lyrics owns this zone uncluttered. */}
        <FieldCard
          label={t('musiccreator.lyrics.label')}
          counter={instrumental ? 'instrumental — no vocals' : `${lyricsCount} / ${MAX_LYRICS}`}
          counterDanger={!instrumental && lyricsCount > MAX_LYRICS}
          className="mb-5"
          headerExtra={
            !instrumental ? (
              <AIAssistButton
                label="Polish"
                tooltip="Use AI to refine flow, rhyme, and structure"
                onClick={polishLyrics}
                busy={aiBusy === 'lyrics'}
                disabled={busy || aiBusy !== null || !lyrics.trim()}
              />
            ) : undefined
          }
        >
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            onDragOver={acceptDrag}
            onDrop={handleLyricsDrop}
            placeholder={instrumental
              ? '🎻 Instrumental mode — turn off the toggle above to write lyrics'
              : t('musiccreator.lyrics.placeholder')}
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
          {/* Song-form templates. A click does two things at once:
              - Inserts the empty section skeleton into the lyrics
                editor so hand-writing has scaffolding.
              - Selects the template, so when the user clicks
                Write Lyrics / Create Song the LLM gets the
                structure prompt and produces lyrics that actually
                fit the form. Clicking the active template again
                deselects it (returns to "let model choose" mode).
              The active template gets the accent gradient so the
              user can see at a glance which form is "armed". */}
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: 'var(--text-disabled)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginRight: 4,
              }}
            >
              Song form
            </span>
            {LYRIC_TEMPLATES.map((tpl) => {
              const active = activeTemplate?.id === tpl.id;
              return (
                <button
                  key={tpl.id}
                  onClick={() => {
                    if (active) {
                      setActiveTemplate(null);
                    } else {
                      setActiveTemplate(tpl);
                      // Only paste the skeleton when the editor is
                      // empty — pre-existing lyrics get respected so
                      // re-clicking a template doesn't nuke work.
                      if (!lyrics.trim()) setLyrics(tpl.skeleton);
                    }
                  }}
                  disabled={busy}
                  className="px-2 py-0.5 rounded-full transition-all disabled:opacity-40"
                  style={{
                    fontSize: 10,
                    fontWeight: active ? 600 : 500,
                    color: active ? 'white' : 'var(--text-secondary)',
                    background: active
                      ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                      : 'var(--bg-titlebar)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title={tpl.description + (active ? ' · click to clear' : ' · click to use this form')}
                >
                  {active ? '✓ ' : ''}{tpl.label}
                </button>
              );
            })}
            {activeTemplate && (
              <span style={{ fontSize: 9, color: 'var(--accent-primary)', marginLeft: 4 }}>
                AI will use this structure
              </span>
            )}
          </div>
        </FieldCard>

        {/* Song Name moved to the metadata strip below the mode tabs.
            It's metadata, not content — keeping it inline at the top
            saves ~80px of vertical space and the input stays visible
            while the user is editing other fields. */}

        {/* Status, progress, and errors all moved to the unified
            WorkspaceStatusBar between the mode tabs and the form
            (search for "Status bar — unified zone"). */}
        </div>{/* /px-6 py-5 */}
        </div>{/* /scrollable form area */}

        {/* Bottom bar — Spotify-inspired persistent transport. Hidden
            when no track has been queued; once a track plays it stays
            visible so the user can scrub / replay without re-opening
            the gallery card. The single shared <audio> element below
            is what every play button in the workspace drives. */}
        <MiniPlayer player={player} allTracks={gallery} />
        <audio ref={audioRef} preload="none" style={{ display: 'none' }} />
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

      {/* Cover-art editor for saved tracks. Closes on overlay click,
          Esc, or Save/Cancel. Mounts via portal so it overlays the
          whole window — matches ApiTester's modal positioning. */}
      {coverEditTrack && (
        <CoverArtModal
          track={coverEditTrack}
          endpoint={endpoint}
          onSave={setTrackCover}
          onClose={() => setCoverEditTrack(null)}
        />
      )}

      {/* Form-side song card. Big cover + metadata snapshot of the
          WIP track. Triggered by the cover thumbnail click. Reuses the
          same regenerate/upload/clear handlers as the inline panel so
          a change inside the modal stays consistent with what the form
          will save. */}
      {songCardOpen && (
        <SongCardModal
          songName={songName}
          mode={mode}
          theme={theme}
          style={style}
          intent={specs.intent ?? ''}
          lyrics={lyrics}
          specs={specs}
          coverDataUrl={coverDataUrl}
          coverPrompt={coverPrompt}
          endpoint={endpoint}
          busy={coverBusy}
          onRegenerate={regenerateCover}
          onUpload={handleCoverUpload}
          onClear={() => {
            setCoverDataUrl('');
            if (loadedTrackId) setTrackCoverRef.current?.(loadedTrackId, '');
          }}
          onClose={() => setSongCardOpen(false)}
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
                    kind: 'music' | 'cover' | 'lyrics' | 'chat' | 'image';
                  }> = [
                    { key: 'music',        label: 'Music',           discovered: ep.models.music,        kind: 'music' as const },
                    { key: 'cover',        label: 'Restyle',         discovered: ep.models.cover,        kind: 'cover' as const },
                    { key: 'lyrics',       label: 'Lyrics',          discovered: ep.models.lyrics,       kind: 'lyrics' as const },
                    { key: 'lyricsBackup', label: 'Lyrics fallback', discovered: ep.models.lyricsBackup, kind: 'chat' as const },
                    { key: 'image',        label: 'Cover art',       discovered: ep.models.image,        kind: 'image' as const },
                  ];
                  // Filter the dropdown options by slot kind so users
                  // pick from the right pool: music slots see music ids,
                  // image only sees image ids, chat-fallback only chat.
                  const isMusicy = (id: string) =>
                    /music|cover/i.test(id);
                  const isImagey = (id: string) =>
                    /image|diffusion|dall-?e|flux|sdxl/i.test(id);
                  const optionsForSlot = (kind: 'music' | 'cover' | 'lyrics' | 'chat' | 'image'): readonly string[] => {
                    if (kind === 'chat') {
                      return ep.models.allIds.filter((id) => !/music|cover|tts|stt|transcribe|whisper|embed|image|diffusion|dall-?e|flux|sdxl/i.test(id));
                    }
                    if (kind === 'image') {
                      return ep.models.allIds.filter(isImagey);
                    }
                    return ep.models.allIds.filter(isMusicy);
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
