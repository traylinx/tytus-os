import { describe, expect, it } from 'vitest';
import { defaultShellMenuForApp, desktopShellMenu } from './shellMenu';

describe('shell menu defaults', () => {
  it('uses Tytus desktop menu when no window is focused', () => {
    const menu = desktopShellMenu();
    expect(menu.appLabel).toBe('TytusOS');
    expect(menu.groups.map((g) => g.label)).toEqual(['Apps', 'Pods', 'Channels', 'Files', 'Settings', 'Help']);
  });

  it('uses active app label and settings sections for Settings', () => {
    const menu = defaultShellMenuForApp('settings', true);
    expect(menu.appLabel).toBe('System Settings');
    expect(menu.groups.map((g) => g.label)).toContain('Tytus');
    expect(menu.groups.flatMap((g) => g.items).map((i) => i.actionId)).toContain('open-settings-daemon');
  });

  it('keeps generic apps honest with only real window/help actions', () => {
    const menu = defaultShellMenuForApp('calculator', true);
    expect(menu.appLabel).toBe('Calculator');
    expect(menu.groups.map((g) => g.label)).toEqual(['Window', 'Help']);
  });
});
