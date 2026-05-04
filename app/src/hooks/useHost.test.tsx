import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { HostProvider, useHost } from './useHost';

const wrap = (children: ReactNode) => <HostProvider>{children}</HostProvider>;

describe('useHost', () => {
  it('throws when called outside HostProvider', () => {
    expect(() => renderHook(() => useHost())).toThrow(
      /outside <HostProvider>/,
    );
  });

  it('returns a HostClient with the synthetic shell appId inside the provider', () => {
    const { result } = renderHook(() => useHost(), {
      wrapper: ({ children }) => <HostProvider>{children}</HostProvider>,
    });
    expect(result.current.appId).toBe('__shell__');
    // All 10 namespaces present.
    for (const ns of [
      'fs',
      'daemon',
      'windows',
      'notifications',
      'shellMenu',
      'i18n',
      'storage',
      'events',
      'media',
      'assets',
    ] as const) {
      expect(result.current[ns]).toBeDefined();
    }
  });

  it('respects the test-only client override prop', () => {
    const stub = {
      appId: 'override',
      fs: {} as never,
      daemon: {} as never,
      windows: {} as never,
      notifications: {} as never,
      shellMenu: {} as never,
      i18n: {} as never,
      storage: {} as never,
      events: {} as never,
      media: {} as never,
      assets: {} as never,
    };
    const { result } = renderHook(() => useHost(), {
      wrapper: ({ children }) => (
        <HostProvider client={stub}>{children}</HostProvider>
      ),
    });
    expect(result.current.appId).toBe('override');
  });

  // Confirm the JSX wrap helper builds something React can mount.
  it('renders children inside the provider', () => {
    const { result } = renderHook(() => useHost(), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBeDefined();
  });
});
