import type { AliasRewriteDescriptor, AppCategory as ManifestAppCategory } from '@tytus/host-api';
import type { AppDefinition, AppKind, AppCategory } from '@/types';
import { getInstalledAppRow } from '@/runtime/installed-apps-cache';
import type { InstalledAppRow } from '@/runtime/installed-apps-repo';

// 50 apps total in v1.
// 8 Tytus product surfaces + 42 OS-feel utilities (kept from the original Kimi seed).
// Permanently dropped (codex consult + product judgement):
//   Contacts        — fake contacts DB, no real address-book integration
//   Email           — fake "send email" flow, creates a real safety risk
//   FtpClient       — fake FTP client, pretends to dial servers it can't reach
//   GitClient       — fake git ops, misleading
//   NetworkTools    — fake ping/traceroute, dangerous if user thinks it's real
//   PasswordManager — fake password store, security misrepresentation
// Reasoning: every icon implies a product promise; these 6 promised things we
// can't deliver. Games + creative apps + utilities = honest "OS feel" without
// implying the OS does ops it doesn't.

export const APP_REGISTRY: AppDefinition[] = [
  // ================================================================
  // TYTUS product surfaces (System + Internet)
  // ================================================================
  { id: 'app-store', name: 'App Store', icon: 'Store', category: 'System',
    description: 'Browse and discover recommended apps. Check install status on your machine.',
    defaultSize: { width: 800, height: 600 }, minSize: { width: 560, height: 400 } },

  { id: 'forge', name: 'Tytus Forge', icon: 'Sparkles', category: 'Productivity',
    description: 'Tytus-native Monaco workbench for local files, artifacts, and future agent/Cortex workflows.',
    defaultSize: { width: 1200, height: 780 }, minSize: { width: 760, height: 520 }, kind: 'installed' },

  { id: 'pod-inspector', name: 'Pod Inspector', icon: 'Box', category: 'System',
    description: 'Inspect, restart, uninstall, revoke pods. Live job logs.',
    defaultSize: { width: 1100, height: 720 }, minSize: { width: 800, height: 480 }, phase: 3 },

  { id: 'channels', name: 'Channels', icon: 'Send', category: 'Internet',
    description: 'Telegram, Slack, iMessage, Matrix bindings per pod.',
    defaultSize: { width: 760, height: 560 }, minSize: { width: 440, height: 400 }, phase: 5 },

  { id: 'help', name: 'Help', icon: 'LifeBuoy', category: 'System',
    description: 'Doctor, daemon lifecycle, log tail, troubleshooting.',
    defaultSize: { width: 880, height: 600 }, minSize: { width: 640, height: 400 }, phase: 4 },

  // ================================================================
  // SYSTEM
  // ================================================================
  { id: 'settings', name: 'System Settings', icon: 'Settings', category: 'System',
    description: 'Account, plan, pods, agents, daemon, appearance, notifications, privacy.',
    defaultSize: { width: 760, height: 560 }, minSize: { width: 480, height: 400 } },

  { id: 'filemanager', name: 'Files', icon: 'Folder', category: 'System',
    description: 'Browse local, pod inbox, downloads, garage shared folders.',
    defaultSize: { width: 880, height: 580 }, minSize: { width: 480, height: 360 }, phase: 5 },

  { id: 'terminal', name: 'Terminal', icon: 'Terminal', category: 'System',
    description: 'Local shell + tytus exec into pod containers.',
    defaultSize: { width: 720, height: 460 }, minSize: { width: 400, height: 280 }, phase: 6 },

  { id: 'systemmonitor', name: 'System Monitor', icon: 'Activity', category: 'System',
    description: 'CPU, memory, disk, network — host + pods.',
    defaultSize: { width: 720, height: 500 }, minSize: { width: 400, height: 320 } },

  { id: 'archivemanager', name: 'Archive Manager', icon: 'Package', category: 'System',
    description: 'Create and extract ZIP, TAR, 7Z archives.',
    defaultSize: { width: 600, height: 440 }, minSize: { width: 360, height: 280 } },

  // ================================================================
  // INTERNET
  // ================================================================
  { id: 'chat', name: 'Chat', icon: 'MessageSquare', category: 'Internet',
    description: 'Talk to your pod AI.',
    defaultSize: { width: 520, height: 640 }, minSize: { width: 360, height: 440 }, phase: 4 },

  { id: 'browser', name: 'Browser', icon: 'Globe', category: 'Internet',
    description: 'Open Tytus pod URLs, agent docs, GitHub.',
    defaultSize: { width: 960, height: 640 }, minSize: { width: 480, height: 360 } },

  { id: 'weather', name: 'Weather', icon: 'CloudSun', category: 'Internet',
    description: 'Weather forecast with locations.',
    defaultSize: { width: 440, height: 520 }, minSize: { width: 320, height: 400 } },

  { id: 'rssreader', name: 'RSS Reader', icon: 'Rss', category: 'Internet',
    description: 'Feed reader for news subscriptions.',
    defaultSize: { width: 800, height: 560 }, minSize: { width: 480, height: 360 } },

  // ================================================================
  // PRODUCTIVITY
  // ================================================================
  { id: 'notes', name: 'Notes', icon: 'StickyNote', category: 'Productivity',
    description: 'Quick notes with folders.',
    defaultSize: { width: 640, height: 480 }, minSize: { width: 360, height: 300 } },

  { id: 'todo', name: 'Todo', icon: 'CheckSquare', category: 'Productivity',
    description: 'Task list with priorities and projects.',
    defaultSize: { width: 480, height: 560 }, minSize: { width: 320, height: 400 } },

  { id: 'reminders', name: 'Reminders', icon: 'Bell', category: 'Productivity',
    description: 'Time-based reminders.',
    defaultSize: { width: 440, height: 480 }, minSize: { width: 320, height: 360 } },

  { id: 'calendar', name: 'Calendar', icon: 'Calendar', category: 'Productivity',
    description: 'Monthly view with events.',
    defaultSize: { width: 720, height: 520 }, minSize: { width: 400, height: 360 } },

  { id: 'calculator', name: 'Calculator', icon: 'Calculator', category: 'Productivity',
    description: 'Standard calculator with history.',
    defaultSize: { width: 340, height: 480 }, minSize: { width: 280, height: 400 } },

  { id: 'clock', name: 'Clock', icon: 'Clock', category: 'Productivity',
    description: 'World clock, alarms, timer, stopwatch.',
    defaultSize: { width: 440, height: 400 }, minSize: { width: 320, height: 280 } },

  { id: 'spreadsheet', name: 'Spreadsheet', icon: 'Table2', category: 'Productivity',
    description: 'Basic spreadsheet with formulas.',
    defaultSize: { width: 800, height: 560 }, minSize: { width: 480, height: 320 } },

  { id: 'texteditor', name: 'Text Editor', icon: 'FileText', category: 'Productivity',
    description: 'Edit plain text files.',
    defaultSize: { width: 640, height: 480 }, minSize: { width: 320, height: 240 } },

  { id: 'documentviewer', name: 'Document Viewer', icon: 'File', category: 'Productivity',
    description: 'PDF and document viewer.',
    defaultSize: { width: 720, height: 600 }, minSize: { width: 400, height: 360 } },

  { id: 'markdownpreview', name: 'Markdown Preview', icon: 'FileCode', category: 'Productivity',
    description: 'Live markdown with GitHub styling.',
    defaultSize: { width: 800, height: 600 }, minSize: { width: 480, height: 360 } },

  // ================================================================
  // MEDIA
  // ================================================================
  { id: 'imageviewer', name: 'Image Viewer', icon: 'Image', category: 'Media',
    description: 'View images with zoom and slideshow.',
    defaultSize: { width: 720, height: 520 }, minSize: { width: 400, height: 320 } },

  { id: 'imagegallery', name: 'Image Gallery', icon: 'Images', category: 'Media',
    description: 'Browse and organize image collections.',
    defaultSize: { width: 800, height: 560 }, minSize: { width: 480, height: 360 } },

  { id: 'photoeditor', name: 'Photo Editor', icon: 'Camera', category: 'Media',
    description: 'Basic photo editing with filters.',
    defaultSize: { width: 880, height: 600 }, minSize: { width: 480, height: 360 } },

  { id: 'musicplayer', name: 'Music Player', icon: 'Music', category: 'Media',
    description: 'Audio player with playlist.',
    defaultSize: { width: 520, height: 440 }, minSize: { width: 360, height: 320 } },

  { id: 'musiccreator', name: 'JULI3TA', icon: 'juli3ta:mark', category: 'Media',
    description: 'Where songs find their soul. AI lyrics + music, powered by your pod.',
    defaultSize: { width: 880, height: 640 }, minSize: { width: 720, height: 520 } },

  { id: 'videoplayer', name: 'Video Player', icon: 'PlayCircle', category: 'Media',
    description: 'Video player with controls.',
    defaultSize: { width: 640, height: 440 }, minSize: { width: 400, height: 280 } },

  { id: 'voicerecorder', name: 'Voice Recorder', icon: 'Mic', category: 'Media',
    description: 'Record audio from your microphone.',
    defaultSize: { width: 440, height: 320 }, minSize: { width: 320, height: 240 } },

  { id: 'screenrecorder', name: 'Screen Recorder', icon: 'Video', category: 'Media',
    description: 'Capture and record your screen.',
    defaultSize: { width: 520, height: 360 }, minSize: { width: 360, height: 280 } },

  { id: 'mediaconverter', name: 'Media Converter', icon: 'RefreshCw', category: 'Media',
    description: 'Convert between media formats.',
    defaultSize: { width: 560, height: 400 }, minSize: { width: 360, height: 280 } },

  // ================================================================
  // DEVTOOLS
  // ================================================================
  { id: 'codeeditor', name: 'Code Editor', icon: 'Code2', category: 'DevTools',
    description: 'Syntax-highlighted code editor with tabs.',
    defaultSize: { width: 880, height: 640 }, minSize: { width: 480, height: 360 } },

  { id: 'apitester', name: 'API Tester', icon: 'Send', category: 'DevTools',
    description: 'Postman-style HTTP request builder. Real fetch.',
    defaultSize: { width: 720, height: 560 }, minSize: { width: 440, height: 360 } },

  { id: 'jsonformatter', name: 'JSON Formatter', icon: 'Braces', category: 'DevTools',
    description: 'Format, validate, and beautify JSON.',
    defaultSize: { width: 680, height: 520 }, minSize: { width: 400, height: 320 } },

  { id: 'regextester', name: 'Regex Tester', icon: 'Search', category: 'DevTools',
    description: 'Test and debug regular expressions.',
    defaultSize: { width: 720, height: 480 }, minSize: { width: 440, height: 320 } },

  { id: 'base64tool', name: 'Base64 Tool', icon: 'Shuffle', category: 'DevTools',
    description: 'Encode/decode Base64 and URL strings.',
    defaultSize: { width: 560, height: 440 }, minSize: { width: 360, height: 300 } },

  { id: 'colorpalette', name: 'Color Palette', icon: 'Palette', category: 'DevTools',
    description: 'Color schemes and palette generation.',
    defaultSize: { width: 640, height: 480 }, minSize: { width: 400, height: 320 } },

  // ================================================================
  // CREATIVE
  // ================================================================
  { id: 'drawing', name: 'Drawing', icon: 'Paintbrush', category: 'Creative',
    description: 'Canvas-based drawing with brushes.',
    defaultSize: { width: 800, height: 600 }, minSize: { width: 480, height: 360 } },

  { id: 'whiteboard', name: 'Whiteboard', icon: 'Layout', category: 'Creative',
    description: 'Infinite canvas for sketches.',
    defaultSize: { width: 800, height: 600 }, minSize: { width: 480, height: 360 } },

  { id: 'colorpicker', name: 'Color Picker', icon: 'Pipette', category: 'Creative',
    description: 'Pick colors, generate palettes.',
    defaultSize: { width: 440, height: 400 }, minSize: { width: 320, height: 280 } },

  { id: 'asciiart', name: 'ASCII Art', icon: 'Type', category: 'Creative',
    description: 'Create ASCII text art and diagrams.',
    defaultSize: { width: 640, height: 480 }, minSize: { width: 400, height: 320 }, isDemo: true },

  { id: 'matrixrain', name: 'Matrix Rain', icon: 'Sparkles', category: 'Creative',
    description: 'Animated falling characters.',
    defaultSize: { width: 600, height: 480 }, minSize: { width: 400, height: 320 }, isDemo: true },

  // ================================================================
  // GAMES
  // ================================================================
  { id: 'minesweeper', name: 'Minesweeper', icon: 'Bomb', category: 'Games',
    description: 'Classic minesweeper with 3 difficulty levels.',
    defaultSize: { width: 360, height: 440 }, minSize: { width: 280, height: 360 }, isDemo: true },

  { id: 'snake', name: 'Snake', icon: 'Gamepad2', category: 'Games',
    description: 'Classic snake game with increasing speed.',
    defaultSize: { width: 440, height: 480 }, minSize: { width: 320, height: 360 }, isDemo: true },

  { id: 'tetris', name: 'Tetris', icon: 'Grid3x3', category: 'Games',
    description: 'Block-stacking puzzle game.',
    defaultSize: { width: 400, height: 560 }, minSize: { width: 280, height: 440 }, isDemo: true },

  { id: 'tictactoe', name: 'Tic-Tac-Toe', icon: 'X', category: 'Games',
    description: '2-player and AI tic-tac-toe.',
    defaultSize: { width: 400, height: 440 }, minSize: { width: 280, height: 320 }, isDemo: true },

  { id: 'game2048', name: '2048', icon: 'Hash', category: 'Games',
    description: 'Number sliding puzzle.',
    defaultSize: { width: 400, height: 480 }, minSize: { width: 320, height: 400 }, isDemo: true },

  { id: 'sudoku', name: 'Sudoku', icon: 'Grid2x2', category: 'Games',
    description: '9×9 number puzzle with 4 difficulties.',
    defaultSize: { width: 480, height: 520 }, minSize: { width: 360, height: 400 }, isDemo: true },

  { id: 'chess', name: 'Chess', icon: 'Crown', category: 'Games',
    description: 'Chess with AI opponent.',
    defaultSize: { width: 560, height: 600 }, minSize: { width: 400, height: 440 }, isDemo: true },

  { id: 'memory', name: 'Memory Game', icon: 'Brain', category: 'Games',
    description: 'Card matching memory game.',
    defaultSize: { width: 480, height: 440 }, minSize: { width: 320, height: 280 }, isDemo: true },

  { id: 'pong', name: 'Pong', icon: 'Circle', category: 'Games',
    description: 'Classic paddle ball game.',
    defaultSize: { width: 600, height: 400 }, minSize: { width: 400, height: 280 }, isDemo: true },

  { id: 'solitaire', name: 'Solitaire', icon: 'Layers', category: 'Games',
    description: 'Classic card solitaire.',
    defaultSize: { width: 720, height: 520 }, minSize: { width: 480, height: 360 }, isDemo: true },

  { id: 'flappybird', name: 'Flappy Bird', icon: 'Feather', category: 'Games',
    description: 'Side-scrolling arcade game.',
    defaultSize: { width: 400, height: 560 }, minSize: { width: 280, height: 400 }, isDemo: true },
];

