import type { AppDefinition } from '@/types';

// 22 apps — 8 Tytus product surfaces + 14 OS-feel utilities.
// Games / Email / PasswordManager / FtpClient / RegexTester / JsonFormatter /
// ApiTester / Base64Tool / GitClient / Whiteboard / Drawing / ColorPalette /
// ColorPicker / AsciiArt / Contacts / Reminders / Spreadsheet / RssReader /
// NetworkTools / Weather / VoiceRecorder / ScreenRecorder / MediaConverter /
// PhotoEditor / ImageGallery / FlappyBird / MatrixRain were intentionally
// dropped — see git log for the codex consult that picked this 22.

export const APP_REGISTRY: AppDefinition[] = [
  // ====== TYTUS (System) — placeholder until phase wires them up ======
  {
    id: 'pod-inspector',
    name: 'Pod Inspector',
    icon: 'Box',
    category: 'System',
    description: 'Inspect, restart, uninstall, revoke pods. Live job logs.',
    defaultSize: { width: 880, height: 600 },
    minSize: { width: 520, height: 400 },
    phase: 3,
  },
  {
    id: 'channels',
    name: 'Channels',
    icon: 'Send',
    category: 'Internet',
    description: 'Telegram, Slack, iMessage, Matrix bindings per pod.',
    defaultSize: { width: 760, height: 560 },
    minSize: { width: 440, height: 400 },
    phase: 5,
  },
  {
    id: 'help',
    name: 'Help',
    icon: 'LifeBuoy',
    category: 'System',
    description: 'Doctor, daemon lifecycle, log tail, troubleshooting.',
    defaultSize: { width: 720, height: 560 },
    minSize: { width: 440, height: 360 },
    phase: 4,
  },

  // ====== OS-FEEL (System) — functional today, daemon-wired later ======
  {
    id: 'settings',
    name: 'System Settings',
    icon: 'Settings',
    category: 'System',
    description: 'Appearance, display, sound, power, keyboard, mouse — and pod plan/units.',
    defaultSize: { width: 760, height: 560 },
    minSize: { width: 480, height: 400 },
  },
  {
    id: 'filemanager',
    name: 'Files',
    icon: 'Folder',
    category: 'System',
    description: 'Browse local, pod inbox, downloads, garage shared folders.',
    defaultSize: { width: 880, height: 580 },
    minSize: { width: 480, height: 360 },
    phase: 5,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    icon: 'Terminal',
    category: 'System',
    description: 'Local shell + tytus exec into pod containers.',
    defaultSize: { width: 720, height: 460 },
    minSize: { width: 400, height: 280 },
    phase: 6,
  },
  {
    id: 'systemmonitor',
    name: 'System Monitor',
    icon: 'Activity',
    category: 'System',
    description: 'CPU, memory, disk, network — host + pods.',
    defaultSize: { width: 720, height: 500 },
    minSize: { width: 400, height: 320 },
  },
  {
    id: 'archivemanager',
    name: 'Archive Manager',
    icon: 'Package',
    category: 'System',
    description: 'Create and extract ZIP, TAR, 7Z archives.',
    defaultSize: { width: 600, height: 440 },
    minSize: { width: 360, height: 280 },
  },

  // ====== INTERNET ======
  {
    id: 'chat',
    name: 'Chat',
    icon: 'MessageSquare',
    category: 'Internet',
    description: 'Talk to your pod AI.',
    defaultSize: { width: 520, height: 640 },
    minSize: { width: 360, height: 440 },
    phase: 4,
  },
  {
    id: 'browser',
    name: 'Browser',
    icon: 'Globe',
    category: 'Internet',
    description: 'Open Tytus pod URLs, agent docs, GitHub.',
    defaultSize: { width: 960, height: 640 },
    minSize: { width: 480, height: 360 },
  },

  // ====== PRODUCTIVITY ======
  {
    id: 'notes',
    name: 'Notes',
    icon: 'StickyNote',
    category: 'Productivity',
    description: 'Quick notes with folders.',
    defaultSize: { width: 640, height: 480 },
    minSize: { width: 360, height: 300 },
  },
  {
    id: 'todo',
    name: 'Todo',
    icon: 'CheckSquare',
    category: 'Productivity',
    description: 'Task list with priorities and projects.',
    defaultSize: { width: 480, height: 560 },
    minSize: { width: 320, height: 400 },
  },
  {
    id: 'calendar',
    name: 'Calendar',
    icon: 'Calendar',
    category: 'Productivity',
    description: 'Monthly view with events.',
    defaultSize: { width: 720, height: 520 },
    minSize: { width: 400, height: 360 },
  },
  {
    id: 'calculator',
    name: 'Calculator',
    icon: 'Calculator',
    category: 'Productivity',
    description: 'Standard calculator with history.',
    defaultSize: { width: 340, height: 480 },
    minSize: { width: 280, height: 400 },
  },
  {
    id: 'clock',
    name: 'Clock',
    icon: 'Clock',
    category: 'Productivity',
    description: 'World clock, alarms, timer, stopwatch.',
    defaultSize: { width: 440, height: 400 },
    minSize: { width: 320, height: 280 },
  },
  {
    id: 'texteditor',
    name: 'Text Editor',
    icon: 'FileText',
    category: 'Productivity',
    description: 'Edit plain text files.',
    defaultSize: { width: 640, height: 480 },
    minSize: { width: 320, height: 240 },
  },
  {
    id: 'documentviewer',
    name: 'Document Viewer',
    icon: 'File',
    category: 'Productivity',
    description: 'PDF and document viewer.',
    defaultSize: { width: 720, height: 600 },
    minSize: { width: 400, height: 360 },
  },
  {
    id: 'markdownpreview',
    name: 'Markdown Preview',
    icon: 'FileCode',
    category: 'Productivity',
    description: 'Live markdown with GitHub styling.',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 480, height: 360 },
  },

  // ====== MEDIA ======
  {
    id: 'imageviewer',
    name: 'Image Viewer',
    icon: 'Image',
    category: 'Media',
    description: 'View images with zoom and slideshow.',
    defaultSize: { width: 720, height: 520 },
    minSize: { width: 400, height: 320 },
  },
  {
    id: 'musicplayer',
    name: 'Music Player',
    icon: 'Music',
    category: 'Media',
    description: 'Audio player with playlist.',
    defaultSize: { width: 520, height: 440 },
    minSize: { width: 360, height: 320 },
  },
  {
    id: 'videoplayer',
    name: 'Video Player',
    icon: 'PlayCircle',
    category: 'Media',
    description: 'Video player with controls.',
    defaultSize: { width: 640, height: 440 },
    minSize: { width: 400, height: 280 },
  },

  // ====== DEVTOOLS ======
  {
    id: 'codeeditor',
    name: 'Code Editor',
    icon: 'Code2',
    category: 'DevTools',
    description: 'Syntax-highlighted code editor with tabs.',
    defaultSize: { width: 880, height: 640 },
    minSize: { width: 480, height: 360 },
  },
];

export const getAppById = (id: string): AppDefinition | undefined =>
  APP_REGISTRY.find((a) => a.id === id);

export const getAppsByCategory = (category: string): AppDefinition[] =>
  APP_REGISTRY.filter((a) => a.category === category);

export const getDefaultDockApps = (): string[] => [
  'pod-inspector',
  'settings',
  'chat',
  'filemanager',
  'channels',
  'terminal',
];
