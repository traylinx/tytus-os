import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { HostClient, Manifest } from '@tytus/host-api';
import { I18nProvider, useI18n } from '@/i18n';
import { OSProvider } from '@/hooks/useOSStore';
import { DaemonClientProvider } from '@/hooks/useDaemonClient';
import { DaemonStateProvider } from '@/hooks/useDaemonStateContext';
import { createDaemonClient } from '@/lib/daemon';
import { makeFakeFetch } from '@/test/fakeFetch';
import { stateFixture } from '@/test/fixtures';
import { HostBridgeWiring } from './HostBridgeWiring';
import { makeHostForApp, setI18nOverride } from './host-impl';

const manifest: Manifest = {
  id: 'probe',
  name: 'Probe',
  version: '1.0.0',
  icon: 'Box',
  category: 'Utilities',
  description: 'Probe app',
  window: {
    defaultSize: { width: 100, height: 100 },
    minSize: { width: 100, height: 100 },
  },
  permissions: [],
  entry: { module: '/probe/index.js' },
};

const entryUrls = {
  module: '/probe/index.js',
  assets: 'http://localhost/_apps/probe/assets',
  css: null,
};

afterEach(() => {
  setI18nOverride(null);
});

function LocaleSwitcher() {
  const { setLanguage } = useI18n();
  return <button onClick={() => setLanguage('es')}>switch-es</button>;
}

function HostProbe({ onHost, onLocale }: {
  onHost: (host: HostClient) => void;
  onLocale: (locale: string) => void;
}) {
  useEffect(() => {
    const host = makeHostForApp('probe', manifest, entryUrls);
    onHost(host);
    return host.i18n.onLocaleChange(onLocale);
  }, [onHost, onLocale]);
  return null;
}

function renderBridge(onHost: (host: HostClient) => void, onLocale: (locale: string) => void) {
  const { fetch } = makeFakeFetch([
    { method: 'GET', path: '/api/state', body: stateFixture },
  ]);
  const client = createDaemonClient({ fetch });
  return render(
    <I18nProvider>
      <DaemonClientProvider client={client}>
        <DaemonStateProvider intervalMs={60_000}>
          <OSProvider>
            <HostBridgeWiring />
            <LocaleSwitcher />
            <HostProbe onHost={onHost} onLocale={onLocale} />
          </OSProvider>
        </DaemonStateProvider>
      </DaemonClientProvider>
    </I18nProvider>,
  );
}

describe('HostBridgeWiring i18n bridge', () => {
  it('keeps existing dynamic app host objects live across language switches', async () => {
    const holder: { host: HostClient | null } = { host: null };
    const locales: string[] = [];
    renderBridge((h) => { holder.host = h; }, (locale) => locales.push(locale));

    await waitFor(() => expect(holder.host?.i18n.locale).toBe('en'));
    expect(holder.host?.i18n.t('category.System')).toBe('System');

    act(() => {
      fireEvent.click(screen.getByText('switch-es'));
    });

    await waitFor(() => expect(holder.host?.i18n.locale).toBe('es'));
    expect(holder.host?.i18n.t('category.System')).toBe('Sistema');
    expect(locales).toEqual(['es']);
  });
});