/**
 * Fill in the registry kind when omitted. Existing in-tree apps default to
 * `legacy` since they're React components imported via AppRouter, not
 * loaded through the workspace-package loader. Workspace packages mark
 * themselves explicitly as `bundled` (M3+ when they extract).
 *
 * Aliases must declare `kind: 'alias'` explicitly — `aliasOf` is required
 * with `kind: 'alias'`, and an alias missing `aliasOf` is a programmer
 * error caught by `tytus-app validate` before install.
 */
export function normalizeApp(app: AppDefinition): AppDefinition & {
  kind: AppKind;
} {
  return { ...app, kind: app.kind ?? 'legacy' };
}

export const getAppById = (id: string): AppDefinition | undefined => {
  // Alias resolution: if the requested id points at an alias, follow it
  // once. We don't recurse — manifests with `aliasOf` chains are an
  // install-time error, not something the registry tries to repair.
  const direct = APP_REGISTRY.find((a) => a.id === id);
  if (direct?.kind === 'alias' && direct.aliasOf) {
    return APP_REGISTRY.find((a) => a.id === direct.aliasOf);
  }
  if (direct) return direct;

  // Fallback: the live `installed_apps` cache (kept in sync by
  // installer.ts on install / uninstall / reinstall, and primed once at
  // boot from main.tsx). This is what makes third-party apps installed
  // at runtime — e.g. the App Store's Featured catalog —
  // openable. Without this fallback `useOSStore.createWindow` throws
  // "Unknown app: <id>" for any id missing from the build-time
  // APP_REGISTRY, killing the click before AppRouter ever renders.
  const row = getInstalledAppRow(id);
  if (row) return appDefinitionFromInstalledRow(row);

  return undefined;
};

