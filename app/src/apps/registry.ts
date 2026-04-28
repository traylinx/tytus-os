import type { AppDefinition } from '@/types';

export const APP_REGISTRY: AppDefinition[] = [
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
    id: 'settings',
    name: 'Settings',
    icon: 'Settings',
    category: 'System',
    description: 'Plan, units, agent catalog, autostart, sign-out.',
    defaultSize: { width: 760, height: 560 },
    minSize: { width: 480, height: 400 },
    phase: 3,
  },
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
    id: 'files',
    name: 'Files',
    icon: 'Folder',
    category: 'System',
    description: 'Per-pod inbox, downloads, garage shared folders.',
    defaultSize: { width: 880, height: 580 },
    minSize: { width: 480, height: 360 },
    phase: 5,
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
  {
    id: 'terminal',
    name: 'Terminal',
    icon: 'Terminal',
    category: 'System',
    description: 'Real shell into pod containers via tytus exec.',
    defaultSize: { width: 720, height: 460 },
    minSize: { width: 400, height: 280 },
    phase: 6,
  },
  {
    id: 'browser',
    name: 'Browser',
    icon: 'Globe',
    category: 'Internet',
    description: 'Open Tytus pod URLs, agent docs, GitHub.',
    defaultSize: { width: 960, height: 640 },
    minSize: { width: 480, height: 360 },
    phase: 6,
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
  'files',
  'channels',
];
