// ============================================================
// Shell menu model — macOS-style contextual top navigation
// ============================================================

import { getAppById } from '@/apps/registry';

export type ShellMenuActionId =
  | 'open-apps'
  | 'open-pods'
  | 'open-channels'
  | 'open-files'
  | 'open-settings-account'
  | 'open-settings-plan'
  | 'open-settings-pods'
  | 'open-settings-agents'
  | 'open-settings-daemon'
  | 'open-settings-background'
  | 'open-settings-appearance'
  | 'open-settings-language'
  | 'open-settings-notifications'
  | 'open-settings-privacy'
  | 'open-settings-about'
  | 'open-help'
  | 'open-terminal'
  | 'open-notifications'
  | 'refresh-daemon'
  | 'minimize-window'
  | 'close-window';

export interface ShellMenuItem {
  id: string;
  label: string;
  actionId?: ShellMenuActionId;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
}

export interface ShellMenuGroup {
  id: string;
  label: string;
  items: ShellMenuItem[];
}

export interface ShellMenuModel {
  /** First text after the logo, mirroring macOS active-app name. */
  appLabel: string;
  groups: ShellMenuGroup[];
}

const item = (
  id: string,
  label: string,
  actionId: ShellMenuActionId,
  opts: Pick<ShellMenuItem, 'disabled' | 'danger'> = {},
): ShellMenuItem => ({ id, label, actionId, ...opts });

const windowGroup = (hasWindow: boolean): ShellMenuGroup => ({
  id: 'window',
  label: 'Window',
  items: [
    item('minimize', 'Minimize Window', 'minimize-window', { disabled: !hasWindow }),
    item('close', 'Close Window', 'close-window', { disabled: !hasWindow }),
  ],
});

const helpGroup = (): ShellMenuGroup => ({
  id: 'help',
  label: 'Help',
  items: [item('tytus-help', 'Tytus Help', 'open-help')],
});

export const desktopShellMenu = (): ShellMenuModel => ({
  appLabel: 'TytusOS',
  groups: [
    {
      id: 'apps',
      label: 'Apps',
      items: [item('open-apps', 'Open App Launcher', 'open-apps')],
    },
    {
      id: 'pods',
      label: 'Pods',
      items: [
        item('pod-inspector', 'Open Pod Inspector', 'open-pods'),
        item('agents', 'Install Agent…', 'open-settings-agents'),
      ],
    },
    {
      id: 'channels',
      label: 'Channels',
      items: [item('channels', 'Open Channels', 'open-channels')],
    },
    {
      id: 'files',
      label: 'Files',
      items: [item('files', 'Open Files', 'open-files')],
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [
        item('settings', 'System Settings…', 'open-settings-account'),
        item('daemon', 'Daemon Settings', 'open-settings-daemon'),
      ],
    },
    helpGroup(),
  ],
});

export const defaultShellMenuForApp = (appId: string | null, hasWindow: boolean): ShellMenuModel => {
  if (!appId) return desktopShellMenu();

  const app = getAppById(appId);
  const appLabel = app?.name ?? appId;

  switch (appId) {
    case 'settings':
      return {
        appLabel,
        groups: [
          {
            id: 'account',
            label: 'Account',
            items: [
              item('account', 'Account', 'open-settings-account'),
              item('plan', 'Plan & Units', 'open-settings-plan'),
            ],
          },
          {
            id: 'tytus',
            label: 'Tytus',
            items: [
              item('pods', 'Pods', 'open-settings-pods'),
              item('agents', 'Agents', 'open-settings-agents'),
              item('daemon', 'Daemon', 'open-settings-daemon'),
            ],
          },
          {
            id: 'view',
            label: 'View',
            items: [
              item('background', 'Background', 'open-settings-background'),
              item('appearance', 'Appearance', 'open-settings-appearance'),
              item('language', 'Languages', 'open-settings-language'),
              item('notifications', 'Notifications', 'open-settings-notifications'),
              item('privacy', 'Privacy', 'open-settings-privacy'),
              item('about', 'About', 'open-settings-about'),
            ],
          },
          windowGroup(hasWindow),
          helpGroup(),
        ],
      };

    case 'pod-inspector':
      return {
        appLabel,
        groups: [
          {
            id: 'pod',
            label: 'Pod',
            items: [
              item('agents', 'Install Agent…', 'open-settings-agents'),
              item('refresh', 'Refresh Daemon State', 'refresh-daemon'),
            ],
          },
          {
            id: 'view',
            label: 'View',
            items: [
              item('pods-settings', 'Pods Settings', 'open-settings-pods'),
              item('daemon-settings', 'Daemon Settings', 'open-settings-daemon'),
            ],
          },
          windowGroup(hasWindow),
          helpGroup(),
        ],
      };

    case 'channels':
      return {
        appLabel,
        groups: [
          {
            id: 'channels',
            label: 'Channels',
            items: [
              item('open-channels', 'Open Channels', 'open-channels'),
              item('agents', 'Install Channel Agent…', 'open-settings-agents'),
            ],
          },
          windowGroup(hasWindow),
          helpGroup(),
        ],
      };

    case 'filemanager':
      return {
        appLabel,
        groups: [
          {
            id: 'file',
            label: 'File',
            items: [
              item('new-files-window', 'New Files Window', 'open-files'),
              item('pods', 'Open Pod Inspector', 'open-pods'),
            ],
          },
          windowGroup(hasWindow),
          helpGroup(),
        ],
      };

    case 'terminal':
      return {
        appLabel,
        groups: [
          {
            id: 'shell',
            label: 'Shell',
            items: [
              item('new-terminal', 'New Terminal Window', 'open-terminal'),
            ],
          },
          windowGroup(hasWindow),
          helpGroup(),
        ],
      };

    case 'chat':
      return {
        appLabel,
        groups: [
          {
            id: 'chat',
            label: 'Chat',
            items: [
              item('pods', 'Open Pod Inspector', 'open-pods'),
              item('agents', 'Install Agent…', 'open-settings-agents'),
            ],
          },
          windowGroup(hasWindow),
          helpGroup(),
        ],
      };

    case 'help':
      return {
        appLabel,
        groups: [
          {
            id: 'help-actions',
            label: 'Help',
            items: [
              item('daemon', 'Daemon Settings', 'open-settings-daemon'),
              item('refresh', 'Refresh Daemon State', 'refresh-daemon'),
            ],
          },
          windowGroup(hasWindow),
        ],
      };

    default:
      return {
        appLabel,
        groups: [windowGroup(hasWindow), helpGroup()],
      };
  }
};