/** Map an `installed_apps` row's manifest into the static `AppDefinition`
 *  shape `useOSStore.createWindow` expects. The manifest's `window`
 *  block carries the geometry; everything else maps 1:1. Exported so
 *  the launcher can unify legacy registry entries with their canonical
 *  installed counterparts (matching icons + names across grid /
 *  Frequently Used / Dock). */
export function appDefinitionFromInstalledRow(row: InstalledAppRow): AppDefinition {
  const m = row.manifest;
  return {
    id: row.id,
    name: m.name,
    icon: m.icon,
    category: manifestCategoryToAppCategory(m.category),
    description: m.description,
    defaultSize: m.window.defaultSize,
    minSize: m.window.minSize,
    kind: row.kind,
  };
}

/** The host-api manifest enum and the in-tree `AppCategory` enum are
 *  intentionally separate (the in-tree one was the original; host-api
 *  was extracted later). They overlap on every value except 'Utilities'
 *  which only the host-api side defines. Any unknown value collapses to
 *  'System' so launcher rendering never crashes. */
function manifestCategoryToAppCategory(c: ManifestAppCategory): AppCategory {
  switch (c) {
    case 'System':
    case 'Internet':
    case 'Productivity':
    case 'Creative':
    case 'Games':
    case 'Media':
    case 'DevTools':
      return c;
    case 'Utilities':
      return 'System';
    default:
      return 'System';
  }
}

