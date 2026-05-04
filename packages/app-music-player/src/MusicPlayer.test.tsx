/**
 * @tytus/app-music-player — MusicPlayer smoke test.
 *
 * Mounts the lifted player with a fake `SharedDb` returning a couple of
 * `app_music_creator_tracks` rows, asserts the JULI3TA gallery rows
 * render, and pins the W3 contract fix: window args are read at the
 * FLAT path (`args.trackId`), not the legacy nested
 * (`args.music.trackId`) shape that the in-tree consumer used.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type {
  AppBootEnv,
  HostClient,
  SharedDb,
  AnyWindowArgs,
} from '@tytus/host-api';
import type { MusicPlayerWindowArgs } from '@tytus/contracts';
import bootMusicPlayer from './index';

// ── Fakes ────────────────────────────────────────────────────────────

interface FakeRow {
  id: string;
  title: string | null;
  style_tags: string | null;
  duration_ms: number | null;
  audio_data_url: string | null;
  cover_data_url?: string | null;
}

const FAKE_ROWS: FakeRow[] = [
  {
    id: 'track-1',
    title: 'Hello World',
    style_tags: 'synthwave, dreamy',
    duration_ms: 65_000,
    audio_data_url: 'data:audio/mp3;base64,AAA',
    cover_data_url: null,
  },
  {
    id: 'track-2',
    title: 'Second Track',
    style_tags: 'lofi',
    duration_ms: 90_000,
    audio_data_url: 'data:audio/mp3;base64,BBB',
    cover_data_url: null,
  },
];

function makeFakeSharedDb(rows: FakeRow[]): SharedDb {
  return {
    async query<T>(sql: string): Promise<T[]> {
      // Pin the contract: the player MUST be reading via the
      // OWNING-app physical table name. If the implementation
      // accidentally reverts to the in-tree repo it'll skip the
      // shared-db code path entirely (no SQL → empty list).
      expect(sql).toMatch(/FROM\s+app_music_creator_tracks/i);
      return rows as unknown as T[];
    },
  };
}

function makeFakeHost(args: AnyWindowArgs | undefined): HostClient {
  // Only the surfaces MusicPlayer touches need real shapes; the rest
  // throw if the component reaches into them so we catch accidental
  // coupling in CI.
  const explode = (label: string) => () => {
    throw new Error(`fake host: ${label} not implemented`);
  };
  const proxy = new Proxy(
    {} as Record<string, unknown>,
    {
      get(_target, prop: string) {
        return explode(prop);
      },
    },
  );
  const fake: HostClient = {
    appId: 'music-player',
    fs: proxy as unknown as HostClient['fs'],
    daemon: proxy as unknown as HostClient['daemon'],
    windows: {
      current: { id: 'win-test', appId: 'music-player', args },
      open: () => 'open',
      openOrFocus: () => 'open',
      close: () => {},
      addDesktopIcon: () => {},
    },
    notifications: { notify: () => {} },
    shellMenu: { register: () => () => {} },
    i18n: {
      locale: 'en',
      t: (key: string) => key,
      onLocaleChange: () => () => {},
    },
    storage: proxy as unknown as HostClient['storage'],
    events: proxy as unknown as HostClient['events'],
    media: proxy as unknown as HostClient['media'],
    assets: proxy as unknown as HostClient['assets'],
  };
  return fake;
}

function makeBootEnv(opts: {
  // Accept any window-args shape so tests can pin the contract by
  // handing in legacy/nested payloads — the player must ignore them.
  args?: AnyWindowArgs;
  rows?: FakeRow[];
  shared?: SharedDb | null;
}): AppBootEnv {
  const sharedDb =
    opts.shared !== undefined
      ? opts.shared
      : makeFakeSharedDb(opts.rows ?? FAKE_ROWS);
  const host = makeFakeHost(opts.args);
  // Override storage.forSharedKey so bootMusicPlayer's resolution
  // returns our fake. We don't need any other storage surface.
  host.storage = {
    current: () => {
      throw new Error('not used');
    },
    forApp: () => {
      throw new Error('not used');
    },
    forSharedKey: () => sharedDb,
  };
  return {
    host,
    // bootMusicPlayer never touches createSession; cast through unknown
    // to keep the test focused on the player.
    createSession: undefined as unknown as AppBootEnv['createSession'],
  };
}

async function flushAsync() {
  // Give the player's `useEffect` async refresh + setTracks one tick
  // to land before we assert.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('bootMusicPlayer (W3 extraction)', () => {
  it('renders a JULI3TA track from the shared music_creator_tracks table', async () => {
    const env = makeBootEnv({ rows: FAKE_ROWS });
    const App = bootMusicPlayer(env);

    render(<App />);
    await flushAsync();

    // First track row from the fake gallery — the player auto-selects
    // index 0, so the heading shows "Hello World".
    expect(screen.getByText('Hello World')).toBeTruthy();
    // Style tags map onto the album label.
    expect(screen.getByText('synthwave, dreamy')).toBeTruthy();
    // Artist label is the constant 'JULI3TA' for shared-table rows.
    expect(screen.getAllByText('JULI3TA').length).toBeGreaterThan(0);
  });

  it('reads window args at the flat `trackId` path (W3 contract fix)', async () => {
    // Two rows — the player must seed onto the SECOND one, matching
    // `args.trackId === 'track-2'`. If the consumer reverted to
    // `args.music.trackId` we'd seed the default (index 0).
    const env = makeBootEnv({
      args: { trackId: 'track-2' },
      rows: FAKE_ROWS,
    });
    const App = bootMusicPlayer(env);

    render(<App />);
    await flushAsync();

    // Title heading reflects the second track, not the first.
    expect(screen.getByText('Second Track')).toBeTruthy();
    expect(screen.queryByText('Hello World')).toBeFalsy();
  });

  it('NEVER reads window args via the legacy nested `args.music.trackId` shape', async () => {
    // Hand it a payload that ONLY exposes the legacy shape. The
    // current consumer reads `args.trackId` flat — so this should
    // resolve to "no intent" (default to track-1, not track-2).
    // If a future regression re-introduces `args.music.trackId`, this
    // test fails because we'd seed onto track-2 instead of track-1.
    const legacyArgs = {
      music: { trackId: 'track-2' },
    } as unknown as AnyWindowArgs;
    const env = makeBootEnv({ args: legacyArgs, rows: FAKE_ROWS });
    const App = bootMusicPlayer(env);

    render(<App />);
    await flushAsync();

    // Default (first) track was kept — the legacy shape is ignored.
    expect(screen.getByText('Hello World')).toBeTruthy();
    expect(screen.queryByText('Second Track')).toBeFalsy();
  });

  it('handles a null shared-db (Music Creator uninstalled / share missing)', async () => {
    const env = makeBootEnv({ shared: null });
    const App = bootMusicPlayer(env);

    render(<App />);
    await flushAsync();

    // Empty state — the player renders the "Your library is empty" copy
    // instead of crashing on the missing share.
    expect(screen.getByText('Your library is empty')).toBeTruthy();
  });

  it('queries the OWNER-app physical table name (`app_music_creator_tracks`)', async () => {
    // Wire a SharedDb that records every SQL the player issues. The
    // first effect call must hit `app_music_creator_tracks` —
    // anything else means the cross-app share boundary regressed.
    const sqls: string[] = [];
    const recordingDb: SharedDb = {
      async query<T>(sql: string): Promise<T[]> {
        sqls.push(sql);
        return FAKE_ROWS as unknown as T[];
      },
    };
    const env = makeBootEnv({ shared: recordingDb });
    const App = bootMusicPlayer(env);

    render(<App />);
    await flushAsync();

    expect(sqls.length).toBeGreaterThan(0);
    expect(sqls[0]).toMatch(/FROM\s+app_music_creator_tracks/i);
  });
});

// Silence the unused-import lint — `vi` stays in the import block
// so the next failing-test author can mock without re-importing.
void vi;