export const getAppsByCategory = (category: string): AppDefinition[] =>
  APP_REGISTRY.filter((a) => a.category === category && !a.hidden);

export const getAppsByKind = (kind: AppKind): AppDefinition[] =>
  APP_REGISTRY.filter((a) => normalizeApp(a).kind === kind);

/**
 * Apply a structured rewrite descriptor to legacy WindowArgs. Pure
 * function — no eval, no Function constructor — so registry rows are
 * portable and the alias surface has no script-injection footprint.
 *
 * Per 09-decisions.md M1-owned gap: rewriteArgs is a structured
 * descriptor, not a serialized function.
 */
export function applyRewriteDescriptor(
  descriptor: AliasRewriteDescriptor | undefined,
  legacyArgs: unknown,
): unknown {
  if (!descriptor) return legacyArgs;
  const legacy =
    legacyArgs && typeof legacyArgs === 'object'
      ? (legacyArgs as Record<string, unknown>)
      : {};
  switch (descriptor.type) {
    case 'identity':
      return legacyArgs;
    case 'static':
      return { ...descriptor.args };
    case 'studio': {
      const out: Record<string, unknown> = { mode: descriptor.mode };
      if (descriptor.readOnly !== undefined) out.readOnly = descriptor.readOnly;
      if ('fileRef' in legacy) out.fileRef = legacy.fileRef;
      return out;
    }
    case 'sheet': {
      const out: Record<string, unknown> = {};
      if (descriptor.readOnly !== undefined) out.readOnly = descriptor.readOnly;
      if ('fileRef' in legacy) out.fileRef = legacy.fileRef;
      return out;
    }
    case 'memo': {
      const out: Record<string, unknown> = {};
      if (descriptor.readOnly !== undefined) out.readOnly = descriptor.readOnly;
      if ('fileRef' in legacy) out.fileRef = legacy.fileRef;
      if ('focusLine' in legacy) out.focusLine = legacy.focusLine;
      return out;
    }
  }
}

/**
 * Resolve an alias entry to the live app + transformed window args.
 * Returns null when the id is not an alias.
 */
export function resolveAlias(
  id: string,
  args: unknown,
):
  | { resolvedAppId: string; rewrittenArgs: unknown }
  | null {
  const entry = APP_REGISTRY.find((a) => a.id === id);
  if (!entry || entry.kind !== 'alias' || !entry.aliasOf) return null;
  return {
    resolvedAppId: entry.aliasOf,
    rewrittenArgs: applyRewriteDescriptor(entry.rewriteArgs, args),
  };
}

export const getDefaultDockApps = (): string[] => [
  'forge',
  'pod-inspector',
  'settings',
  'chat',
  'filemanager',
  'channels',
  'terminal',
];
